/**
 * Small shared pieces of how a brew sheet reads, ported from BrewPlanner so the
 * same recipe says the same thing on both screens.
 */

/** A DKK figure the way the rest of the brewery writes it: "432 kr". */
export function kr(amount, decimals = 2) {
  return `${amount.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} kr`;
}

/** Hop stages in the order they happen on brew day, for grouped display. */
export const HOP_STAGE_ORDER = ['Mash', 'First Wort', 'Boil', 'Whirlpool', 'Dry Hop', 'Other'];

/**
 * What one group of ingredient lines costs, and how many of them carried a
 * price. Summing `usedDkk` is the only sum that's meaningful across lines — the
 * buying figure pools repeats of a product before rounding to whole packages,
 * which is why the recipe-wide totals come from the server instead.
 */
export function sumCost(lines) {
  return (lines || []).reduce(
    (acc, line) =>
      line.price
        ? { usedDkk: acc.usedDkk + line.price.usedDkk, priced: acc.priced + 1 }
        : acc,
    { usedDkk: 0, priced: 0 },
  );
}

/**
 * A hop or ingredient's contact time with its unit — "60 min", "5 days".
 *
 * The unit matters: Brewer's Friend stores dry hops in days, so a sheet that
 * assumes minutes turns a 5-day dry hop into "5 min". BrewPlanner records which
 * one each figure is in; this just believes it. Empty string when there's no
 * time worth showing.
 */
export function formatContactTime(time, timeUnit) {
  if (time == null || time === '') return '';
  if (timeUnit === 'day') return `${time} ${Number.parseFloat(time) === 1 ? 'day' : 'days'}`;
  if (timeUnit === 'min') return `${time} min`;
  return String(time);
}
