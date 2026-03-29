import { useState, useEffect, useRef, useCallback } from 'react';
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
  const [timerState, setTimerState] = useState({ running: false, seconds: 0, target: 0 });
  const [regulationConfig, setRegulationConfig] = useState(DEFAULT_REG_CONFIG);
  const [maxWatts, setMaxWatts] = useState(11000);
  const [priorityPot, setPriorityPot] = useState('BK');

  // Read environment once on mount — avoids re-renders when localStorage changes
  const isProduction = useRef(
    localStorage.getItem('brewSystemEnvironment') !== 'development'
  ).current;

  // Timestamp of the last user-initiated command.  Polling is suppressed for a
  // short window after a command so that stale backend responses cannot
  // overwrite the optimistic local state.
  const lastCommandTime = useRef(0);

  // Keep a ref to current state so stable callbacks can read fresh values
  // without appearing in useCallback dependency arrays.
  const statesRef = useRef(states);
  statesRef.current = states;
  const priorityPotRef = useRef(priorityPot);
  priorityPotRef.current = priorityPot;
  const maxWattsRef = useRef(maxWatts);
  maxWattsRef.current = maxWatts;

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
      // Sync control state from backend once on mount
      hardwareApi.getFullState().then((state) => {
        if (state) {
          setStates((prev) => ({
            pots: {
              BK:  { ...prev.pots.BK,  pv: state.temperatures.bk,  ...state.controlState.pots.BK  },
              MLT: { ...prev.pots.MLT, pv: state.temperatures.mlt },
              HLT: { ...prev.pots.HLT, pv: state.temperatures.hlt, ...state.controlState.pots.HLT },
            },
            pumps: {
              P1: { ...prev.pumps.P1, ...state.controlState.pumps.P1 },
              P2: { ...prev.pumps.P2, ...state.controlState.pumps.P2 },
            },
          }));
        }
      });
    }

    // Poll full state every 1500ms so external changes (e.g. Bruce voice
    // assistant) are reflected in the UI.  Sensors update every ~2-3 s on the
    // Pi so polling faster than that is wasted CPU.  Polling is skipped for
    // 2 s after the last user command to avoid stale responses overwriting
    // optimistic state.
    const POLL_SUPPRESS_MS = 2000;
    const interval = setInterval(async () => {
      if (isProduction) {
        if (Date.now() - lastCommandTime.current < POLL_SUPPRESS_MS) return;
        const state = await hardwareApi.getFullState();
        if (state) {
          // If a command was sent while the request was in-flight, discard this
          // response — it may contain stale control state.
          if (Date.now() - lastCommandTime.current < POLL_SUPPRESS_MS) return;
          setStates((prev) => ({
            pots: {
              BK:  { ...prev.pots.BK,  pv: state.temperatures.bk,  ...state.controlState.pots.BK  },
              MLT: { ...prev.pots.MLT, pv: state.temperatures.mlt },
              HLT: { ...prev.pots.HLT, pv: state.temperatures.hlt, ...state.controlState.pots.HLT },
            },
            pumps: {
              P1: { ...prev.pumps.P1, ...state.controlState.pumps.P1 },
              P2: { ...prev.pumps.P2, ...state.controlState.pumps.P2 },
            },
          }));
          if (state.timer) setTimerState(state.timer);
        }
      } else {
        setStates(brewSystem.getAllStates());
      }
    }, 1500);

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

  const handlePotUpdate = useCallback((potName, updates) => {
    lastCommandTime.current = Date.now();
    const s = statesRef.current;
    const mw = maxWattsRef.current;
    const pp = priorityPotRef.current;
    if (updates.heaterOn !== undefined) {
      brewSystem.setPotHeater(potName, updates.heaterOn);
      if (isProduction) hardwareApi.setPotPower(potName, updates.heaterOn);
    }
    if (updates.regulationEnabled !== undefined) {
      brewSystem.setPotRegulation(potName, updates.regulationEnabled);
      if (isProduction) hardwareApi.setPotRegulation(potName, updates.regulationEnabled);
    }
    if (updates.sv !== undefined) {
      brewSystem.setPotSetValue(potName, updates.sv);
      if (isProduction) hardwareApi.setPotSv(potName, updates.sv);
    }
    if (updates.efficiency !== undefined) {
      brewSystem.setPotEfficiency(potName, updates.efficiency);
      // The pot whose efficiency the user just changed becomes the priority pot
      if (potName === 'BK' || potName === 'HLT') setPriorityPot(potName);
      if (isProduction) {
        hardwareApi.setPotEfficiency(potName, updates.efficiency);
        // Throttle the non-priority (yielding) pot to stay within the remaining headroom
        if (potName === 'BK' && s.pots.HLT.heaterOn) {
          const usedByBk = (s.pots.BK.heaterOn ? updates.efficiency : 0) / 100 * BK_MAX_WATTS;
          const newHltCap = Math.max(0, Math.min(100, ((mw - usedByBk) / HLT_MAX_WATTS) * 100));
          hardwareApi.setPotEfficiency('HLT', Math.min(s.pots.HLT.efficiency, newHltCap));
        } else if (potName === 'HLT' && s.pots.BK.heaterOn) {
          const usedByHlt = (s.pots.HLT.heaterOn ? updates.efficiency : 0) / 100 * HLT_MAX_WATTS;
          const newBkCap = Math.max(0, Math.min(100, ((mw - usedByHlt) / BK_MAX_WATTS) * 100));
          hardwareApi.setPotEfficiency('BK', Math.min(s.pots.BK.efficiency, newBkCap));
        }
      }
    }
    // When a heater is toggled, resync the yielding pot's efficiency to hardware
    if (isProduction && (potName === 'BK' || potName === 'HLT') && updates.heaterOn !== undefined) {
      const newBkOn = potName === 'BK' ? updates.heaterOn : s.pots.BK.heaterOn;
      const newHltOn = potName === 'HLT' ? updates.heaterOn : s.pots.HLT.heaterOn;
      if (pp === 'BK' && newHltOn) {
        const usedByBk = (newBkOn ? s.pots.BK.efficiency : 0) / 100 * BK_MAX_WATTS;
        const newHltCap = Math.max(0, Math.min(100, ((mw - usedByBk) / HLT_MAX_WATTS) * 100));
        hardwareApi.setPotEfficiency('HLT', Math.min(s.pots.HLT.efficiency, newHltCap));
      } else if (pp === 'HLT' && newBkOn) {
        const usedByHlt = (newHltOn ? s.pots.HLT.efficiency : 0) / 100 * HLT_MAX_WATTS;
        const newBkCap = Math.max(0, Math.min(100, ((mw - usedByHlt) / BK_MAX_WATTS) * 100));
        hardwareApi.setPotEfficiency('BK', Math.min(s.pots.BK.efficiency, newBkCap));
      }
    }
    if (isProduction) {
      setStates((prev) => ({
        ...prev,
        pots: { ...prev.pots, [potName]: { ...prev.pots[potName], ...updates } },
      }));
    } else {
      setStates(mergeWithRealPv);
    }
  }, [isProduction]);

  const handlePumpUpdate = useCallback((pumpName, updates) => {
    lastCommandTime.current = Date.now();
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
  }, [isProduction]);

  // Derive effective (throttled) power and slider caps — priority pot gets its requested
  // efficiency; the other pot yields to fit within the remaining headroom.
  let bkCap, hltCap, bkEffective, hltEffective, bkWatts, hltWatts;
  if (priorityPot === 'HLT') {
    hltCap      = Math.floor(Math.min(100, (maxWatts / HLT_MAX_WATTS) * 100));
    hltEffective = states.pots.HLT.heaterOn ? states.pots.HLT.efficiency : 0;
    hltWatts    = Math.round((hltEffective / 100) * HLT_MAX_WATTS);
    bkCap       = Math.floor(Math.max(0, Math.min(100, ((maxWatts - hltWatts) / BK_MAX_WATTS) * 100)));
    bkEffective  = states.pots.BK.heaterOn ? Math.min(states.pots.BK.efficiency, bkCap) : 0;
    bkWatts     = Math.round((bkEffective / 100) * BK_MAX_WATTS);
  } else {
    // BK has priority (default)
    bkCap       = Math.floor(Math.min(100, (maxWatts / BK_MAX_WATTS) * 100));
    bkEffective  = states.pots.BK.heaterOn ? states.pots.BK.efficiency : 0;
    bkWatts     = Math.round((bkEffective / 100) * BK_MAX_WATTS);
    hltCap      = Math.floor(Math.max(0, Math.min(100, ((maxWatts - bkWatts) / HLT_MAX_WATTS) * 100)));
    hltEffective = states.pots.HLT.heaterOn ? Math.min(states.pots.HLT.efficiency, hltCap) : 0;
    hltWatts    = Math.round((hltEffective / 100) * HLT_MAX_WATTS);
  }
  const totalWatts = bkWatts + hltWatts;
  const isOverLimit = totalWatts > maxWatts;

  // Stable per-device callbacks — identity never changes so memo'd children skip re-renders
  const onUpdateBK = useCallback((updates) => handlePotUpdate('BK', updates), [handlePotUpdate]);
  const onUpdateMLT = useCallback(() => {}, []);
  const onUpdateHLT = useCallback((updates) => handlePotUpdate('HLT', updates), [handlePotUpdate]);
  const onUpdateP1 = useCallback((updates) => handlePumpUpdate('P1', updates), [handlePumpUpdate]);
  const onUpdateP2 = useCallback((updates) => handlePumpUpdate('P2', updates), [handlePumpUpdate]);

  return (
    <div className={styles.brewingPanel}>
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
          onUpdate={onUpdateBK}
        />
        <PotCard
          name="MLT"
          type="MLT"
          potState={states.pots.MLT}
          regulationConfig={regulationConfig}
          effectiveEfficiency={0}
          potMaxWatts={0}
          efficiencyCap={100}
          onUpdate={onUpdateMLT}
        />
        <PotCard
          name="HLT"
          type="HLT"
          potState={states.pots.HLT}
          regulationConfig={regulationConfig}
          effectiveEfficiency={hltEffective}
          potMaxWatts={HLT_MAX_WATTS}
          efficiencyCap={hltCap}
          onUpdate={onUpdateHLT}
        />
      </div>

      {/* Pump Cards Row with Brew Timer in the middle */}
      <div className={styles.pumpRow}>
        <PumpCard
          name="Pump 1"
          pumpState={states.pumps.P1}
          onUpdate={onUpdateP1}
        />
        <BrewTimer timerState={timerState} isProduction={isProduction} />
        <PumpCard
          name="Pump 2"
          pumpState={states.pumps.P2}
          onUpdate={onUpdateP2}
        />
      </div>

      {/* Power readout */}
      <span className={`${styles.powerText} ${isOverLimit ? styles.powerTextOver : ''}`}>
        {totalWatts.toLocaleString()} / {maxWatts.toLocaleString()} W
      </span>
    </div>
  );
}

export default BrewingPanel;
