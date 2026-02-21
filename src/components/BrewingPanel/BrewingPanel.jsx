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

function BrewingPanel() {
  const [states, setStates] = useState(brewSystem.getAllStates());
  const [regulationConfig, setRegulationConfig] = useState(DEFAULT_REG_CONFIG);

  // Read environment once on mount — avoids re-renders when localStorage changes
  const isProduction = useRef(
    localStorage.getItem('brewSystemEnvironment') === 'production'
  ).current;

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => { if (s?.app?.auto_efficiency) setRegulationConfig(s.app.auto_efficiency); })
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
      if (isProduction) hardwareApi.setPotEfficiency(potName, updates.efficiency);
    }
    // Force immediate update from mock (for UI state)
    setStates(brewSystem.getAllStates());
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
    // Force immediate update from mock (for UI state)
    setStates(brewSystem.getAllStates());
  };

  return (
    <div className={styles.brewingPanel}>
      {/* Pot Cards Row - Strict order: BK, MLT, HLT */}
      <div className={styles.potRow}>
        <PotCard
          name="BK"
          type="BK"
          potState={states.pots.BK}
          regulationConfig={regulationConfig}
          onUpdate={(updates) => handlePotUpdate('BK', updates)}
        />
        <PotCard
          name="MLT"
          type="MLT"
          potState={states.pots.MLT}
          regulationConfig={regulationConfig}
          onUpdate={() => {}}
        />
        <PotCard
          name="HLT"
          type="HLT"
          potState={states.pots.HLT}
          regulationConfig={regulationConfig}
          onUpdate={(updates) => handlePotUpdate('HLT', updates)}
        />
      </div>

      {/* Brew Timer */}
      <div className={styles.timerRow}>
        <BrewTimer />
      </div>

      {/* Pump Cards Row */}
      <div className={styles.pumpRow}>
        <PumpCard
          name="Pump 1"
          pumpState={states.pumps.P1}
          onUpdate={(updates) => handlePumpUpdate('P1', updates)}
        />
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
