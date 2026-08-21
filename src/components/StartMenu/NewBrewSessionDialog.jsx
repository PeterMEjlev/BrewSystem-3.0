import { useState, useEffect, useRef } from 'react';
import { playClick } from '../../utils/sounds';
import { ebcToColor } from '../../utils/beerColor';
import { dateInputValue, dateInputToIso } from '../../utils/brewDate';
import styles from './NewBrewSessionDialog.module.css';

// How far a drag has to travel before it stops counting as a tap. Below this,
// a finger that shifts a pixel or two on the way down still picks the recipe it
// landed on; above it, the gesture was a scroll and must not choose anything.
const DRAG_SLOP_PX = 6;

/**
 * Pick a recipe and start its brew session — the same two fields BrewPlanner
 * asks for on its own Brew Sessions page, so a session started at the rig and
 * one started from a phone produce the same row.
 *
 * The recipes come from BrewPlanner's library rather than this rig's Brewer's
 * Friend list: the session is filed against a recipe there, and a recipe that
 * has never been imported has an id BrewPlanner would refuse. The list is
 * fetched once by the start menu and handed down, so opening this dialog costs
 * no wait.
 */
function NewBrewSessionDialog({ recipes, onClose, onStart }) {
  const today = dateInputValue(null);
  const [recipeId, setRecipeId] = useState(() => recipes[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const listRef = useRef(null);
  // Whether the gesture in progress turned into a scroll. Read by the rows, so
  // that dragging the list past a recipe does not also select it.
  const draggedRef = useRef(false);

  /**
   * Drag the list to scroll it.
   *
   * The rig's panel reports itself as a mouse rather than emitting touch
   * events, and a mouse drag does not scroll a container — so with the
   * scrollbar hidden there was no way to reach the recipes below the fold.
   * A real touch pointer is left alone: the browser already scrolls it, with
   * momentum, and doing it here as well would move the list twice as far.
   *
   * Listeners go on the window rather than the list, so a drag that runs off
   * the top or bottom edge — easy on a list this short — keeps scrolling
   * instead of stopping dead and resuming with a jump.
   */
  const startDragScroll = (e) => {
    draggedRef.current = false;
    if (e.pointerType === 'touch') return;

    const list = listRef.current;
    if (!list) return;
    const startY = e.clientY;
    const startScroll = list.scrollTop;

    const onMove = (move) => {
      const delta = move.clientY - startY;
      if (Math.abs(delta) > DRAG_SLOP_PX) draggedRef.current = true;
      list.scrollTop = startScroll - delta;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const submit = async () => {
    if (!recipeId || saving) return;
    playClick();
    setSaving(true);
    setError(null);
    try {
      // Today needs no timestamp — the server stamps "now", which keeps the
      // clock time a brew session actually started at.
      await onStart(recipeId, date === today ? null : dateInputToIso(date));
    } catch (err) {
      setError(err?.message || 'Could not start the brew session.');
      setSaving(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="New brew session"
      onClick={(e) => {
        // A stray touch on the backdrop shouldn't discard a session that is
        // halfway through being created.
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className={styles.dialog}>
        <h2 className={styles.title}>New brew session</h2>
        <p className={styles.subtitle}>
          The recipe is copied onto the entry as it reads today, so the log stays right
          even after the recipe is edited.
        </p>

        {error && <div className={styles.error}>{error}</div>}

        <span className={styles.label} id="brew-session-recipe-label">Recipe</span>
        {recipes.length === 0 ? (
          <p className={styles.emptyList}>No recipes in BrewPlanner</p>
        ) : (
          <div
            ref={listRef}
            className={styles.recipeList}
            role="listbox"
            aria-labelledby="brew-session-recipe-label"
            onPointerDown={startDragScroll}
          >
            {recipes.map((recipe) => {
              const facts = [recipe.style, recipe.abv && `${recipe.abv}%`].filter(Boolean);
              const isSelected = recipe.id === recipeId;
              return (
                <button
                  key={recipe.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`${styles.recipeRow} ${isSelected ? styles.recipeRowSelected : ''}`}
                  disabled={saving}
                  onClick={() => {
                    // Read and clear: a drag suppresses exactly the click it
                    // produced, and nothing after it. Left set, it would also
                    // swallow the next keyboard activation, which arrives as a
                    // click with no pointer gesture in front of it.
                    const wasDrag = draggedRef.current;
                    draggedRef.current = false;
                    if (wasDrag) return;
                    playClick();
                    setRecipeId(recipe.id);
                  }}
                >
                  <span
                    className={styles.rowSwatch}
                    style={{ background: ebcToColor(recipe.ebc) || 'transparent' }}
                  />
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{recipe.name}</span>
                    {facts.length > 0 && <span className={styles.rowFacts}>{facts.join(' · ')}</span>}
                  </span>
                  {isSelected && <span className={styles.rowCheck} aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
        )}

        <label className={styles.label} htmlFor="brew-session-date">Brew date</label>
        <input
          id="brew-session-date"
          className={styles.dateInput}
          type="date"
          value={date}
          max={today}
          disabled={saving}
          onChange={(e) => setDate(e.target.value)}
        />

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={() => { playClick(); onClose(); }}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.startBtn}
            onClick={submit}
            disabled={!recipeId || saving}
          >
            {saving ? 'Starting…' : 'Start brew session'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default NewBrewSessionDialog;
