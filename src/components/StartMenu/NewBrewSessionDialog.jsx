import { useState, useEffect } from 'react';
import { playClick } from '../../utils/sounds';
import { ebcToColor } from '../../utils/beerColor';
import { dateInputValue, dateInputToIso } from '../../utils/brewDate';
import styles from './NewBrewSessionDialog.module.css';

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

  const selected = recipes.find((r) => r.id === recipeId);
  const swatch = ebcToColor(selected?.ebc);

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

        <label className={styles.label} htmlFor="brew-session-recipe">Recipe</label>
        <div className={styles.selectWrap}>
          {swatch && <span className={styles.swatch} style={{ background: swatch }} />}
          <select
            id="brew-session-recipe"
            className={`${styles.select} ${swatch ? styles.selectWithSwatch : ''}`}
            value={recipeId}
            onChange={(e) => setRecipeId(e.target.value)}
            disabled={saving || recipes.length === 0}
          >
            {recipes.length === 0 && <option value="">No recipes in BrewPlanner</option>}
            {recipes.map((recipe) => {
              const facts = [recipe.style, recipe.abv && `${recipe.abv}%`].filter(Boolean);
              return (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.name}{facts.length > 0 ? ` — ${facts.join(' · ')}` : ''}
                </option>
              );
            })}
          </select>
        </div>

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
