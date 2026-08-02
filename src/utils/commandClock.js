/**
 * When the UI last told the hardware to do something.
 *
 * For a moment after a command the panel is ahead of the rig: the slider is
 * already where the brewer put it while the write is still in flight. A state
 * diff arriving in that window carries the old value and would snap the
 * control back for a frame, so the panel checks this clock before applying
 * pushed control state.
 *
 * It lives out here rather than in the panel because the panel is not the only
 * thing writing. A pump ramp walks the hardware to its target over as much as
 * two seconds, one write every 40 ms — every one of those is the panel's own
 * doing rather than news from the rig, and the slider should stay on the
 * target the brewer chose for the whole of it.
 */

let lastCommandAt = 0;

/** Stamp the clock. Call from anything that writes to the hardware. */
export function markCommand() {
  lastCommandAt = Date.now();
}

/** Milliseconds since the last write. Large number if there has never been one. */
export function msSinceCommand() {
  return Date.now() - lastCommandAt;
}
