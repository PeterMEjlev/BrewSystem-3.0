import styles from './ScreenSleepOverlay.module.css';

/**
 * Covers the whole UI while the display is asleep.
 *
 * Its real job is catching the waking touch: the panel comes back on, but the
 * tap that woke it lands here instead of on whatever control happened to be
 * underneath. Nobody switches an 8.5 kW element on by waking the screen.
 *
 * The hint is deliberately static and dim — on the Pi the panel is powered off
 * so nothing is visible anyway, and an animation would keep Chromium
 * repainting a screen no one can see.
 */
function ScreenSleepOverlay({ onWake }) {
  return (
    <div
      className={styles.overlay}
      onPointerDown={(e) => {
        e.preventDefault();
        onWake();
      }}
    >
      <span className={styles.hint}>Touch to wake</span>
    </div>
  );
}

export default ScreenSleepOverlay;
