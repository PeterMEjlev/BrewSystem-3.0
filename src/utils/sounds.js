// Programmatic sound effects using Web Audio API — no audio files needed.
// Volume levels are persisted in localStorage.

let ctx = null;

function getContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ── Volume state ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'brewSystemSoundVolumes';

const defaults = { master: 0.8, buttons: 0.8, bruce: 0.8 };

let volumes = { ...defaults };

function loadVolumes() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) volumes = { ...defaults, ...JSON.parse(saved) };
  } catch { /* use defaults */ }
}

function persistVolumes() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(volumes)); } catch {}
}

loadVolumes();

// Send initial Bruce volume to Electron on load
syncBruceVolume();

export function getVolumes() {
  return { ...volumes };
}

export function setMasterVolume(v) {
  volumes.master = Math.max(0, Math.min(1, v));
  persistVolumes();
  syncBruceVolume();
}

export function setButtonVolume(v) {
  volumes.buttons = Math.max(0, Math.min(1, v));
  persistVolumes();
}

export function setBruceVolume(v) {
  volumes.bruce = Math.max(0, Math.min(1, v));
  persistVolumes();
  syncBruceVolume();
}

function syncBruceVolume() {
  const effective = volumes.master * volumes.bruce;
  window.bruceAPI?.setVolume(effective);
}

/** Effective button volume (master × buttons) */
function btnVol() {
  return volumes.master * volumes.buttons;
}

// ── Sound effects ─────────────────────────────────────────────────────────────

function playTone(frequency, duration, { type = 'sine', volume = 0.12, ramp = true } = {}) {
  const scale = btnVol();
  if (scale <= 0) return;

  const ac = getContext();
  const osc = ac.createOscillator();
  const gain = ac.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ac.currentTime);
  gain.gain.setValueAtTime(volume * scale, ac.currentTime);

  if (ramp) {
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  }

  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + duration);
}

/** Short, subtle click for general buttons */
export function playClick() {
  playTone(800, 0.08, { type: 'sine', volume: 0.45 });
}

/** Toggle switching ON — upward two-tone chirp */
export function playToggleOn() {
  const scale = btnVol();
  if (scale <= 0) return;

  const ac = getContext();
  const now = ac.currentTime;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.setValueAtTime(900, now + 0.06);
  gain.gain.setValueAtTime(0.50 * scale, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.14);
}

/** Toggle switching OFF — downward two-tone chirp */
export function playToggleOff() {
  const scale = btnVol();
  if (scale <= 0) return;

  const ac = getContext();
  const now = ac.currentTime;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(700, now);
  osc.frequency.setValueAtTime(400, now + 0.06);
  gain.gain.setValueAtTime(0.50 * scale, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.14);
}

/** Navigation / tab switch — soft blip */
export function playNavigate() {
  playTone(1200, 0.07, { type: 'sine', volume: 0.35 });
}
