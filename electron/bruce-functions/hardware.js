'use strict';

// ── Format helpers ──────────────────────────────────────────────────────────

function formatTemp(value) {
  return value != null ? `${value.toFixed(1)}°C` : 'unavailable';
}

// ── Register hardware-related functions on Bruce ────────────────────────────

function register(bruce, apiCall) {
  // ── Temperature reading ─────────────────────────────────────────────────

  bruce.registerFunction(
    'get_temperatures',
    'Get current temperature readings from all three sensors (BK, MLT, HLT)',
    { type: 'object', properties: {}, required: [] },
    async () => {
      const temps = await apiCall('GET', '/api/hardware/temperature');
      return `BK: ${formatTemp(temps.bk)}, MLT: ${formatTemp(temps.mlt)}, HLT: ${formatTemp(temps.hlt)}`;
    }
  );

  // ── Full state ──────────────────────────────────────────────────────────

  bruce.registerFunction(
    'get_full_state',
    'Get full system state including temperatures, heater status, and pump status',
    { type: 'object', properties: {}, required: [] },
    async () => {
      const state = await apiCall('GET', '/api/hardware/state');
      const t = state.temperatures || {};
      const cs = state.controlState || {};
      const pots = cs.pots || {};
      const pumps = cs.pumps || {};

      const lines = [];
      lines.push(`Temperatures — BK: ${formatTemp(t.bk)}, MLT: ${formatTemp(t.mlt)}, HLT: ${formatTemp(t.hlt)}`);

      for (const pot of ['BK', 'HLT']) {
        const p = pots[pot] || {};
        lines.push(`${pot}: heater ${p.heaterOn ? 'ON' : 'OFF'}, target ${p.sv ?? '?'}°C, efficiency ${p.efficiency ?? '?'}%, regulation ${p.regulationEnabled ? 'ON' : 'OFF'}`);
      }

      for (const pump of ['P1', 'P2']) {
        const pm = pumps[pump] || {};
        lines.push(`${pump}: ${pm.on ? 'ON' : 'OFF'}, speed ${pm.speed ?? '?'}%`);
      }

      return lines.join('. ');
    }
  );

  // ── Pot power ───────────────────────────────────────────────────────────

  bruce.registerFunction(
    'set_pot_power',
    'Turn a heating pot ON or OFF. Pot must be BK (boil kettle) or HLT (hot liquor tank).',
    {
      type: 'object',
      properties: {
        pot: { type: 'string', enum: ['BK', 'HLT'], description: 'Which pot' },
        on: { type: 'boolean', description: 'true to turn on, false to turn off' },
      },
      required: ['pot', 'on'],
    },
    async ({ pot, on }) => {
      await apiCall('POST', `/api/hardware/pot/${pot}/power`, { on });
      return `${pot} heater turned ${on ? 'ON' : 'OFF'}.`;
    }
  );

  // ── Pot target temperature ──────────────────────────────────────────────

  bruce.registerFunction(
    'set_pot_target_temperature',
    'Set the target temperature (set value) for a pot. Range 0–100°C.',
    {
      type: 'object',
      properties: {
        pot: { type: 'string', enum: ['BK', 'HLT'], description: 'Which pot' },
        value: { type: 'number', description: 'Target temperature in °C (0–100)' },
      },
      required: ['pot', 'value'],
    },
    async ({ pot, value }) => {
      await apiCall('POST', `/api/hardware/pot/${pot}/sv`, { value });
      await apiCall('POST', `/api/hardware/pot/${pot}/regulation`, { enabled: true });
      return `${pot} target temperature set to ${value}°C with regulation enabled.`;
    }
  );

  // ── Pot efficiency ──────────────────────────────────────────────────────

  bruce.registerFunction(
    'set_pot_efficiency',
    'Set the heating element power/efficiency (PWM duty cycle) for a pot. Range 0–100%.',
    {
      type: 'object',
      properties: {
        pot: { type: 'string', enum: ['BK', 'HLT'], description: 'Which pot' },
        value: { type: 'number', description: 'Efficiency percentage (0–100)' },
      },
      required: ['pot', 'value'],
    },
    async ({ pot, value }) => {
      await apiCall('POST', `/api/hardware/pot/${pot}/power`, { on: true });
      await apiCall('POST', `/api/hardware/pot/${pot}/efficiency`, { value });
      return `${pot} turned on with efficiency set to ${value}%.`;
    }
  );

  // ── Pot regulation ──────────────────────────────────────────────────────

  bruce.registerFunction(
    'set_pot_regulation',
    'Enable or disable automatic temperature regulation for a pot. When enabled, the system automatically adjusts heating power to reach the target temperature.',
    {
      type: 'object',
      properties: {
        pot: { type: 'string', enum: ['BK', 'HLT'], description: 'Which pot' },
        enabled: { type: 'boolean', description: 'true to enable, false to disable' },
      },
      required: ['pot', 'enabled'],
    },
    async ({ pot, enabled }) => {
      await apiCall('POST', `/api/hardware/pot/${pot}/regulation`, { enabled });
      return `${pot} auto-regulation ${enabled ? 'enabled' : 'disabled'}.`;
    }
  );

  // ── Pump power ──────────────────────────────────────────────────────────

  bruce.registerFunction(
    'set_pump_power',
    'Turn a pump ON or OFF. Pump must be P1 or P2.',
    {
      type: 'object',
      properties: {
        pump: { type: 'string', enum: ['P1', 'P2'], description: 'Which pump' },
        on: { type: 'boolean', description: 'true to turn on, false to turn off' },
      },
      required: ['pump', 'on'],
    },
    async ({ pump, on }) => {
      await apiCall('POST', `/api/hardware/pump/${pump}/power`, { on });
      return `Pump ${pump} turned ${on ? 'ON' : 'OFF'}.`;
    }
  );

  // ── Pump speed ──────────────────────────────────────────────────────────

  bruce.registerFunction(
    'set_pump_speed',
    'Set the speed of a pump. Range 0–100%.',
    {
      type: 'object',
      properties: {
        pump: { type: 'string', enum: ['P1', 'P2'], description: 'Which pump' },
        value: { type: 'number', description: 'Speed percentage (0–100)' },
      },
      required: ['pump', 'value'],
    },
    async ({ pump, value }) => {
      await apiCall('POST', `/api/hardware/pump/${pump}/power`, { on: true });
      await apiCall('POST', `/api/hardware/pump/${pump}/speed`, { value });
      return `Pump ${pump} turned on with speed set to ${value}%.`;
    }
  );

  // ── Power draw ─────────────────────────────────────────────────────────

  const BK_MAX_WATTS = 8500;
  const HLT_MAX_WATTS = 5000;

  bruce.registerFunction(
    'get_power_draw',
    'Get the current power draw (watts) of the system, broken down by BK and HLT.',
    { type: 'object', properties: {}, required: [] },
    async () => {
      const state = await apiCall('GET', '/api/hardware/state');
      const pots = state.controlState?.pots || {};
      const bk = pots.BK || {};
      const hlt = pots.HLT || {};
      const bkWatts = bk.heaterOn ? Math.round((bk.efficiency / 100) * BK_MAX_WATTS) : 0;
      const hltWatts = hlt.heaterOn ? Math.round((hlt.efficiency / 100) * HLT_MAX_WATTS) : 0;
      const total = bkWatts + hltWatts;
      return `Total power draw: ${total.toLocaleString()} watts. BK: ${bkWatts.toLocaleString()} W, HLT: ${hltWatts.toLocaleString()} W.`;
    }
  );
}

module.exports = { register };
