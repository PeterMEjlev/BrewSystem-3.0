import { useState, useEffect } from 'react';
import styles from './BruceIndicator.module.css';

const BAR_COUNT = 5;

function BruceIndicator({ state }) {
  const stateClass = styles[state] || styles.idle;

  const label =
    state === 'listening' ? 'Listening' :
    state === 'thinking' ? 'Thinking' :
    state === 'speaking' ? 'Speaking' :
    'Bruce';

  return (
    <div className={styles.indicator}>
      <div className={`${styles.bars} ${stateClass}`}>
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <span
            key={i}
            className={styles.bar}
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ))}
      </div>
      <span className={`${styles.label} ${stateClass}`}>{label}</span>
    </div>
  );
}

export default BruceIndicator;
