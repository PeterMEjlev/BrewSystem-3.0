/**
 * Frontend fallback defaults, used only until /api/settings loads (or when
 * the backend is unreachable). The authoritative values live in config.json
 * (see config.default.json + AppSettings in backend/main.py) — keep these in
 * sync with those defaults.
 */

export const DEFAULT_BK_ELEMENT_WATTS = 8500;
export const DEFAULT_HLT_ELEMENT_WATTS = 5000;

const DEFAULT_BK_STEPS = [
  { threshold: 5,   power: 100 },
  { threshold: 2,   power: 60  },
  { threshold: 0.5, power: 30  },
  { threshold: 0,   power: 0   },
];

// HLT element is weaker so it ramps harder near the setpoint.
const DEFAULT_HLT_STEPS = [
  { threshold: 5,   power: 100 },
  { threshold: 2,   power: 75  },
  { threshold: 0.5, power: 45  },
  { threshold: 0,   power: 0   },
];

export const DEFAULT_AUTO_EFFICIENCY = {
  bk:  { enabled: true, steps: DEFAULT_BK_STEPS },
  hlt: { enabled: true, steps: DEFAULT_HLT_STEPS },
};

// Mirrors ScreenSleepSettings in backend/main.py — how long the kiosk display
// may sit untouched before it powers down. Only the panel sleeps; the backend
// keeps brewing, and an active rig (heater, pump or running timer) never sleeps.
export const DEFAULT_SCREEN_SLEEP = {
  enabled: true,
  timeout_seconds: 300,
};

// Mirrors HeatFaultSettings in backend/main.py — when an element that is
// switched on counts as "not actually heating". Only regulating pots more than
// min_headroom_c below their set value are judged.
export const DEFAULT_HEAT_FAULT = {
  enabled: true,
  timeout_seconds: 120,
  min_rise_c: 1.0,
  min_headroom_c: 5.0,
  min_efficiency: 25.0,
  renotify_seconds: 600,
};
