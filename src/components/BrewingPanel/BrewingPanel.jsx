import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { brewSystem } from '../../utils/mockHardware';
import { hardwareApi } from '../../utils/hardwareApi';
import { setPumpRampTarget, setPumpRampPower } from '../../utils/pumpRamp';
import { useSettings, FALLBACK_AUTO_EFFICIENCY } from '../../contexts/SettingsContext';
import { DEFAULT_BK_ELEMENT_WATTS, DEFAULT_HLT_ELEMENT_WATTS } from '../../utils/appDefaults';
import PotCard from './PotCard';
import PumpCard from './PumpCard';
import BrewTimer from './BrewTimer';
import styles from './BrewingPanel.module.css';

function BrewingPanel() {
  const { settings } = useSettings();
  const [states, setStates] = useState(brewSystem.getAllStates());
  const [timerState, setTimerState] = useState({ running: false, seconds: 0, target: 0 });
  const [priorityPot, setPriorityPot] = useState('BK');
  // Backend reachability — after several failed polls the readings on screen
  // are stale, which must be unmissable on a heater controller.
  // frozenSince holds the wall-clock time of the last successful sync,
  // snapshotted into state when the connection is declared lost.
  const [frozenSince, setFrozenSince] = useState(null);
  const pollFailures = useRef(0);
  const lastSyncRef = useRef(null);

  const autoEfficiency = settings?.app?.auto_efficiency ?? FALLBACK_AUTO_EFFICIENCY;
  const maxWatts = settings?.app?.max_watts ?? 11000;
  // Element wattages come from config.json via /api/settings — the backend
  // enforces the same values, these only drive the display/caps here.
  const BK_MAX_WATTS = settings?.app?.bk_element_watts ?? DEFAULT_BK_ELEMENT_WATTS;
  const HLT_MAX_WATTS = settings?.app?.hlt_element_watts ?? DEFAULT_HLT_ELEMENT_WATTS;
  const pollSeconds = settings?.app?.brewing_panel_poll_seconds ?? 1;
  // Per-pot regulation configs — each pot's effect deps will only fire when its own config changes.
  const bkRegConfig = useMemo(
    () => ({
      enabled: autoEfficiency.bk?.enabled ?? FALLBACK_AUTO_EFFICIENCY.bk.enabled,
      steps: autoEfficiency.bk?.steps ?? FALLBACK_AUTO_EFFICIENCY.bk.steps,
    }),
    [autoEfficiency.bk]
  );
  const hltRegConfig = useMemo(
    () => ({
      enabled: autoEfficiency.hlt?.enabled ?? FALLBACK_AUTO_EFFICIENCY.hlt.enabled,
      steps: autoEfficiency.hlt?.steps ?? FALLBACK_AUTO_EFFICIENCY.hlt.steps,
    }),
    [autoEfficiency.hlt]
  );

  // Read environment once on mount — avoids re-renders when localStorage changes
  const isProduction = useRef(
    localStorage.getItem('brewSystemEnvironment') !== 'development'
  ).current;

  // Dev mode: push live settings into the mock so auto-efficiency changes take
  // effect immediately — mirrors production, where the backend re-reads config
  // on every regulation tick.
  useEffect(() => {
    if (!isProduction) {
      brewSystem.setRegulationConfig({ BK: bkRegConfig, HLT: hltRegConfig });
    }
  }, [isProduction, bkRegConfig, hltRegConfig]);

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
  const elementWattsRef = useRef({ bk: BK_MAX_WATTS, hlt: HLT_MAX_WATTS });
  elementWattsRef.current = { bk: BK_MAX_WATTS, hlt: HLT_MAX_WATTS };

  useEffect(() => {
    // NOTE: no hardware initialization here. GPIO init happens once in the
    // backend's lifespan — a browser reload mid-brew must never kill heaters
    // or wipe the session log. On mount we only sync state from the backend.
    if (isProduction) {
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

    // Poll full state at the user-configured cadence (app.brewing_panel_poll_seconds,
    // default 1 s — matches the DS18B20 read loop) so external changes (e.g. Bruce
    // voice assistant) are reflected in the UI. Polling is skipped for 2 s after
    // the last user command to avoid stale responses overwriting optimistic state.
    const POLL_SUPPRESS_MS = 2000;
    const CONNECTION_LOST_AFTER = 3; // consecutive failed polls
    const interval = setInterval(async () => {
      if (isProduction) {
        if (Date.now() - lastCommandTime.current < POLL_SUPPRESS_MS) return;
        const state = await hardwareApi.getFullState();
        if (state) {
          pollFailures.current = 0;
          lastSyncRef.current = Date.now();
          setFrozenSince(null);
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
        } else {
          // Backend unreachable — after a few misses, warn loudly instead of
          // silently showing frozen readings on a device that drives heaters.
          pollFailures.current += 1;
          if (pollFailures.current >= CONNECTION_LOST_AFTER) {
            setFrozenSince((prev) => prev ?? lastSyncRef.current ?? Date.now());
          }
        }
      } else {
        // Sync full pot state from the mock — regulation now runs inside the
        // mock (mirroring the backend), so heaterOn/efficiency can change
        // without user input and must be reflected here.
        const mock = brewSystem.getAllStates();
        setStates((prev) => ({
          ...prev,
          pots: {
            BK:  { ...prev.pots.BK,  ...mock.pots.BK },
            MLT: { ...prev.pots.MLT, pv: mock.pots.MLT.pv },
            HLT: { ...prev.pots.HLT, ...mock.pots.HLT },
          },
        }));
      }
    }, pollSeconds * 1000);

    return () => clearInterval(interval);
  }, [isProduction, pollSeconds]);

  // Debounce timers for hardware API calls — prevents flooding the RPi backend
  const apiTimers = useRef({});
  const debouncedApi = useCallback((key, fn, delay = 80) => {
    clearTimeout(apiTimers.current[key]);
    apiTimers.current[key] = setTimeout(fn, delay);
  }, []);

  const handlePotUpdate = useCallback((potName, updates) => {
    lastCommandTime.current = Date.now();
    const s = statesRef.current;
    const mw = maxWattsRef.current;
    const { bk: bkMaxW, hlt: hltMaxW } = elementWattsRef.current;
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
      if (isProduction) debouncedApi(`sv-${potName}`, () => hardwareApi.setPotSv(potName, updates.sv));
    }
    // Compute yielding pot's clamped efficiency so we can batch it into one setState
    let yieldPot = null;
    let yieldEfficiency = null;
    const bothRegsOn = s.pots.BK.regulationEnabled && s.pots.HLT.regulationEnabled;
    if (updates.efficiency !== undefined) {
      brewSystem.setPotEfficiency(potName, updates.efficiency);
      // The pot whose efficiency the user just changed becomes the priority pot,
      // BUT when both REGs are on BK always keeps priority so they don't compete.
      if (potName === 'BK' || potName === 'HLT') {
        if (!bothRegsOn || potName === 'BK') setPriorityPot(potName);
      }
      if (isProduction) {
        debouncedApi(`eff-${potName}`, () => hardwareApi.setPotEfficiency(potName, updates.efficiency));
        // Throttle the non-priority (yielding) pot to stay within the remaining headroom.
        // When both REGs are on, BK always has priority — HLT always yields.
        if (potName === 'BK' && s.pots.HLT.heaterOn) {
          const usedByBk = (s.pots.BK.heaterOn ? updates.efficiency : 0) / 100 * bkMaxW;
          const newHltCap = Math.max(0, Math.min(100, ((mw - usedByBk) / hltMaxW) * 100));
          const clamped = Math.min(s.pots.HLT.efficiency, newHltCap);
          debouncedApi('eff-HLT', () => hardwareApi.setPotEfficiency('HLT', clamped));
          yieldPot = 'HLT';
          yieldEfficiency = clamped;
        } else if (potName === 'HLT' && s.pots.BK.heaterOn) {
          if (bothRegsOn) {
            // BK has priority: cap HLT based on BK's current usage
            const usedByBk = s.pots.BK.efficiency / 100 * bkMaxW;
            const newHltCap = Math.max(0, Math.min(100, ((mw - usedByBk) / hltMaxW) * 100));
            const clamped = Math.min(updates.efficiency, newHltCap);
            debouncedApi(`eff-${potName}`, () => hardwareApi.setPotEfficiency('HLT', clamped));
            // Update the efficiency we're applying to be the clamped value
            updates = { ...updates, efficiency: clamped };
          } else {
            const usedByHlt = (s.pots.HLT.heaterOn ? updates.efficiency : 0) / 100 * hltMaxW;
            const newBkCap = Math.max(0, Math.min(100, ((mw - usedByHlt) / bkMaxW) * 100));
            const clamped = Math.min(s.pots.BK.efficiency, newBkCap);
            debouncedApi('eff-BK', () => hardwareApi.setPotEfficiency('BK', clamped));
            yieldPot = 'BK';
            yieldEfficiency = clamped;
          }
        }
      }
    }
    // When a heater is toggled, resync the yielding pot's efficiency to hardware
    if (isProduction && (potName === 'BK' || potName === 'HLT') && updates.heaterOn !== undefined) {
      const newBkOn = potName === 'BK' ? updates.heaterOn : s.pots.BK.heaterOn;
      const newHltOn = potName === 'HLT' ? updates.heaterOn : s.pots.HLT.heaterOn;
      if (pp === 'BK' && newHltOn) {
        const usedByBk = (newBkOn ? s.pots.BK.efficiency : 0) / 100 * bkMaxW;
        const newHltCap = Math.max(0, Math.min(100, ((mw - usedByBk) / hltMaxW) * 100));
        hardwareApi.setPotEfficiency('HLT', Math.min(s.pots.HLT.efficiency, newHltCap));
      } else if (pp === 'HLT' && newBkOn) {
        const usedByHlt = (newHltOn ? s.pots.HLT.efficiency : 0) / 100 * hltMaxW;
        const newBkCap = Math.max(0, Math.min(100, ((mw - usedByHlt) / bkMaxW) * 100));
        hardwareApi.setPotEfficiency('BK', Math.min(s.pots.BK.efficiency, newBkCap));
      }
    }
    // Apply updates immutably so React and memo comparators see the change.
    // In production, also batch the yielding pot's clamped efficiency.
    setStates((prev) => {
      const next = {
        ...prev,
        pots: { ...prev.pots, [potName]: { ...prev.pots[potName], ...updates } },
      };
      if (isProduction && yieldPot && yieldEfficiency !== null) {
        next.pots = { ...next.pots, [yieldPot]: { ...next.pots[yieldPot], efficiency: yieldEfficiency } };
      }
      return next;
    });
  }, [isProduction, debouncedApi]);

  const handlePumpUpdate = useCallback((pumpName, updates) => {
    lastCommandTime.current = Date.now();
    if (updates.speed !== undefined) {
      setPumpRampTarget(pumpName, updates.speed);
    }
    if (updates.on !== undefined) {
      brewSystem.setPump(pumpName, updates.on);
      if (isProduction) hardwareApi.setPumpPower(pumpName, updates.on);
      setPumpRampPower(pumpName, updates.on);
    }
    setStates((prev) => ({
      ...prev,
      pumps: { ...prev.pumps, [pumpName]: { ...prev.pumps[pumpName], ...updates } },
    }));
  }, [isProduction]);

  // Derive effective (throttled) power and slider caps — priority pot gets its requested
  // efficiency; the other pot yields to fit within the remaining headroom.
  // When both REGs are on, BK always has priority so HLT yields.
  const bothRegsOn = states.pots.BK.regulationEnabled && states.pots.HLT.regulationEnabled;
  const effectivePriority = bothRegsOn ? 'BK' : priorityPot;
  let bkCap, hltCap, bkEffective, hltEffective, bkWatts, hltWatts;
  if (effectivePriority === 'HLT') {
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
      {frozenSince != null && (
        <div className={styles.connectionBanner}>
          ⚠ Backend unreachable — readings frozen since{' '}
          {new Date(frozenSince).toLocaleTimeString([], { hour12: false })}. Controls are inactive.
        </div>
      )}
      {/* Pot Cards Row - Strict order: BK, MLT, HLT */}
      <div className={styles.potRow}>
        <PotCard
          name="BK"
          type="BK"
          potState={states.pots.BK}
          regulationConfig={bkRegConfig}
          effectiveEfficiency={bkEffective}
          potMaxWatts={BK_MAX_WATTS}
          efficiencyCap={bkCap}
          onUpdate={onUpdateBK}
        />
        <PotCard
          name="MLT"
          type="MLT"
          potState={states.pots.MLT}
          regulationConfig={bkRegConfig}
          effectiveEfficiency={0}
          potMaxWatts={0}
          efficiencyCap={100}
          onUpdate={onUpdateMLT}
        />
        <PotCard
          name="HLT"
          type="HLT"
          potState={states.pots.HLT}
          regulationConfig={hltRegConfig}
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
