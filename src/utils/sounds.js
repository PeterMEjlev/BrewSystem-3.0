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

const defaults = { master: 0.8, buttons: 0.8, bruce: 0.8, alarm: 0.9 };

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

export function setAlarmVolume(v) {
  volumes.alarm = Math.max(0, Math.min(1, v));
  persistVolumes();
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

// ── Timer alarm ───────────────────────────────────────────────────────────────
//
// The brew timer marks hop additions and mash rests, which is to say the
// moments where being thirty seconds late actually changes the beer. Bruce
// announces them too, but he is optional and lives on another Pi, so the panel
// has to be able to make a noise entirely on its own.

let alarmTimer = null;
let alarmStopTimer = null;

// Repeat until acknowledged — one chime is no use to someone at the far end of
// the brewery, which is exactly where a timer finds you.
const ALARM_REPEAT_MS = 2500;
// ...but not forever. A session abandoned with the timer up should not leave
// the brewery beeping all night.
const ALARM_MAX_MS = 10 * 60 * 1000;

/** Effective alarm volume (master × alarm) */
function alarmVol() {
  return volumes.master * volumes.alarm;
}

/** One burst: three rising square-wave beeps. Square carries over a boil in a
 *  way a sine does not — this needs to be heard across a room with a pump and
 *  a rolling kettle in it, not to sound pleasant. */
function playAlarmBurst() {
  const scale = alarmVol();
  if (scale <= 0) return;

  const ac = getContext();
  const now = ac.currentTime;

  [0, 0.22, 0.44].forEach((offset, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880 + i * 220, now + offset);
    // Ramp rather than a hard start/stop: a square wave switched on at full
    // amplitude clicks through the speaker.
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.5 * scale, now + offset + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.2);
  });
}

/** Start the timer alarm. Repeats until stopTimerAlarm(), or ALARM_MAX_MS. */
export function startTimerAlarm() {
  if (alarmTimer) return; // already sounding
  playAlarmBurst();
  alarmTimer = setInterval(playAlarmBurst, ALARM_REPEAT_MS);
  alarmStopTimer = setTimeout(stopTimerAlarm, ALARM_MAX_MS);
}

export function stopTimerAlarm() {
  clearInterval(alarmTimer);
  clearTimeout(alarmStopTimer);
  alarmTimer = null;
  alarmStopTimer = null;
}

/** One burst, for the volume slider in Settings. */
export function playAlarmPreview() {
  playAlarmBurst();
}
