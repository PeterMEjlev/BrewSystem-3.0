import { useState, useEffect, useRef } from 'react';
import styles from './BrewTimer.module.css';

function BrewTimer() {
  const [time, setTime] = useState(0); // seconds
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef(null);
  const longPressTimerRef = useRef(null);

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setTime((t) => t + 1);
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning]);

  const handleToggle = () => {
    setIsRunning((prev) => !prev);
  };

  const handleReset = () => {
    setIsRunning(false);
    setTime(0);
  };

  const startLongPress = (e) => {
    e.preventDefault();
    longPressTimerRef.current = setTimeout(() => {
      handleReset();
    }, 800); // 800ms hold to reset
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
      // If long press timer is still active, it was a short click
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
