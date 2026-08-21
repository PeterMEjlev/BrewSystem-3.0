import { useState } from 'react';
import { playClick } from '../../utils/sounds';
import styles from './ResumeSessionDialog.module.css';

const formatAway = (seconds) => {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hours` : `${hours} h ${rest} min`;
};

const formatClock = (totalSeconds) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
};

/**
 * The first thing the rig says after being restarted mid-brew.
 *
 * The backend has already picked the brew back up by the time this is on
 * screen — the log it was writing is being appended to again and the stage and
 * timer are back — because that is the answer that loses nothing while nobody
 * is standing at the screen. So this dialog is a confirmation, not a switch:
 * "Resume" only puts the question away, and "Start fresh" is the destructive
 * one. Which is why the safe answer is the prominent button and the one that
 * throws a brew day's curve away is the quiet one.
 *
 * There is no way to dismiss it without answering. A brewer who taps past this
 * without reading it would be left unsure which brew the chart belongs to, and
 * on a screen with no keyboard there is nothing to press by accident.
 */
function ResumeSessionDialog({ offer, onResume, onStartFresh }) {
  const [busy, setBusy] = useState(null);

  const choose = async (action, handler) => {
    if (busy) return;
    playClick();
    setBusy(action);
    try {
      await handler();
    } finally {
      setBusy(null);
    }
  };

  const beer = offer.brewSession?.name;
  // The timer as it stood when the rig came back — part of the description of
  // what was found, not a live reading.
  const timer = offer.timer;
  const timerLabel = timer && timer.target > 0
    ? `${formatClock(timer.seconds)} left${timer.running ? '' : ' (paused)'}`
    : null;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Resume brew session">
      <div className={styles.dialog}>
        <h2 className={styles.title}>Pick this brew back up?</h2>
        <p className={styles.subtitle}>
          The brewing system restarted and was away for {formatAway(offer.awaySeconds)}.
          It was in the middle of a brew.
        </p>

        <dl className={styles.summary}>
          {beer && (
            <div className={styles.row}>
              <dt className={styles.key}>Beer</dt>
              <dd className={styles.value}>{beer}</dd>
            </div>
          )}
          <div className={styles.row}>
            <dt className={styles.key}>Stage</dt>
            <dd className={styles.value}>{offer.stage || 'Not started'}</dd>
          </div>
          {timerLabel && (
            <div className={styles.row}>
              <dt className={styles.key}>Timer</dt>
              <dd className={styles.value}>{timerLabel}</dd>
            </div>
          )}
          <div className={styles.row}>
            <dt className={styles.key}>Readings</dt>
            <dd className={styles.value}>{offer.loggedRows.toLocaleString()} logged so far</dd>
          </div>
        </dl>

        {/* Said plainly, because the screen looks exactly the same either way
            and the brewer is about to walk back to a rig they think is hot. */}
        <p className={styles.safetyNote}>
          Heaters and pumps are off, and regulation is disarmed — turn them back
          on yourself when you have looked at the rig. Set temperatures and
          efficiencies are as you left them.
        </p>

        <div className={styles.actions}>
          <button
            className={styles.freshBtn}
            onClick={() => choose('fresh', onStartFresh)}
            disabled={Boolean(busy)}
          >
            {busy === 'fresh' ? 'Starting…' : 'Start a fresh session'}
          </button>
          <button
            className={styles.resumeBtn}
            onClick={() => choose('resume', onResume)}
            disabled={Boolean(busy)}
          >
            {busy === 'resume' ? 'Resuming…' : 'Resume this brew'}
          </button>
        </div>
        <p className={styles.freshWarning}>
          Starting fresh keeps the readings taken so far on disk, but clears the
          chart and the brew stage.
        </p>
      </div>
    </div>
  );
}

export default ResumeSessionDialog;
