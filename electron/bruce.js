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
const fs = require('fs');
const http = require('http');
const https = require('https');
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
      fs.readFileSync(path.join(__dirname, 'bruce-system-prompt.txt'), 'utf-8').trim(),
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
      // Automatically enable regulation when setting a target temperature
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
      // Automatically turn on the pump when setting speed
      await apiCall('POST', `/api/hardware/pump/${pump}/power`, { on: true });
      await apiCall('POST', `/api/hardware/pump/${pump}/speed`, { value });
      return `Pump ${pump} turned on with speed set to ${value}%.`;
    }
  );

  // ── Brew timer ────────────────────────────────────────────────────────

  bruce.registerFunction(
    'control_timer',
    'Start, stop, or reset the brew timer. Use "start" to begin a stopwatch, "stop" to pause, "reset" to zero it out. To start a countdown timer from a specific duration, use "start" and provide hours/minutes/seconds (e.g. "start the timer from 60 minutes" or "start the timer at 2 minutes and 40 seconds").',
    {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'stop', 'reset'], description: 'Timer action' },
        hours: { type: 'number', description: 'Countdown hours (optional, only used with start)' },
        minutes: { type: 'number', description: 'Countdown minutes (optional, only used with start)' },
        seconds: { type: 'number', description: 'Countdown seconds (optional, only used with start)' },
      },
      required: ['action'],
    },
    async ({ action, hours = 0, minutes = 0, seconds = 0 }) => {
      const totalSeconds = Math.round(hours * 3600 + minutes * 60 + seconds);

      // If starting with a duration, set the countdown target first
      if (action === 'start' && totalSeconds > 0) {
        await apiCall('POST', '/api/hardware/timer', { action: 'set', seconds: totalSeconds });
        await apiCall('POST', '/api/hardware/timer', { action: 'start' });
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        const parts = [];
        if (h > 0) parts.push(`${h} hour${h !== 1 ? 's' : ''}`);
        if (m > 0) parts.push(`${m} minute${m !== 1 ? 's' : ''}`);
        if (s > 0) parts.push(`${s} second${s !== 1 ? 's' : ''}`);
        return `Countdown timer started from ${parts.join(' and ')}.`;
      }

      const res = await apiCall('POST', '/api/hardware/timer', { action });
      console.log('[Bruce] Timer API response:', JSON.stringify(res));
      const secs = res?.timer?.seconds ?? 0;
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      const timeStr = h > 0 ? `${h} hours ${m} minutes ${s} seconds` : m > 0 ? `${m} minutes ${s} seconds` : `${s} seconds`;
      if (action === 'reset') return 'Brew timer reset to zero.';
      if (action === 'stop') return `Brew timer stopped at ${timeStr}.`;
      return `Brew timer started at ${timeStr}.`;
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

  // ── Average temperature ────────────────────────────────────────────────

  bruce.registerFunction(
    'get_average_temperature',
    'Get the average temperature of a specific pot (BK, MLT, or HLT) over the last N minutes. If the requested time range exceeds available session data, the response will include the actual available range and the average will be computed over that range instead.',
    {
      type: 'object',
      properties: {
        pot: { type: 'string', enum: ['BK', 'MLT', 'HLT'], description: 'Which pot to get the average temperature for' },
        minutes: { type: 'number', description: 'Number of minutes to look back (e.g. 5 for last 5 minutes)' },
      },
      required: ['pot', 'minutes'],
    },
    async ({ pot, minutes }) => {
      const res = await apiCall('GET', `/api/temperature/average?pot=${pot}&minutes=${minutes}`);

      if (res.average == null) {
        if (res.minutes_available === 0) return 'No temperature data available yet for this session.';
        return `No ${pot} readings found in the last ${minutes} minute${minutes !== 1 ? 's' : ''}.`;
      }

      const capped = minutes > res.minutes_available;
      const rangeUsed = capped ? res.minutes_available : minutes;
      let reply = `The average ${pot} temperature over the last ${rangeUsed} minute${rangeUsed !== 1 ? 's' : ''} is ${res.average.toFixed(1)}°C (based on ${res.sample_count} readings).`;
      if (capped) {
        reply += ` Note: only ${res.minutes_available} minutes of session data were available, so that's the range used.`;
      }
      return reply;
    }
  );

  // ── Reminders ──────────────────────────────────────────────────────────

  const reminders = new Map();
  let reminderId = 0;

  bruce.registerFunction(
    'set_reminder',
    'Set a timed reminder. Bruce will speak the reminder after the specified delay. For example "remind me to add hops in 10 minutes" or "remind me to check the mash in 1 hour and 30 minutes".',
    {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'What to remind the user about' },
        hours: { type: 'number', description: 'Hours from now (default 0)' },
        minutes: { type: 'number', description: 'Minutes from now (default 0)' },
        seconds: { type: 'number', description: 'Seconds from now (default 0)' },
      },
      required: ['message'],
    },
    async ({ message, hours = 0, minutes = 0, seconds = 0 }) => {
      const totalMs = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
      if (totalMs <= 0) return 'Please specify a time in the future for the reminder.';

      const id = ++reminderId;
      const timer = setTimeout(() => {
        reminders.delete(id);
        console.log(`[Bruce] Reminder fired: ${message}`);
        bruce.speak(`[SYSTEM] A scheduled reminder has fired. You MUST say the following reminder out loud to the user, word for word. Do not say anything else, no greetings, no follow-ups. Just deliver the reminder: "${message}"`);
      }, totalMs);
      reminders.set(id, { message, timer });

      const parts = [];
      if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
      if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
      if (seconds > 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
      return `Reminder set: "${message}" in ${parts.join(' and ')}.`;
    }
  );

  // ── Keg status ────────────────────────────────────────────────────────

  const SHEETS_CSV_URL =
    'https://docs.google.com/spreadsheets/d/1c5CWo_-7lS9C0HSklylLVgFAT4OwADm2Svqfr9x28Do/export?format=csv&gid=0';

  function fetchCSV(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchCSV(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }

  function parseCSV(text) {
    const lines = text.split('\n').filter(Boolean);
    return lines.map((line) => {
      const cols = [];
      let cur = '';
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ',' && !inQuotes) { cols.push(cur.trim()); cur = ''; continue; }
        cur += ch;
      }
      cols.push(cur.trim());
      return cols;
    });
  }

  bruce.registerFunction(
    'get_keg_status',
    'Get the current status of all kegs — their contents, volume, date filled, notes, and ABV. Useful for checking what beer is on tap or how many kegs are filled. Set detail to "full" only if the user explicitly asks for every individual keg listed out.',
    {
      type: 'object',
      properties: {
        detail: { type: 'string', enum: ['summary', 'full'], description: 'Level of detail — "summary" groups kegs by type (default), "full" lists every keg individually' },
      },
      required: [],
    },
    async (args) => {
      try {
        const detail = (args && args.detail) || 'summary';
        const text = await fetchCSV(SHEETS_CSV_URL);
        const rows = parseCSV(text);
        const dataRows = rows.slice(2);
        const kegs = dataRows
          .map((cols) => ({
            number: cols[1] || '',
            contents: cols[2] || '',
            date: cols[3] || '',
            note: cols[4] || '',
            volume: cols[5] || '',
            abv: cols[6] || '',
          }))
          .filter((k) => k.number);

        const empty = kegs.filter((k) => ['???', 'Clean', 'Dirty'].includes(k.contents.trim()));
        const beerKegs = kegs.filter((k) => !['???', 'Clean', 'Dirty', 'Starsan'].includes(k.contents.trim()));

        if (detail === 'full') {
          const filled = kegs.filter((k) => k.contents.trim() !== '???');
          const lines = [`${filled.length} of ${kegs.length} kegs filled.`];
          for (const keg of kegs) {
            let desc = `Keg #${keg.number} (${keg.volume}): ${keg.contents}`;
            if (keg.abv) desc += `, ${keg.abv} ABV`;
            if (keg.date) desc += `, filled ${keg.date}`;
            if (keg.note) desc += ` — ${keg.note}`;
            lines.push(desc);
          }
          return lines.join('. ');
        }

        // Group beer kegs by contents
        const groups = {};
        for (const keg of beerKegs) {
          const key = keg.contents.trim();
          if (!groups[key]) groups[key] = [];
          groups[key].push(keg);
        }

        const lines = [`${beerKegs.length} kegs with beer out of ${kegs.length} total.`];

        for (const [type, typeKegs] of Object.entries(groups)) {
          const abvs = typeKegs.map((k) => k.abv).filter(Boolean);
          const abvStr = abvs.length ? ` at ${abvs[0]} ABV` : '';
          const kegNums = typeKegs.map((k) => `#${k.number}`).join(', ');
          lines.push(`${typeKegs.length} ${type}${abvStr} (${kegNums})`);
        }

        if (empty.length > 0) {
          lines.push(`${empty.length} empty or unassigned kegs.`);
        }

        return lines.join('. ');
      } catch (err) {
        console.error('[Bruce] Keg status error:', err);
        return `Sorry, I couldn't fetch the keg data: ${err.message}`;
      }
    }
  );

  // ── Logging ─────────────────────────────────────────────────────────────

  // Buffer the user transcript so it prints before Bruce's first reply,
  // even though Whisper delivers it asynchronously after Bruce starts responding.
  let pendingTranscript = null;

  const flushTranscript = () => {
    if (pendingTranscript) {
      console.log(`[You] ${pendingTranscript}`);
      pendingTranscript = null;
    }
  };

  bruce.on('ready', () => console.log('[Bruce] Ready — listening for wake word'));
  bruce.on('wake', () => console.log('[Bruce] Wake word detected'));
  bruce.on('listening', () => console.log('[Bruce] Listening...'));
  bruce.on('thinking', () => console.log('[Bruce] Thinking...'));
  bruce.on('speaking', () => console.log('[Bruce] Speaking...'));
  bruce.on('idle', () => console.log('[Bruce] Idle'));
  bruce.on('transcript', (text) => { pendingTranscript = text; });
  bruce.on('functionCall', (name, args) => {
    flushTranscript();
    console.log(`[Bruce] Function call: ${name}`, args);
  });
  bruce.on('reply', (text) => {
    flushTranscript();
    console.log(`[Bruce] ${text}`);
  });
  bruce.on('error', (err) => console.error('[Bruce] Error:', err));

  await bruce.start();
}

main().catch((err) => {
  console.error('[Bruce] Fatal error:', err);
  process.exit(1);
});
