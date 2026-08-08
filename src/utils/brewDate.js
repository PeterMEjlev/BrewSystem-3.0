// Dates as a `<input type="date">` wants them, and back again.
//
// Ported from BrewPlanner's own brew-session dialog so a session started at the
// rig lands on the same day in the logbook as one started from the web server.

/**
 * An ISO instant as the `yyyy-mm-dd` a date input wants, in *local* time.
 * `toISOString().slice(0, 10)` is the UTC day, which in Denmark is yesterday's
 * date for anything brewed after 01:00 in summer.
 */
export function dateInputValue(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A `yyyy-mm-dd` from a date input back to an ISO instant. For a brew being
 * back-dated from scratch, midday is a better guess than midnight — it is the
 * one time of day that stays on the intended date in any timezone the figure
 * might later be read in.
 */
export function dateInputToIso(value) {
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();
}
