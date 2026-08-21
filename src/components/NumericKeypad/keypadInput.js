/**
 * The rules behind the number pad's keys, kept apart from the component that
 * draws them so they can be reasoned about on their own.
 *
 * A draft is the value as typed so far, held as a string: "1.0" and "1" are
 * different things to someone halfway through entering a gravity, and a number
 * cannot tell them apart. `replacing` is the state a field opens in when it
 * already holds a value — the next digit starts over, so re-running a
 * calculation with one figure changed does not begin with five backspaces.
 */

// Long enough for any gravity, volume or temperature the rig deals in, short
// enough that a leant-on key cannot grow the string without bound.
export const MAX_LENGTH = 12;

/** Add a digit or a decimal point, returning the new draft. */
export function appendChar(draft, char, replacing = false) {
  const base = replacing ? '' : draft;
  if (char === '.') {
    if (base.includes('.')) return base;
    // A bare "." is not a number anyone means to type; make it "0.".
    if (base === '' || base === '-') return `${base}0.`;
  }
  if (base.length >= MAX_LENGTH) return base;
  return base + char;
}

/** Drop the last character. */
export function backspace(draft) {
  return draft.slice(0, -1);
}

/** Flip between a positive and a negative draft. */
export function toggleSign(draft) {
  return draft.startsWith('-') ? draft.slice(1) : `-${draft}`;
}

/**
 * What the field should be handed on Done.
 *
 * A draft that is only a sign or only a point is not a number, and a trailing
 * point is someone who stopped halfway; both come back as "" or without it
 * rather than as something parseFloat would read differently than it looks.
 */
export function commitValue(draft) {
  if (draft === '' || draft === '-' || draft === '.' || draft === '-.') return '';
  return draft.endsWith('.') ? draft.slice(0, -1) : draft;
}
