// Programmatic sound effects using Web Audio API — no audio files needed.

let ctx = null;

function getContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browsers require user gesture to start audio)
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function playTone(frequency, duration, { type = 'sine', volume = 0.12, ramp = true } = {}) {
  const ac = getContext();
  const osc = ac.createOscillator();
  const gain = ac.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ac.currentTime);
  gain.gain.setValueAtTime(volume, ac.currentTime);

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
  playTone(800, 0.06, { type: 'sine', volume: 0.08 });
}

/** Toggle switching ON — upward two-tone chirp */
export function playToggleOn() {
  const ac = getContext();
  const now = ac.currentTime;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.setValueAtTime(900, now + 0.06);
  gain.gain.setValueAtTime(0.10, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

/** Toggle switching OFF — downward two-tone chirp */
export function playToggleOff() {
  const ac = getContext();
  const now = ac.currentTime;

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(700, now);
  osc.frequency.setValueAtTime(400, now + 0.06);
  gain.gain.setValueAtTime(0.10, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

/** Navigation / tab switch — soft blip */
export function playNavigate() {
  playTone(1200, 0.05, { type: 'sine', volume: 0.06 });
}
