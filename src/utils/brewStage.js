/**
 * Brew-stage state — which part of the brew day is running.
 *
 * Production: the backend owns it. It arrives on the same socket as everything
 * else (see liveState) and moves go out over REST, so a kiosk that reloads
 * during the mash — or the BrewPlanner dashboard mirroring this screen — finds
 * the rig on the stage it is really on rather than back at the beginning.
 *
 * Development: there is no backend, so this module keeps the same state itself
 * under the same rules, the way mockHardware stands in for the rig.
 *
 * Both are read through `useSyncExternalStore`, so a consumer cannot tell which
 * one it is talking to.
 */
import { subscribeLiveState, getLiveState } from './liveState';

/**
 * Must match BREW_STAGES in backend/main.py.
 *
 * Only development reads this: in production the backend sends the list it is
 * timestamping against, so the labels on the chart can never drift out of step
 * with the marks they belong to.
 */
export const BREW_STAGES = [
  'Heat water (for mash)',
  'Mash in',
  'Mash',
  'Sparge',
  'Heat water (for boil)',
  'Boil',
  'Hop whirlpool',
  'Cooling',
];

/** Before the first stage. The stage after the last is `stages.length`. */
export const STAGE_NOT_STARTED = -1;

const isDevEnvironment = () => {
  try {
    return localStorage.getItem('brewSystemEnvironment') === 'development';
  } catch {
    return false; // no storage — treat as the real rig
  }
};

// Returned until the socket's first snapshot lands. Module-level, because
// getSnapshot must hand back the same reference every time it is asked or
// useSyncExternalStore will re-render forever.
const NOT_YET_KNOWN = { stages: BREW_STAGES, index: STAGE_NOT_STARTED, markers: [] };

let devState = NOT_YET_KNOWN;
const devSubscribers = new Set();

const post = async (action) => {
  try {
    await fetch('/api/hardware/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  } catch (e) {
    console.error('Brew stage API error:', e);
  }
};

/** Mirrors _step_brew_stage in backend/main.py. */
function stepDevStage(delta) {
  const current = devState.index;
  const target = Math.max(STAGE_NOT_STARTED, Math.min(BREW_STAGES.length, current + delta));
  if (target === current) return;
  devState = {
    ...devState,
    index: target,
    markers: target > current
      ? [...devState.markers, { index: target, ts: Date.now() }]
      : devState.markers.filter((marker) => marker.index <= target),
  };
  devSubscribers.forEach((fn) => fn());
}

/** Subscribe to stage changes. For useSyncExternalStore. */
export function subscribeBrewStage(callback) {
  if (isDevEnvironment()) {
    devSubscribers.add(callback);
    return () => devSubscribers.delete(callback);
  }
  return subscribeLiveState(callback);
}

/**
 * Current { stages, index, markers }. Stable reference between changes — in
 * production because the socket's patch merge leaves untouched branches with
 * their identity, so a temperature arriving does not re-render the chart.
 */
export function getBrewStage() {
  if (isDevEnvironment()) return devState;
  return getLiveState().state?.brewStage ?? NOT_YET_KNOWN;
}

/**
 * Move one stage forward (delta > 0) or back.
 *
 * Deliberately not optimistic: the write is a LAN round trip that the backend
 * answers with a push inside a frame or two, and a card that guessed would
 * have to carry a suppression window and the class of bugs that comes with it.
 * The button's own press feedback covers the gap.
 */
export function stepBrewStage(delta) {
  if (isDevEnvironment()) {
    stepDevStage(delta);
    return;
  }
  post(delta > 0 ? 'next' : 'back');
}
