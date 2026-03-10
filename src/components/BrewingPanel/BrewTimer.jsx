import { useState, useEffect, useRef } from 'react';
import styles from './BrewTimer.module.css';

const postTimer = async (action) => {
  try {
    await fetch('/api/hardware/timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  } catch { /* ignore */ }
};

function BrewTimer({ timerState, isProduction }) {
  const [time, setTime] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef(null);
  const longPressTimerRef = useRef(null);
  // Track whether the last change came from a local click (to avoid poll overwrite)
  const localActionRef = useRef(false);

  // Sync from backend poll — only apply if we didn't just act locally
  useEffect(() => {
    if (!isProduction || !timerState) return;
    if (localActionRef.current) {
      localActionRef.current = false;
      return;
    }
    setTime(timerState.seconds);
    setIsRunning(timerState.running);
  }, [isProduction, timerState]);

  // Local tick — only in dev mode (production uses backend poll for time)
  useEffect(() => {
    if (isProduction) return;

    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setTime((t) => t + 1);
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, isProduction]);

  const handleToggle = () => {
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
    setTime(0);
  };

  const startLongPress = (e) => {
    e.preventDefault();
    longPressTimerRef.current = setTimeout(() => {
      handleReset();
    }, 800);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerDown = (e) => {
    startLongPress(e);
  };

  const handlePointerUp = () => {
    if (longPressTimerRef.current) {
      cancelLongPress();
      handleToggle();
    }
  };

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div
      className={`${styles.brewTimer} ${isRunning ? styles.running : styles.paused}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
    >
      <div className={styles.label}>Brew Timer</div>
      <div className={styles.timeDisplay}>{formatTime(time)}</div>
      <div className={styles.statusHint}>
        {isRunning ? 'Tap to Pause • Hold to Reset' : 'Tap to Start • Hold to Reset'}
      </div>
    </div>
  );
}

export default BrewTimer;
