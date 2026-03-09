/**
 * Bruce voice assistant integration.
 *
 * Runs as a standalone Node.js process (not inside Electron) to avoid
 * native-addon ABI mismatches with speaker / porcupine.
 *
 * Spawned by electron/main.js once the backend is ready.
 */
'use strict';

require('dotenv').config();
const http = require('http');
const path = require('path');
const BruceAssistant = require('bruce-assistant');

const BACKEND_URL = 'http://localhost:8000';

// ── Helper: call the Python backend REST API ────────────────────────────────

function apiCall(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BACKEND_URL);
    const payload = body ? JSON.stringify(body) : null;

    const req = http.request(url, {
      method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : {},
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Format helpers for voice responses ──────────────────────────────────────

function formatTemp(value) {
  return value != null ? `${value.toFixed(1)}°C` : 'unavailable';
}

// ── Create and configure Bruce ──────────────────────────────────────────────

async function main() {
  const bruce = new BruceAssistant({
    picovoiceKey: process.env.PICOVOICE_ACCESS_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    wakeWordPath: process.env.WAKE_WORD_PATH || path.join(__dirname, '..', '..', 'Bruce-v2', 'wake-words', 'Bruce_en_windows_v3_0_0.ppn'),
    voice: process.env.BRUCE_VOICE || 'alloy',
    systemPrompt: process.env.BRUCE_SYSTEM_PROMPT ||
      'You are Bruce, a helpful AI assistant for a home brewing setup. Keep responses concise and conversational — you are speaking, not writing. You can control the BK (boil kettle) and HLT (hot liquor tank) heaters, read temperatures from BK, MLT (mash/lauter tun), and HLT sensors, and control pumps P1 and P2. IMPORTANT: When a request requires multiple actions (e.g. "turn on BK at 50%"), you MUST call ALL relevant functions — for example, call both set_pot_power and set_pot_efficiency. Never skip a function call. Turning on a pot with an efficiency always requires both set_pot_power and set_pot_efficiency.',
  });

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
      return `${pot} target temperature set to ${value}°C.`;
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
      // Automatically turn on the pot when setting efficiency
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
      await apiCall('POST', `/api/hardware/pump/${pump}/speed`, { value });
      return `Pump ${pump} speed set to ${value}%.`;
    }
  );

  // ── Logging ─────────────────────────────────────────────────────────────

  bruce.on('ready', () => console.log('[Bruce] Ready — listening for wake word'));
  bruce.on('wake', () => console.log('[Bruce] Wake word detected'));
  bruce.on('listening', () => console.log('[Bruce] Listening...'));
  bruce.on('thinking', () => console.log('[Bruce] Thinking...'));
  bruce.on('speaking', () => console.log('[Bruce] Speaking...'));
  bruce.on('idle', () => console.log('[Bruce] Idle'));
  bruce.on('transcript', (text) => console.log(`[Bruce] Transcript: ${text}`));
  bruce.on('functionCall', (name, args) => console.log(`[Bruce] Function call: ${name}`, args));
  bruce.on('error', (err) => console.error('[Bruce] Error:', err));

  await bruce.start();
}

main().catch((err) => {
  console.error('[Bruce] Fatal error:', err);
  process.exit(1);
});
