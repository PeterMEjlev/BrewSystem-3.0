import { useState, useEffect } from 'react';
import { playClick, playNavigate } from '../../utils/sounds';
import NewBrewSessionDialog from './NewBrewSessionDialog';
import styles from './StartMenu.module.css';

/**
 * Where the app opens: brewing with a session behind it, or brewing without one.
 *
 * A session is a row in BrewPlanner's logbook. Starting one there is what makes
 * the web server snapshot the recipe, put the beer in the fermenter and begin
 * sampling this rig's pot temperatures — so a brew started here comes out of the
 * day with a curve against it, and one started with "Go to brewing system" does
 * not. Both are legitimate: cleaning, a water test and a boil to season an
 * element are all brewing, and none of them belongs in the logbook.
 *
 * The picker reads `/api/recipes`, the same library the Recipe tab shows, so
 * what can be started here and what can be read there are one list.
 */
function StartMenu({ onStartSession, onSkipSession }) {
  const [recipes, setRecipes] = useState([]);
  // Null while we're still asking. The choice is neither offered nor refused
  // until we know, so a slow web server never flashes "unavailable" at a brewer
  // who could in fact start a session.
  const [available, setAvailable] = useState(null);
  const [reason, setReason] = useState(null);
  const [activeBrew, setActiveBrew] = useState(null);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Both are LAN round trips to the other Pi — asked together rather than
        // one after the other, so the menu settles in one server's worth of wait.
        const [recipeRes, activeRes] = await Promise.all([
          fetch('/api/recipes'),
          fetch('/api/brew-planner/active-brew'),
        ]);
        const data = await recipeRes.json();
        const active = await activeRes.json();
        if (cancelled) return;
        setRecipes(data.recipes || []);
        setAvailable(Boolean(data.available));
        setReason(data.error || null);
        setActiveBrew(active.active ? active : null);
      } catch {
        if (cancelled) return;
        setAvailable(false);
        setReason('Could not reach the brew server.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // An empty library is its own dead end: BrewPlanner is answering, there is
  // simply nothing to brew from, and the fix is on the web server.
  const canStart = available === true && recipes.length > 0;
  const unavailableNote = available === null
    ? null
    : !available
      ? (reason || 'BrewPlanner is unreachable — brewing without a session.')
      : recipes.length === 0
        ? 'No recipes in BrewPlanner yet.'
        : null;

  return (
    <div className={styles.startMenu}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <h1 className={styles.title}>Konfus Brewing</h1>
          <p className={styles.subtitle}>What are we doing today?</p>
        </header>

        {/* Only when there is one, so the ordinary menu stays two clean choices.
            Reached by tapping Home mid-brew, where the launch check no longer
            applies — starting a second session would have BrewPlanner log this
            rig's temperatures against both. */}
        {activeBrew && (
          <p className={styles.activeBrew}>
            <span className={styles.activeDot} />
            Already brewing{activeBrew.name ? ` — ${activeBrew.name}` : ''}
          </p>
        )}

        <div className={styles.choices}>
          <button
            className={`${styles.choice} ${styles.primary}`}
            onClick={() => { playClick(); setChoosing(true); }}
            disabled={!canStart}
          >
            <svg className={styles.choiceIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            <span className={styles.choiceLabel}>Start a new brew session</span>
            <span className={styles.choiceHint}>
              {unavailableNote
                || (activeBrew
                  ? 'Starting another logs a second batch alongside this one'
                  : 'Pick the recipe and log the batch as you brew it')}
            </span>
          </button>

          <button
            className={styles.choice}
            onClick={() => { playNavigate(); onSkipSession(); }}
          >
            <svg className={styles.choiceIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
              />
            </svg>
            <span className={styles.choiceLabel}>Go to the brewing system</span>
            <span className={styles.choiceHint}>Heaters, pumps and temperatures — nothing logged</span>
          </button>
        </div>
      </div>

      {choosing && (
        <NewBrewSessionDialog
          recipes={recipes}
          onClose={() => setChoosing(false)}
          onStart={onStartSession}
        />
      )}
    </div>
  );
}

export default StartMenu;
