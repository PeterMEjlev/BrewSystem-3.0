import { useState, useEffect, useRef } from 'react';
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

function BrewTimer({ timerState, isProduction }) {
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const [target, setTarget] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const intervalRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const localActionRef = useRef(false);

  // Drag state for segment adjustment
  const dragRef = useRef(null); // { segment, startY, accumulated }

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

  // Local tick (dev mode)
  useEffect(() => {
    if (isProduction) return;
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setElapsed((e) => e + 1);
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, isProduction]);

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

  const applySegmentDelta = (segment, delta) => {
    setTarget((prev) => {
      const h = Math.floor(prev / 3600);
      const m = Math.floor((prev % 3600) / 60);
      const s = prev % 60;

      let newH = h, newM = m, newS = s;
      if (segment === 'h') newH = ((h + delta) % 61 + 61) % 61;
      if (segment === 'm') newM = ((m + delta) % 61 + 61) % 61;
      if (segment === 's') newS = ((s + delta) % 61 + 61) % 61;

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

  // Segment pointer handlers — drag up to increment, drag down to decrement
  const handleSegmentPointerDown = (segment, e) => {
    if (!canAdjust) return;
    e.stopPropagation();
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    dragRef.current = { segment, startY: e.clientY, accumulated: 0 };
  };

  const handleSegmentPointerMove = (e) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    const dy = dragRef.current.startY - e.clientY; // positive = dragged up
    const ticks = Math.trunc((dy - dragRef.current.accumulated) / DRAG_THRESHOLD);
    if (ticks !== 0) {
      dragRef.current.accumulated += ticks * DRAG_THRESHOLD;
      applySegmentDelta(dragRef.current.segment, ticks);
    }
  };

  const handleSegmentPointerUp = (e) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    e.target.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  // Card-level pointer handlers for tap (toggle) and hold (reset)
  const handlePointerDown = (e) => {
    e.preventDefault();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      handleReset();
    }, 800);
  };

  const handlePointerUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      handleToggle();
    }
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
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

  const segmentProps = (segment) => ({
    className: `${styles.segment} ${canAdjust ? styles.scrollable : ''}`,
    onPointerDown: (e) => handleSegmentPointerDown(segment, e),
    onPointerMove: handleSegmentPointerMove,
    onPointerUp: handleSegmentPointerUp,
    onPointerCancel: handleSegmentPointerUp,
  });

  return (
    <div
      className={`${styles.brewTimer} ${isFinished ? styles.finished : isRunning ? styles.running : styles.paused}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
    >
      <div className={styles.label}>Brew {mode}</div>
      <div className={styles.timeDisplay}>
        <div {...segmentProps('h')}>{String(h).padStart(2, '0')}</div>
        <span className={styles.colon}>:</span>
        <div {...segmentProps('m')}>{String(m).padStart(2, '0')}</div>
        <span className={styles.colon}>:</span>
        <div {...segmentProps('s')}>{String(s).padStart(2, '0')}</div>
      </div>
      <div className={styles.statusHint}>{getHint()}</div>
    </div>
  );
}

export default BrewTimer;
