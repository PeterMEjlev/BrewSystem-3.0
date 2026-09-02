import { useState, useEffect, useRef, useCallback } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { hardwareApi } from '../utils/hardwareApi';
import { DEFAULT_SCREEN_SLEEP } from '../utils/appDefaults';

/**
 * Kiosk screen sleep: power the display down after a stretch with no touch.
 *
 * Only the panel sleeps. A Raspberry Pi has no suspend-to-RAM, and suspending
 * the machine mid-brew would be the wrong thing anyway — the backend keeps
 * reading sensors, regulating and running its watchdogs the whole time.
 *
 * The rig also has to be idle. A heater on, a pump running or a counting brew
 * timer all hold the screen awake, so temperatures stay readable from across
 * the room during a boil you aren't touching.
 */

// Anything the brewer does at the panel. Captured on the window so a touch
// anywhere counts, including on controls that stop their own propagation.
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

// Which of those may wake a panel that has already gone dark. A deliberate
// touch, a key or the wheel — all of them need a person. `pointermove` is left
// out on purpose, because the panel going to sleep produces one by itself: see
// onActivity below.
const WAKE_EVENTS = new Set(['pointerdown', 'keydown', 'wheel', 'touchstart']);

// How long to wait before asking again once the rig turns out to be busy.
const BUSY_RECHECK_MS = 30_000;

// Guard against a fat-fingered config: a few seconds would make the rig unusable.
const MIN_TIMEOUT_SECONDS = 30;

/** Is the rig doing something worth keeping the screen lit for? */
function isRigBusy(state) {
  // No answer from the backend is not proof of idleness — stay awake.
  if (!state) return true;
  const pots = Object.values(state.controlState?.pots ?? {});
  const pumps = Object.values(state.controlState?.pumps ?? {});
  return (
    pots.some((pot) => pot.heaterOn) ||
    pumps.some((pump) => pump.on) ||
    Boolean(state.timer?.running)
  );
}

export function useScreenSleep() {
  const { settings } = useSettings();
  const [asleep, setAsleep] = useState(false);
  // The event handlers run outside React's render cycle and need the current
  // value synchronously, so state is mirrored here.
  const asleepRef = useRef(false);

  const config = { ...DEFAULT_SCREEN_SLEEP, ...(settings?.app?.screen_sleep ?? {}) };
  const enabled = config.enabled !== false;
  const timeoutMs = Math.max(MIN_TIMEOUT_SECONDS, config.timeout_seconds) * 1000;

  const wake = useCallback(() => {
    if (!asleepRef.current) return;
    asleepRef.current = false;
    setAsleep(false);
    window.displayAPI?.wake();
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    let timer = null;
    let cancelled = false;
    // Bumped on every touch. The busy check awaits the backend, and a touch
    // that lands during that await must not be overtaken by the reply.
    let activityCount = 0;

    const arm = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(check, ms);
    };

    // The idle timer has run out — the only moment the rig's state matters, so
    // it is the only moment we ask for it. No extra polling the rest of the time.
    const check = async () => {
      if (cancelled || asleepRef.current) return;
      const seen = activityCount;
      const busy = isRigBusy(await hardwareApi.getFullState());
      if (cancelled || asleepRef.current || activityCount !== seen) return;
      if (busy) {
        arm(BUSY_RECHECK_MS);
        return;
      }
      asleepRef.current = true;
      setAsleep(true);
      window.displayAPI?.sleep();
    };

    // Where the cursor last was, in screen coordinates rather than window ones,
    // so that the window moving or resizing underneath it does not read as the
    // cursor having gone anywhere.
    let pointerAt = null;

    const pointerMoved = (event) => {
      const before = pointerAt;
      pointerAt = { x: event.screenX, y: event.screenY };
      return !before || before.x !== pointerAt.x || before.y !== pointerAt.y;
    };

    const onActivity = (event) => {
      // Chromium synthesises a pointermove whenever the layout shifts under the
      // cursor, and this window's layout shifts *because* the panel slept: the
      // monitor entering standby makes labwc un-fullscreen the kiosk, and
      // restoreKiosk() in electron/main.js sizes it back. Both were arriving as
      // brewer activity, so every sleep was undone about eight seconds later and
      // the panel spent five days blinking off and on at the idle interval.
      if (event.type === 'pointermove' && !pointerMoved(event)) return;

      // A move that really happened still is not a wake: the panel is dark, so
      // there is nothing on it to look at yet. Only the events a person has to
      // mean — a touch, a key, the wheel — bring it back.
      if (asleepRef.current && !WAKE_EVENTS.has(event.type)) return;

      activityCount += 1;
      wake();
      arm(timeoutMs);
    };

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, onActivity, { passive: true, capture: true })
    );
    arm(timeoutMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, onActivity, { capture: true })
      );
      // Sleep being switched off (or its timeout edited) must not strand a dark
      // panel — this cleanup is the only path out of that state.
      wake();
    };
  }, [enabled, timeoutMs, wake]);

  return { asleep, wake };
}
