import { useState, useEffect, useCallback } from 'react';
import { playClick } from '../../utils/sounds';
import * as keys from './keypadInput';
import styles from './NumericKeypad.module.css';

/**
 * On-screen number pad, for entering a value on a rig that has no keyboard.
 *
 * The kiosk has never had one attached (see electron/main.js, which cannot even
 * offer a "press any key to reload"), so a plain <input type="number"> is not a
 * slow way to enter a gravity here — it is no way at all. Stepper buttons were
 * the other candidate and work well over a narrow range, but a gravity moves in
 * thousandths across 1.000–1.150, which is a hundred taps. Digits are five.
 *
 * Values are strings throughout, and are handed back exactly as typed: callers
 * already parse with parseFloat and decide what an out-of-range number means.
 * "" comes back for a field the brewer cleared, which parses to NaN the same as
 * an empty input always did.
 */

// Tapping a number first replaces what was there; tapping backspace first edits
// it. Re-running a calculation with one figure changed is the common case, and
// so is redoing it from scratch — this serves both without a mode switch.
function NumericKeypad({ label, unit, initialValue = '', allowNegative = false, onCommit, onCancel }) {
  const [draft, setDraft] = useState(initialValue);
  const [replacing, setReplacing] = useState(initialValue !== '');

  const appendChar = useCallback((char) => {
    setDraft((current) => keys.appendChar(current, char, replacing));
    setReplacing(false);
  }, [replacing]);

  const backspace = useCallback(() => {
    // Backspacing out of the replace state edits the old value rather than
    // discarding it — otherwise the first tap would silently throw it away.
    setDraft(keys.backspace);
    setReplacing(false);
  }, []);

  const clear = useCallback(() => {
    setDraft('');
    setReplacing(false);
  }, []);

  const toggleSign = useCallback(() => {
    setDraft(keys.toggleSign);
    setReplacing(false);
  }, []);

  const commit = useCallback(() => {
    onCommit(keys.commitValue(draft));
  }, [draft, onCommit]);

  // A keyboard is not there on the rig, but it is on the machine this is
  // developed on, and plugging one in to fix something should not mean losing
  // the pad's keys.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key >= '0' && e.key <= '9') appendChar(e.key);
      else if (e.key === '.' || e.key === ',') appendChar('.');
      else if (e.key === 'Backspace') backspace();
      else if (e.key === 'Delete') clear();
      else if (e.key === '-' && allowNegative) toggleSign();
      else if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') onCancel();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [appendChar, backspace, clear, toggleSign, commit, onCancel, allowNegative]);

  const tap = (fn) => () => { playClick(); fn(); };

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`Enter ${label}`}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className={styles.pad}>
        <div className={styles.fieldName}>{label}</div>

        <div className={`${styles.readout} ${replacing ? styles.readoutReplacing : ''}`}>
          <span className={styles.readoutValue}>{draft === '' ? '0' : draft}</span>
          {unit && <span className={styles.readoutUnit}>{unit}</span>}
        </div>

        <div className={styles.keys}>
          {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((digit) => (
            <button key={digit} type="button" className={styles.key} onClick={tap(() => appendChar(digit))}>
              {digit}
            </button>
          ))}
          <button type="button" className={styles.key} onClick={tap(() => appendChar('.'))}>.</button>
          <button type="button" className={styles.key} onClick={tap(() => appendChar('0'))}>0</button>
          <button
            type="button"
            className={`${styles.key} ${styles.keyMuted}`}
            onClick={tap(backspace)}
            aria-label="Backspace"
          >
            ⌫
          </button>
        </div>

        <div className={styles.secondaryRow}>
          {allowNegative && (
            <button type="button" className={styles.secondaryBtn} onClick={tap(toggleSign)} aria-label="Toggle sign">
              ±
            </button>
          )}
          <button type="button" className={styles.secondaryBtn} onClick={tap(clear)}>Clear</button>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={tap(onCancel)}>Cancel</button>
          <button type="button" className={styles.doneBtn} onClick={tap(commit)}>Done</button>
        </div>
      </div>
    </div>
  );
}

export default NumericKeypad;
