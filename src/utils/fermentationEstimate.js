/**
 * Roughly how long a recipe's primary fermentation will take.
 *
 * Ported from BrewPlanner's `estimateFermentationDays` so the rig and the web
 * server give the same answer for the same sheet. Client-side in both, because
 * it needs nothing the recipe doesn't already carry.
 */

/** A bare number string (or number) as a finite number, else null. */
function recipeNumber(value) {
  const parsed =
    typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

const YEAST_FAMILIES = {
  ale: { days: 5, refC: 20, label: 'Ale yeast' },
  lager: { days: 14, refC: 11, label: 'Lager yeast' },
  kveik: { days: 3, refC: 30, label: 'Kveik' },
  // Brett, lacto and the blended cultures: primary is the quick part, and the
  // beer is not finished when it stops bubbling.
  mixed: { days: 60, refC: 20, label: 'Mixed culture' },
};

const KVEIK = /kveik|voss|hornindal|lutra|opshaug|framgarden|ebbegarden|sigmund|hothead|oslo/i;
const MIXED = /brett|sour|lacto|pedio|brux|wild|mixed|philly|funk/i;
const LAGER = /lager|pilsner yeast|w-?34\/?70|s-?23|s-?189|diamond|augustiner|urquell/i;

/** Which clock a pitch runs on, from what the recipe says about the strain. */
function yeastFamily(yeast) {
  const said = `${yeast.type || ''} ${yeast.name || ''}`;
  if (KVEIK.test(said)) return 'kveik';
  if (MIXED.test(said)) return 'mixed';
  if (LAGER.test(said)) return 'lager';
  return 'ale';
}

/** The middle of a strain's stated range, when the recipe names no temperature. */
function optimumTemp(yeast) {
  if (yeast.minTempC != null && yeast.maxTempC != null) return (yeast.minTempC + yeast.maxTempC) / 2;
  return yeast.minTempC ?? yeast.maxTempC;
}

/** Gravity the base figures are quoted at. */
const REFERENCE_OG_POINTS = 50;

/**
 * Roughly how many days the primary fermentation will take: the strain, the
 * temperature it's held at, and how much sugar it has to get through.
 *
 * Three things move it, each the way brewers already talk about them:
 *
 * - **The strain.** A lager at 11 °C is a fortnight where an ale at 20 °C is
 *   under a week, and kveik at 30 °C is a long weekend.
 * - **The temperature.** Yeast follows the usual rule of thumb for reaction
 *   rates — about twice as fast for every 10 °C — so the same beer fermented
 *   cool takes proportionally longer. Clamped either side, because a strain
 *   held far outside its range stalls rather than continuing the curve.
 * - **The gravity.** More sugar is more work, and a big beer also stresses the
 *   yeast doing it, so the figure grows a little faster than linearly.
 *
 * This is a planning number for "when is the fermenter free", not a substitute
 * for two matching hydrometer readings — which is why it comes with a range and
 * a note rather than a single confident day count. Null when the sheet names no
 * yeast at all: with nothing pitched there is nothing to estimate.
 */
export function estimateFermentationDays({ og, temperatureC, yeast }) {
  const pitched = (yeast || []).filter((line) => (line.name || '').trim() !== '');
  if (pitched.length === 0) return null;
  // The slowest pitch decides: a mixed-fermentation beer is not done when its
  // sacch is, and a co-pitch is finished when the last strain is.
  const families = pitched.map(yeastFamily);
  const family =
    ['mixed', 'lager', 'ale', 'kveik'].find((candidate) => families.includes(candidate)) ?? 'ale';
  const profile = YEAST_FAMILIES[family];

  const stated = recipeNumber(temperatureC);
  const assumed = stated == null;
  const heldAt =
    stated ?? pitched.map(optimumTemp).find((value) => value != null) ?? profile.refC;

  // Q10 = 2: every 10 °C below the reference roughly doubles the time, and
  // every 10 above roughly halves it. Bounded because the relationship stops
  // holding at the edges — a strain pushed far past its range doesn't finish in
  // an afternoon, and one chilled far below it stalls rather than merely
  // slowing.
  const heat = Math.min(4, Math.max(0.35, Math.pow(2, (profile.refC - heldAt) / 10)));

  const gravity = recipeNumber(og);
  const points = gravity == null ? REFERENCE_OG_POINTS : Math.max(1, (gravity - 1) * 1000);
  const work = Math.min(3, Math.max(0.6, Math.pow(points / REFERENCE_OG_POINTS, 0.8)));

  const days = Math.max(1, Math.round(profile.days * heat * work));
  return {
    days,
    minDays: Math.max(1, Math.round(days * 0.7)),
    maxDays: Math.max(2, Math.ceil(days * 1.4)),
    temperatureC: heldAt,
    temperatureAssumed: assumed,
    family,
    note: [
      `${profile.label} at ${Math.round(heldAt)} °C`,
      assumed ? '(the strain’s own range — the recipe names no fermentation temperature)' : null,
      gravity == null ? 'on an assumed 1.050 wort' : `on a ${gravity.toFixed(3)} wort`,
      '— time to terminal gravity, before any diacetyl rest, cold crash or conditioning.',
      family === 'mixed' ? 'A mixed culture keeps working for months after that.' : null,
      'Confirm with two matching hydrometer readings.',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
