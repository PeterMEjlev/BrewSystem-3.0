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
