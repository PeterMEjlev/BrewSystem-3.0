import { brewSystem } from './mockHardware';
import { hardwareApi } from './hardwareApi';

const RAMP_RATE_PCT_PER_SEC = 50;
const STEP_INTERVAL_MS = 40;
const STEP_PCT = (RAMP_RATE_PCT_PER_SEC * STEP_INTERVAL_MS) / 1000;

const isProduction = () =>
  localStorage.getItem('brewSystemEnvironment') !== 'development';

const state = {
  P1: { current: 0, target: 0, isOn: false, interval: null },
  P2: { current: 0, target: 0, isOn: false, interval: null },
};

function send(pumpName, value) {
  const v = Math.round(value);
  brewSystem.setPumpSpeed(pumpName, v);
  if (isProduction()) hardwareApi.setPumpSpeed(pumpName, v);
}

function clearRamp(pumpName) {
  const s = state[pumpName];
  if (s.interval) {
    clearInterval(s.interval);
    s.interval = null;
  }
}

function startRamp(pumpName) {
  const s = state[pumpName];
  if (s.interval) return;
  s.interval = setInterval(() => {
    const diff = s.target - s.current;
    if (Math.abs(diff) <= STEP_PCT) {
      s.current = s.target;
      send(pumpName, s.current);
      clearRamp(pumpName);
      return;
    }
    s.current += Math.sign(diff) * STEP_PCT;
    send(pumpName, s.current);
  }, STEP_INTERVAL_MS);
}

export function setPumpRampTarget(pumpName, target) {
  const s = state[pumpName];
  if (!s) return;
  s.target = target;
  if (!s.isOn) return;
  if (target === 0) {
    clearRamp(pumpName);
    s.current = 0;
    send(pumpName, 0);
    return;
  }
  if (s.current === target) {
    clearRamp(pumpName);
    return;
  }
  startRamp(pumpName);
}

export function setPumpRampPower(pumpName, on) {
  const s = state[pumpName];
  if (!s) return;
  s.isOn = on;
  clearRamp(pumpName);
  s.current = 0;
  send(pumpName, 0);
  if (on && s.target > 0) startRamp(pumpName);
}
