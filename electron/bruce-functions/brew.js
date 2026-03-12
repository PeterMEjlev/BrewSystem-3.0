'use strict';

const https = require('https');

// ── CSV helpers for keg data ────────────────────────────────────────────────

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

// ── Register brew-related functions on Bruce ────────────────────────────────

function register(bruce, apiCall) {
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

  // ── Keg status ────────────────────────────────────────────────────────

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
}

module.exports = { register };
