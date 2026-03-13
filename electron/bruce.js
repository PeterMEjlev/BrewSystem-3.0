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
const path = require('path');
const BruceAssistant = require('bruce-assistant');

const hardwareFunctions = require('./bruce-functions/hardware');
const brewFunctions = require('./bruce-functions/brew');
const toolFunctions = require('./bruce-functions/tools');

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

  // ── Register all function categories ──────────────────────────────────

  hardwareFunctions.register(bruce, apiCall);
  brewFunctions.register(bruce, apiCall);
  toolFunctions.register(bruce, apiCall);

  // ── State broadcasting ──────────────────────────────────────────────────

  const BRUCE_STATE_PREFIX = '@@BRUCE_STATE:';
  function emitState(state) {
    process.stdout.write(`${BRUCE_STATE_PREFIX}${state}\n`);
  }

  // ── Logging ─────────────────────────────────────────────────────────────

  let pendingTranscript = null;

  const flushTranscript = () => {
    if (pendingTranscript) {
      console.log(`[You] ${pendingTranscript}`);
      pendingTranscript = null;
    }
  };

  bruce.on('ready', () => { emitState('idle'); console.log('[Bruce] Ready — listening for wake word'); });
  bruce.on('wake', () => { console.log('[Bruce] Wake word detected'); });
  bruce.on('listening', () => { emitState('listening'); console.log('[Bruce] Listening...'); });
  bruce.on('thinking', () => { emitState('thinking'); console.log('[Bruce] Thinking...'); });
  bruce.on('speaking', () => { emitState('speaking'); console.log('[Bruce] Speaking...'); });
  bruce.on('idle', () => { emitState('idle'); console.log('[Bruce] Idle'); });
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

  // ── Listen for speak commands from Electron via stdin ──────────────────
  let stdinBuffer = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => {
    stdinBuffer += chunk;
    let newlineIdx;
    while ((newlineIdx = stdinBuffer.indexOf('\n')) !== -1) {
      const line = stdinBuffer.slice(0, newlineIdx).trim();
      stdinBuffer = stdinBuffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.action === 'speak' && msg.message) {
          console.log(`[Bruce] Speak request: ${msg.message}`);
          bruce.speak(msg.message);
        }
      } catch (err) {
        console.error('[Bruce] Failed to parse stdin message:', err.message);
      }
    }
  });

  await bruce.start();
}

main().catch((err) => {
  console.error('[Bruce] Fatal error:', err);
  process.exit(1);
});
