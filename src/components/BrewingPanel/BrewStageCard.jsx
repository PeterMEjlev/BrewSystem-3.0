import { useSyncExternalStore } from 'react';
import { subscribeBrewStage, getBrewStage, stepBrewStage } from '../../utils/brewStage';
import { playToggleOn, playToggleOff } from '../../utils/sounds';
import styles from './BrewStageCard.module.css';

const formatClock = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Where the brew day has got to, in the space under the MLT card.
 *
 * Shows the stage that is running and names the one ahead on the button that
 * moves to it, so the brewer never has to remember the running order. Back is
 * the small button: going forward is the thing being done all day, going back
 * is undoing a wrong tap.
 */
function BrewStageCard() {
  const { stages, index, markers } = useSyncExternalStore(subscribeBrewStage, getBrewStage);

  const notStarted = index < 0;
  const complete = index >= stages.length;
  const nextStage = index + 1 < stages.length ? stages[index + 1] : null;
  // Markers are a prefix of the stage list, so the last one is always the
  // stage being displayed — including the one written when the brew finished.
  const enteredAt = markers.length > 0 ? markers[markers.length - 1].ts : null;

  const heading = notStarted ? 'Not started' : complete ? 'Brew complete' : stages[index];
  const detail = notStarted
    ? 'Nothing recorded yet'
    : enteredAt != null
    ? `${complete ? 'Finished' : 'Started'} ${formatClock(enteredAt)}`
    : ' ';

  // "Start:" rather than "Next:" for the first one — the brew has not begun,
  // and the timestamp this writes is the one every later stage is read against.
  const forwardLabel = complete
    ? null
    : notStarted
    ? `Start: ${stages[0]}`
    : nextStage
    ? `Next: ${nextStage}`
    : 'Finish brew';

  const handleForward = () => {
    playToggleOn();
    stepBrewStage(1);
  };

  const handleBack = () => {
    playToggleOff();
    stepBrewStage(-1);
  };

  return (
    <div className={styles.stageCard}>
      <div className={styles.header}>
        <span className={styles.label}>Brew Stage</span>
        <span className={styles.step}>
          {notStarted ? `${stages.length} stages` : complete ? 'Done' : `Step ${index + 1} of ${stages.length}`}
        </span>
      </div>

      <div className={styles.body}>
        <div className={`${styles.heading} ${notStarted || complete ? styles.headingIdle : ''}`}>
          {heading}
        </div>
        <div className={styles.detail}>{detail}</div>
      </div>

      <div className={styles.controls}>
        <button
          className={styles.backBtn}
          onClick={handleBack}
          disabled={notStarted}
          aria-label="Previous stage"
        >
          ‹
        </button>
        <button
          className={`${styles.forwardBtn} ${complete ? styles.forwardDone : ''}`}
          onClick={handleForward}
          disabled={complete}
        >
          <span className={styles.forwardText}>{forwardLabel ?? 'Brew complete'}</span>
          {!complete && <span className={styles.forwardChevron}>›</span>}
        </button>
      </div>
    </div>
  );
}

export default BrewStageCard;
