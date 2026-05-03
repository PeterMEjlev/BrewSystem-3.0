import { useState, useEffect, useRef, memo } from 'react';
import styles from './BrewTimer.module.css';

const postTimer = async (action, seconds) => {
  try {
    const body = { action };
    if (seconds !== undefined) body.seconds = seconds;
    await fetch('/api/hardware/timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { /* ignore */ }
};

const DRAG_THRESHOLD = 20; // pixels of vertical drag per tick
const DRAG_START_THRESHOLD = 10; // pixels before a press is considered a drag
const LONG_PRESS_MS = 800;

function BrewTimer({ timerState, isProduction }) {
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const [target, setTarget] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const intervalRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const localActionRef = useRef(false);

  // Press state — covers tap, drag-to-adjust, and long-press-to-reset
  const pressRef = useRef(null);

  const canAdjust = !isRunning && displaySeconds === target;

  // Sync from backend poll
  useEffect(() => {
    if (!isProduction || !timerState) return;
    if (localActionRef.current) {
      localActionRef.current = false;
      return;
    }
    setDisplaySeconds(timerState.seconds);
    setIsRunning(timerState.running);
    setTarget(timerState.target ?? 0);
  }, [isProduction, timerState]);

  // Local tick — keeps display updating every second in both dev and production.
  // In production the backend poll (1.5s) corrects any drift.
  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        if (isProduction) {
          // Locally tick the display so it updates every second between polls
          setDisplaySeconds((prev) => {
            if (target > 0) {
              const next = prev - 1;
              return next >= 0 ? next : 0;
            }
            return prev + 1;
          });
        } else {
          setElapsed((e) => e + 1);
        }
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, isProduction, target]);

  // Update display from elapsed (dev mode)
  useEffect(() => {
    if (isProduction) return;
    if (target > 0) {
      const remaining = Math.max(target - elapsed, 0);
      setDisplaySeconds(remaining);
      if (remaining === 0 && isRunning) {
        setIsRunning(false);
        setIsFinished(true);
      }
    } else {
      setDisplaySeconds(elapsed);
    }
  }, [elapsed, target, isProduction, isRunning]);

  // Detect finished state from backend poll
  useEffect(() => {
    if (!isProduction || !timerState) return;
    if (timerState.target > 0 && timerState.seconds === 0 && !timerState.running) {
      setIsFinished(true);
    }
  }, [isProduction, timerState]);

  // Notify Bruce when timer finishes
  useEffect(() => {
    if (isFinished) {
      window.bruceAPI?.speak(
        '[SYSTEM] The brew timer has just reached zero. Tell the user their timer is done.'
      );
    }
  }, [isFinished]);

  const applySegmentDelta = (segment, delta) => {
    setTarget((prev) => {
      const h = Math.floor(prev / 3600);
      const m = Math.floor((prev % 3600) / 60);
      const s = prev % 60;

      let newH = h, newM = m, newS = s;
      if (segment === 'h') newH = ((h + delta) % 25 + 25) % 25;
      if (segment === 'm') newM = ((m + delta) % 60 + 60) % 60;
      if (segment === 's') newS = ((s + delta) % 60 + 60) % 60;

      const newTarget = newH * 3600 + newM * 60 + newS;
      setDisplaySeconds(newTarget);
      setElapsed(0);

      if (isProduction) {
        localActionRef.current = true;
        postTimer('set', newTarget);
      }

      return newTarget;
    });
  };

  const handleToggle = () => {
    if (isFinished) {
      handleReset();
      return;
    }
    localActionRef.current = true;
    if (isRunning) {
      if (isProduction) postTimer('stop');
      setIsRunning(false);
    } else {
      if (isProduction) postTimer('start');
      setIsRunning(true);
    }
  };

  const handleReset = () => {
    localActionRef.current = true;
    if (isProduction) postTimer('reset');
    setIsRunning(false);
    setIsFinished(false);
    setElapsed(0);
    setTarget(0);
    setDisplaySeconds(0);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // Unified card-level pointer handling.
  // Tap = toggle, hold = reset, vertical drag = adjust the segment under the
  // initial press position (left third = hours, middle = minutes, right = seconds).
  const handlePointerDown = (e) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const third = rect.width / 3;
    const segment = relX < third ? 'h' : relX < 2 * third ? 'm' : 's';

    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    pressRef.current = {
      segment,
      startY: e.clientY,
      accumulated: 0,
      dragging: false,
      longPressFired: false,
    };

    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      if (pressRef.current) pressRef.current.longPressFired = true;
      handleReset();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e) => {
    const press = pressRef.current;
    if (!press) return;

    const dy = press.startY - e.clientY; // positive = dragged up
    if (!press.dragging && Math.abs(dy) > DRAG_START_THRESHOLD) {
      press.dragging = true;
      cancelLongPress();
    }
    if (!press.dragging || !canAdjust) return;

    const ticks = Math.trunc((dy - press.accumulated) / DRAG_THRESHOLD);
    if (ticks !== 0) {
      press.accumulated += ticks * DRAG_THRESHOLD;
      applySegmentDelta(press.segment, ticks);
    }
  };

  const handlePointerUp = (e) => {
    const press = pressRef.current;
    pressRef.current = null;
    cancelLongPress();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!press) return;
    if (press.dragging || press.longPressFired) return;
    handleToggle();
  };

  const handlePointerCancel = (e) => {
    pressRef.current = null;
    cancelLongPress();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const h = Math.floor(displaySeconds / 3600);
  const m = Math.floor((displaySeconds % 3600) / 60);
  const s = displaySeconds % 60;

  const mode = target > 0 ? 'Timer' : 'Stopwatch';

  const getHint = () => {
    if (isFinished) return 'Timer Complete! • Tap to Dismiss';
    if (canAdjust) return 'Drag to Set • Tap to Start';
    if (isRunning) return 'Tap to Pause • Hold to Reset';
    return 'Tap to Resume • Hold to Reset';
  };

  return (
    <div
      className={`${styles.brewTimer} ${isFinished ? styles.finished : isRunning ? styles.running : styles.paused} ${canAdjust ? styles.adjustable : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div className={styles.label}>Brew {mode}</div>
      <div className={styles.timeDisplay}>
        <div className={styles.segment}>{String(h).padStart(2, '0')}</div>
        <span className={styles.colon}>:</span>
        <div className={styles.segment}>{String(m).padStart(2, '0')}</div>
        <span className={styles.colon}>:</span>
        <div className={styles.segment}>{String(s).padStart(2, '0')}</div>
      </div>
      <div className={styles.statusHint}>{getHint()}</div>
    </div>
  );
}

export default memo(BrewTimer);
