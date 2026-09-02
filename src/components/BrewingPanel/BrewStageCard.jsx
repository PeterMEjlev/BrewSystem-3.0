import { useSyncExternalStore } from 'react';
import {
  subscribeBrewStage,
  getBrewStage,
  getBrewSessionActive,
  stepBrewStage,
} from '../../utils/brewStage';
import { playToggleOn, playToggleOff } from '../../utils/sounds';
import styles from './BrewStageCard.module.css';

const formatClock = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Where the brew day has got to, in the space under the MLT card.
 *
 * One row: the stage that is running, flanked by the two chevrons that move
 * off it. The stage ahead is named under the current one — the brewer never
 * has to remember the running order — and the forward chevron is the warm one
 * because going forward is the thing being done all day, while going back is
 * undoing a wrong tap.
 *
 * With no brew session in BrewPlanner's logbook the card goes inert. A stage
 * mark is a label on a logged session's temperature curve, so with no session
 * there is nothing for one to belong to — and brewing without a session is a
 * normal thing to be doing here (cleaning, a water test, seasoning an element),
 * not a state to be nagged about. Dimmed rather than removed: the panel is one
 * screen with no room to redistribute, and a card appearing under the brewer's
 * hand would move the pumps at the moment a brew starts.
 */
function BrewStageCard() {
  const { stages, index, markers } = useSyncExternalStore(subscribeBrewStage, getBrewStage);
  const sessionActive = useSyncExternalStore(subscribeBrewStage, getBrewSessionActive);

  const notStarted = index < 0;
  const complete = index >= stages.length;
  const nextStage = index + 1 < stages.length ? stages[index + 1] : null;
  // Markers are a prefix of the stage list, so the last one is always the
  // stage being displayed — including the one written when the brew finished.
  const enteredAt = markers.length > 0 ? markers[markers.length - 1].ts : null;

  const heading = notStarted ? 'Not started' : complete ? 'Brew complete' : stages[index];
  const step = notStarted
    ? `${stages.length} stages`
    : complete
    ? 'Done'
    : `${index + 1}/${stages.length}`;

  // What the forward chevron moves to. Before the brew begins that is the
  // first stage, whose timestamp every later one is read against; on the last
  // stage it is the end of the brew rather than another name.
  const ahead = complete ? null : notStarted ? stages[0] : nextStage ?? 'Finish brew';
  const since = enteredAt == null ? null : `${complete ? 'ended' : 'since'} ${formatClock(enteredAt)}`;

  // Why the chevrons are dead, in the line that would otherwise name the stage
  // ahead — where the brewer is already looking for what happens next.
  const meta = sessionActive ? ahead && `› ${ahead}` : 'No brew session';

  const handleForward = () => {
    playToggleOn();
    stepBrewStage(1);
  };

  const handleBack = () => {
    playToggleOff();
    stepBrewStage(-1);
  };

  return (
    <div className={`${styles.stageCard} ${sessionActive ? '' : styles.inactive}`}>
      <button
        className={styles.backBtn}
        onClick={handleBack}
        disabled={!sessionActive || notStarted}
        aria-label="Previous stage"
      >
        ‹
      </button>

      <div className={styles.body}>
        <div className={styles.eyebrow}>
          <span className={styles.label}>Brew Stage</span>
          <span className={styles.step}>{step}</span>
        </div>
        <div
          className={`${styles.heading} ${
            notStarted || complete || !sessionActive ? styles.headingIdle : ''
          }`}
        >
          {heading}
        </div>
        <div className={styles.meta}>
          <span className={styles.ahead}>{meta}</span>
          {sessionActive && since && <span className={styles.since}>{since}</span>}
        </div>
      </div>

      <button
        className={styles.forwardBtn}
        onClick={handleForward}
        disabled={!sessionActive || complete}
        aria-label={
          !sessionActive ? 'No brew session' : complete ? 'Brew complete' : `Next stage: ${ahead}`
        }
      >
        ›
      </button>
    </div>
  );
}

export default BrewStageCard;
