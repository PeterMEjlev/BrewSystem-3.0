/**
 * Hardware API wrapper for production (Raspberry Pi) mode.
 * All functions are fire-and-forget — errors are logged but never thrown
 * so the UI never breaks if the backend is unreachable.
 */

const post = async (path, body) => {
  try {
    await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(`Hardware API error [POST ${path}]:`, e);
  }
};

export const hardwareApi = {
  /** Initialize all GPIO pins to LOW on the Pi */
  initialize: () =>
    post('/api/hardware/initialize'),

  /** Turn a pot heating relay on or off. pot = 'BK' | 'HLT' */
  setPotPower: (pot, on) =>
    post(`/api/hardware/pot/${pot}/power`, { on }),

  /** Set heating element PWM duty cycle (0–100). pot = 'BK' | 'HLT' */
  setPotEfficiency: (pot, value) =>
    post(`/api/hardware/pot/${pot}/efficiency`, { value }),

  /** Turn a pump relay on or off. pump = 'P1' | 'P2' */
  setPumpPower: (pump, on) =>
    post(`/api/hardware/pump/${pump}/power`, { on }),

  /** Set pump PWM duty cycle (0–100). pump = 'P1' | 'P2' */
  setPumpSpeed: (pump, value) =>
    post(`/api/hardware/pump/${pump}/speed`, { value }),

  /** Set pot target temperature. pot = 'BK' | 'HLT' */
  setPotSv: (pot, value) =>
    post(`/api/hardware/pot/${pot}/sv`, { value }),

  /** Enable or disable auto-regulation. pot = 'BK' | 'HLT' */
  setPotRegulation: (pot, enabled) =>
    post(`/api/hardware/pot/${pot}/regulation`, { enabled }),

  /** Read temperatures + full control state. Returns { temperatures, controlState } or null */
  getFullState: () =>
    fetch('/api/hardware/state')
      .then((r) => r.json())
      .catch(() => null),

  /** Read all three DS18B20 sensors. Returns { bk, mlt, hlt } or null on error */
  getTemperatures: () =>
    fetch('/api/hardware/temperature')
      .then((r) => r.json())
      .catch(() => null),

  /** Fetch full session temperature history. Returns array of { timestamp, bk, mlt, hlt } or [] on error */
  getTemperatureHistory: () =>
    fetch('/api/temperature/history')
      .then((r) => r.json())
      .catch(() => []),
};
