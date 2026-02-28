import { useState, useEffect, useRef } from 'react';
import { brewSystem } from '../../utils/mockHardware';
import { hardwareApi } from '../../utils/hardwareApi';
import PotCard from './PotCard';
import PumpCard from './PumpCard';
import BrewTimer from './BrewTimer';
import styles from './BrewingPanel.module.css';

const DEFAULT_REG_CONFIG = {
  enabled: true,
  steps: [
    { threshold: 5,   power: 100 },
    { threshold: 2,   power: 60  },
    { threshold: 0.5, power: 30  },
    { threshold: 0,   power: 0   },
  ],
};

const BK_MAX_WATTS = 8500;
const HLT_MAX_WATTS = 5000;

function BrewingPanel() {
  const [states, setStates] = useState(brewSystem.getAllStates());
  const [regulationConfig, setRegulationConfig] = useState(DEFAULT_REG_CONFIG);
  const [maxWatts, setMaxWatts] = useState(11000);

  // Read environment once on mount — avoids re-renders when localStorage changes
  const isProduction = useRef(
    localStorage.getItem('brewSystemEnvironment') === 'production'
  ).current;

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => {
        if (s?.app?.auto_efficiency) setRegulationConfig(s.app.auto_efficiency);
        if (s?.app?.max_watts != null) setMaxWatts(s.app.max_watts);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Initialize GPIO pins on the Pi when in production mode
    if (isProduction) {
      hardwareApi.initialize();
    }

    // Poll state every 500ms
    const interval = setInterval(async () => {
      if (isProduction) {
        // Get real temperatures from the Pi; keep mock state for UI state (regulation, sv, etc.)
        const temps = await hardwareApi.getTemperatures();
        if (temps) {
          setStates((prev) => ({
            ...prev,
            pots: {
              ...prev.pots,
              BK:  { ...prev.pots.BK,  pv: temps.bk  },
              MLT: { ...prev.pots.MLT, pv: temps.mlt },
              HLT: { ...prev.pots.HLT, pv: temps.hlt },
            },
          }));
        }
      } else {
        setStates(brewSystem.getAllStates());
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isProduction]);

  // Merge mock control state with the current real pv values so sensor
  // readings are never overwritten by the mock's simulated temperatures.
  const mergeWithRealPv = (prev) => {
    const mock = brewSystem.getAllStates();
    return {
      ...mock,
      pots: {
        BK:  { ...mock.pots.BK,  pv: prev.pots.BK.pv  },
        MLT: { ...mock.pots.MLT, pv: prev.pots.MLT.pv },
        HLT: { ...mock.pots.HLT, pv: prev.pots.HLT.pv },
      },
    };
  };

  const handlePotUpdate = (potName, updates) => {
    if (updates.heaterOn !== undefined) {
      brewSystem.setPotHeater(potName, updates.heaterOn);
      if (isProduction) hardwareApi.setPotPower(potName, updates.heaterOn);
    }
    if (updates.regulationEnabled !== undefined) {
      brewSystem.setPotRegulation(potName, updates.regulationEnabled);
    }
    if (updates.sv !== undefined) {
      brewSystem.setPotSetValue(potName, updates.sv);
    }
    if (updates.efficiency !== undefined) {
      brewSystem.setPotEfficiency(potName, updates.efficiency);
      if (isProduction) {
        // For HLT, cap the efficiency to stay within the max watts budget (BK has priority)
        let sendEff = updates.efficiency;
        if (potName === 'HLT') {
          const bkOn = states.pots.BK.heaterOn;
          const bkEff = states.pots.BK.efficiency;
          const bkWatts = (bkOn ? bkEff : 0) / 100 * BK_MAX_WATTS;
          const hltHeadroom = maxWatts - bkWatts;
          const hltCap = Math.max(0, Math.min(100, (hltHeadroom / HLT_MAX_WATTS) * 100));
          sendEff = Math.min(updates.efficiency, hltCap);
        }
        hardwareApi.setPotEfficiency(potName, sendEff);
      }
    }
    // When BK power or efficiency changes, resync throttled HLT efficiency to hardware
    if (isProduction && potName === 'BK' && states.pots.HLT.heaterOn) {
      const newBkOn = updates.heaterOn !== undefined ? updates.heaterOn : states.pots.BK.heaterOn;
      const newBkEff = updates.efficiency !== undefined ? updates.efficiency : states.pots.BK.efficiency;
      const newBkWatts = (newBkOn ? newBkEff : 0) / 100 * BK_MAX_WATTS;
      const newHltCap = Math.max(0, Math.min(100, ((maxWatts - newBkWatts) / HLT_MAX_WATTS) * 100));
      const newHltEff = Math.min(states.pots.HLT.efficiency, newHltCap);
      hardwareApi.setPotEfficiency('HLT', newHltEff);
    }
    if (isProduction) {
      setStates((prev) => ({
        ...prev,
        pots: { ...prev.pots, [potName]: { ...prev.pots[potName], ...updates } },
      }));
    } else {
      setStates(mergeWithRealPv);
    }
  };

  const handlePumpUpdate = (pumpName, updates) => {
    if (updates.on !== undefined) {
      brewSystem.setPump(pumpName, updates.on);
      if (isProduction) hardwareApi.setPumpPower(pumpName, updates.on);
    }
    if (updates.speed !== undefined) {
      brewSystem.setPumpSpeed(pumpName, updates.speed);
      if (isProduction) hardwareApi.setPumpSpeed(pumpName, updates.speed);
    }
    if (isProduction) {
      setStates((prev) => ({
        ...prev,
        pumps: { ...prev.pumps, [pumpName]: { ...prev.pumps[pumpName], ...updates } },
      }));
    } else {
      setStates(mergeWithRealPv);
    }
  };

  // Derive effective (throttled) power and slider caps for each pot
  const bkCap = Math.floor(Math.min(100, (maxWatts / BK_MAX_WATTS) * 100));
  const bkEffective = states.pots.BK.heaterOn ? states.pots.BK.efficiency : 0;
  const bkWatts = Math.round((bkEffective / 100) * BK_MAX_WATTS);
  const hltHeadroom = maxWatts - bkWatts;
  const hltCap = Math.floor(Math.max(0, Math.min(100, (hltHeadroom / HLT_MAX_WATTS) * 100)));
  const hltEffective = states.pots.HLT.heaterOn ? Math.min(states.pots.HLT.efficiency, hltCap) : 0;
  const hltWatts = Math.round((hltEffective / 100) * HLT_MAX_WATTS);
  const totalWatts = bkWatts + hltWatts;
  const isOverLimit = totalWatts > maxWatts;

  return (
    <div className={styles.brewingPanel}>
      {/* Power status bar */}
      <div className={styles.powerBar}>
        <span className={styles.powerBarLabel}>System Power</span>
        <div className={styles.powerBarTrack}>
          <div
            className={`${styles.powerBarFill} ${isOverLimit ? styles.powerBarOver : ''}`}
            style={{ width: `${Math.min(100, (totalWatts / maxWatts) * 100)}%` }}
          />
        </div>
        <span className={`${styles.powerBarValue} ${isOverLimit ? styles.powerBarOver : ''}`}>
          {totalWatts.toLocaleString()} / {maxWatts.toLocaleString()} W
        </span>
      </div>

      {/* Pot Cards Row - Strict order: BK, MLT, HLT */}
      <div className={styles.potRow}>
        <PotCard
          name="BK"
          type="BK"
          potState={states.pots.BK}
          regulationConfig={regulationConfig}
          effectiveEfficiency={bkEffective}
          potMaxWatts={BK_MAX_WATTS}
          efficiencyCap={bkCap}
          onUpdate={(updates) => handlePotUpdate('BK', updates)}
        />
        <PotCard
          name="MLT"
          type="MLT"
          potState={states.pots.MLT}
          regulationConfig={regulationConfig}
          effectiveEfficiency={0}
          potMaxWatts={0}
          efficiencyCap={100}
          onUpdate={() => {}}
        />
        <PotCard
          name="HLT"
          type="HLT"
          potState={states.pots.HLT}
          regulationConfig={regulationConfig}
          effectiveEfficiency={hltEffective}
          potMaxWatts={HLT_MAX_WATTS}
          efficiencyCap={hltCap}
          onUpdate={(updates) => handlePotUpdate('HLT', updates)}
        />
      </div>

      {/* Pump Cards Row with Brew Timer in the middle */}
      <div className={styles.pumpRow}>
        <PumpCard
          name="Pump 1"
          pumpState={states.pumps.P1}
          onUpdate={(updates) => handlePumpUpdate('P1', updates)}
        />
        <BrewTimer />
        <PumpCard
          name="Pump 2"
          pumpState={states.pumps.P2}
          onUpdate={(updates) => handlePumpUpdate('P2', updates)}
        />
      </div>
    </div>
  );
}

export default BrewingPanel;
