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

  // ── State broadcasting ──────────────────────────────────────────────────

  const BRUCE_STATE_PREFIX = '@@BRUCE_STATE:';
  const BRUCE_MSG_PREFIX = '@@BRUCE_MSG:';

  function emitState(state) {
    process.stdout.write(`${BRUCE_STATE_PREFIX}${state}\n`);
  }

  function emitMessage(msg) {
    process.stdout.write(`${BRUCE_MSG_PREFIX}${JSON.stringify(msg)}\n`);
  }

  // ── Register all function categories ──────────────────────────────────

  hardwareFunctions.register(bruce, apiCall);
  brewFunctions.register(bruce, apiCall);
  toolFunctions.register(bruce, apiCall, emitMessage);

  // ── Logging ─────────────────────────────────────────────────────────────
  //
  // The OpenAI Realtime API can deliver the final user transcript well
  // AFTER Bruce has already started responding.  To guarantee "[You]"
  // prints before any Bruce content, we queue content output (replies,
  // function calls) until the transcript arrives.  State emissions
  // (emitState) are never queued — they drive the live UI indicator.
  // The idle event drains the queue as a safety net if the transcript
  // never arrives.

  let pendingTranscript = null;
  let waitingForTranscript = false;
  let transcriptFlushed = false;    // true once [You] has been printed for this turn
  let outputQueue = [];

  const flushTranscript = () => {
    if (pendingTranscript) {
      console.log(`[You] ${pendingTranscript}`);
      emitMessage({ type: 'user', content: pendingTranscript, timestamp: Date.now() });
      pendingTranscript = null;
      transcriptFlushed = true;
    }
  };

  const drainQueue = () => {
    waitingForTranscript = false;
    const queued = outputQueue;
    outputQueue = [];
    for (const fn of queued) fn();
  };

  const bruceOutput = (fn) => {
    if (waitingForTranscript) {
      outputQueue.push(fn);
    } else {
      fn();
    }
  };

  bruce.on('ready', () => { emitState('idle'); console.log('[Bruce] Ready — listening for wake word'); });
  bruce.on('wake', () => { console.log('[Bruce] Wake word detected'); });

  bruce.on('listening', () => {
    // Drain any remaining output from the previous turn before resetting
    flushTranscript();
    drainQueue();
    pendingTranscript = null;
    transcriptFlushed = false;
    emitState('listening');
    console.log('[Bruce] Listening...');
  });

  bruce.on('thinking', () => {
    if (!pendingTranscript && !waitingForTranscript && !transcriptFlushed) {
      // First thinking of this turn, transcript hasn't arrived — buffer
      waitingForTranscript = true;
    } else {
      flushTranscript();
    }
    emitState('thinking');
    console.log('[Bruce] Thinking...');
  });

  bruce.on('speaking', () => {
    emitState('speaking');
    bruceOutput(() => { console.log('[Bruce] Speaking...'); });
  });

  bruce.on('idle', () => {
    // End of turn — flush anything still pending
    flushTranscript();
    drainQueue();
    emitState('idle');
    console.log('[Bruce] Idle');
  });

  bruce.on('transcript', (text) => {
    pendingTranscript = text;
    if (waitingForTranscript) {
      flushTranscript();
      drainQueue();
    }
  });

  bruce.on('functionCall', (name, args) => {
    bruceOutput(() => {
      console.log(`[Bruce] Function call: ${name}`, args);
      emitMessage({ type: 'function_call', functionName: name, functionArgs: args, timestamp: Date.now() });
    });
  });

  bruce.on('reply', (text) => {
    bruceOutput(() => {
      console.log(`[Bruce] ${text}`);
      emitMessage({ type: 'assistant', content: text, timestamp: Date.now() });
    });
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
        } else if (msg.action === 'set-volume' && msg.gain != null) {
          console.log(`[Bruce] Volume set to ${msg.gain}`);
          bruce.setVolume(msg.gain);
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
