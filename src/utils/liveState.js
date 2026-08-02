/**
 * Live backend state over one WebSocket, shared by the whole app.
 *
 * The backend hands out a full snapshot when the socket opens and only diffs
 * after that, so a rig nobody is touching costs nothing and a heater toggle is
 * on screen in milliseconds rather than on the next poll tick. Commands still
 * go out over REST (see hardwareApi) — only the read path lives here.
 *
 * One connection serves every consumer: the module owns it, subscribers come
 * and go. Consumed through useSyncExternalStore, so `getLiveState` returns the
 * same object until something actually changes.
 */

// Backoff between reconnect attempts. Short at first — a backend restart
// during development should come back before the brewer notices.
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 5000];

// The backend heartbeats every 10 s. Longer than two of those, so a healthy
// but quiet link is never mistaken for a dead one.
const SILENCE_TIMEOUT_MS = 25000;

// How long a dropped connection is tolerated before the readings on screen are
// called stale. Matches the three-failed-polls rule this replaces: a blip must
// not throw a warning across a brewing screen, a real outage must.
const FREEZE_AFTER_MS = 3000;

const isDevEnvironment = () => {
  try {
    return localStorage.getItem('brewSystemEnvironment') === 'development';
  } catch {
    return false; // no storage — treat as the real rig
  }
};

let socket = null;
let reconnectAttempt = 0;
let reconnectTimer = null;
let silenceTimer = null;
let freezeTimer = null;
let lastSyncAt = null;
let started = false;

/**
 * `state` mirrors GET /api/hardware/state — { temperatures, controlState,
 * timer, heatFaults } — and is null until the first snapshot lands.
 * `frozenSince` is null while the link is healthy, otherwise the wall-clock
 * time of the last good sync: what the UI puts in front of the brewer.
 */
let snapshot = { state: null, frozenSince: null };

const stateSubscribers = new Set();
const logSubscribers = new Set();

function publish(changes) {
  snapshot = { ...snapshot, ...changes };
  stateSubscribers.forEach((fn) => fn());
}

function emitLogEvent(event) {
  logSubscribers.forEach((fn) => fn(event));
}

/**
 * Fold a diff into the state we hold, cloning only the branches the diff
 * touches. Everything else keeps its object identity, which is load-bearing:
 * the brew timer re-syncs its display whenever its slice changes identity, and
 * a temperature arriving must not nudge it.
 */
function mergePatch(base, patch) {
  const merged = { ...base };
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    const previous = base?.[key];
    merged[key] =
      value && typeof value === 'object' && !Array.isArray(value) &&
      previous && typeof previous === 'object'
        ? mergePatch(previous, value)
        : value;
  }
  return merged;
}

function armSilenceTimer() {
  clearTimeout(silenceTimer);
  // A connection can die without a close frame — a phone carried out of range,
  // a Pi yanked off the network. Absence of the heartbeat is the only symptom.
  silenceTimer = setTimeout(() => {
    silenceTimer = null;
    if (socket) socket.close();
  }, SILENCE_TIMEOUT_MS);
}

function markSynced() {
  lastSyncAt = Date.now();
  armSilenceTimer();
  clearTimeout(freezeTimer);
  freezeTimer = null;
  if (snapshot.frozenSince !== null) publish({ frozenSince: null });
}

function handleMessage(message) {
  switch (message.type) {
    case 'snapshot':
      markSynced();
      publish({ state: message.state, frozenSince: null });
      // Whatever happened while we were away is now a hole in the chart, and
      // only the history endpoint can fill it.
      emitLogEvent({ type: 'resync' });
      break;
    case 'patch':
      markSynced();
      publish({ state: mergePatch(snapshot.state ?? {}, message.state) });
      break;
    case 'log':
      markSynced();
      emitLogEvent({ type: 'row', row: message.row });
      break;
    case 'session_reset':
      markSynced();
      emitLogEvent({ type: 'reset' });
      break;
    case 'heartbeat':
      markSynced();
      break;
    default:
      break;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function handleDisconnect() {
  clearTimeout(silenceTimer);
  silenceTimer = null;
  if (!freezeTimer && snapshot.frozenSince === null) {
    freezeTimer = setTimeout(() => {
      freezeTimer = null;
      publish({ frozenSince: lastSyncAt ?? Date.now() });
    }, FREEZE_AFTER_MS);
  }
  scheduleReconnect();
}

function connect() {
  if (socket || isDevEnvironment()) return;
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  let ws;
  try {
    ws = new WebSocket(`${scheme}://${window.location.host}/api/ws`);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    reconnectAttempt = 0;
    armSilenceTimer();
  };
  ws.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return; // not ours to interpret
    }
    handleMessage(message);
  };
  ws.onclose = () => {
    if (socket !== ws) return; // superseded by a newer socket
    socket = null;
    handleDisconnect();
  };
  ws.onerror = () => {
    // onclose always follows, and does the work.
    try { ws.close(); } catch { /* already closing */ }
  };
}

/**
 * Open the connection if it isn't already. The socket lives as long as the
 * app does — this is a kiosk that stays on a brewing screen for a whole brew
 * day, so there is nothing to be gained by tearing it down between mounts.
 * In development the mock hardware is the source of truth and no socket opens.
 */
function ensureConnected() {
  if (started) return;
  started = true;
  connect();
}

/** Subscribe to state changes. For useSyncExternalStore. */
export function subscribeLiveState(callback) {
  ensureConnected();
  stateSubscribers.add(callback);
  return () => stateSubscribers.delete(callback);
}

/** Current { state, frozenSince }. Stable reference between changes. */
export function getLiveState() {
  return snapshot;
}

/**
 * Subscribe to the temperature-log stream, which the chart is built on.
 * Events are { type: 'row', row } for a newly logged reading, { type: 'reset' }
 * when a new session starts and the points held are from a finished brew, and
 * { type: 'resync' } on (re)connect, meaning "top up from the history endpoint,
 * you may have missed some".
 */
export function subscribeLogEvents(callback) {
  ensureConnected();
  logSubscribers.add(callback);
  return () => logSubscribers.delete(callback);
}
