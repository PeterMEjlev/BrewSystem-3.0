/**
 * What a fruited beer actually pours, as opposed to what its grain bill implies.
 *
 * Ported from BrewPlanner's `predictBeerColor` so a recipe's swatch is the same
 * colour on both screens. Kept close to the original on purpose: this is one
 * piece of tuned behaviour (the scale below was fitted against a real batch),
 * and two versions that drift apart would be worse than one copy.
 */

import { ebcToColor } from './beerColor';

/**
 * How a fruit stains beer.
 *
 * `pigment` is read as a *transmittance* rather than as a paint colour: it's
 * what a heavily fruited beer lets through per channel, so raspberry's near-zero
 * green is what makes a pale gose go red rather than orange. `strength` is
 * staining power relative to raspberry, which is what separates blackcurrant
 * (stains at a splash) from peach (barely shifts a pale ale at 20%).
 *
 * In match order — a name is tested against each in turn and the first hit wins,
 * so compounds come before the bare fruit they contain ("blood orange" before
 * "orange"). Danish spellings are folded (ø→o, æ→ae, å→a) before matching, so
 * the terms here are the folded forms: "hindbaer", not "hindbær".
 */
const FRUIT_TINTS = [
  // Compounds first — these contain a bare fruit name as a substring.
  { pigment: '#FA4A1E', strength: 0.45, terms: ['blood orange', 'blodappelsin'] },
  { pigment: '#F0E6A0', strength: 0.08, terms: ['green apple', 'gron aeble'] },
  { pigment: '#FF7A0A', strength: 0.5, terms: ['sea buckthorn', 'buckthorn', 'havtorn'] },
  { pigment: '#FF8C64', strength: 0.12, terms: ['pink grapefruit', 'grapefruit', 'grapefrugt'] },
  { pigment: '#E62A96', strength: 0.6, terms: ['dragon fruit', 'dragonfruit', 'pitaya', 'pitahaya', 'kaktusblomst'] },

  // Deep red / purple — the ones that actually recolour a beer.
  { pigment: '#A01A64', strength: 1.0, terms: ['blackcurrant', 'black currant', 'cassis', 'solbaer'] },
  { pigment: '#8A1A5A', strength: 1.0, terms: ['elderberry', 'hyldebaer'] },
  { pigment: '#6A2A8C', strength: 0.95, terms: ['acai'] },
  { pigment: '#A81F7A', strength: 0.95, terms: ['blackberry', 'blackberries', 'brombaer'] },
  { pigment: '#FA1A47', strength: 0.9, terms: ['raspberry', 'raspberries', 'hindbaer'] },
  // "blåbær" folds to "blabaer" (å→a); "blaabaer" is the ASCII spelling people
  // also write, so both are listed.
  { pigment: '#7A2AB4', strength: 0.8, terms: ['blueberry', 'blueberries', 'blabaer', 'blaabaer'] },
  { pigment: '#E01432', strength: 0.8, terms: ['cherry', 'cherries', 'morello', 'kirsebaer', 'kriek'] },
  { pigment: '#D01438', strength: 0.7, terms: ['pomegranate', 'granataeble'] },
  { pigment: '#E01438', strength: 0.7, terms: ['cranberry', 'cranberries', 'tranebaer'] },
  { pigment: '#F02040', strength: 0.7, terms: ['redcurrant', 'red currant', 'ribs'] },
  { pigment: '#B02A6E', strength: 0.6, terms: ['plum', 'blomme', 'mirabelle'] },
  { pigment: '#FA3C64', strength: 0.5, terms: ['strawberry', 'strawberries', 'jordbaer'] },
  { pigment: '#F5647D', strength: 0.35, terms: ['rhubarb', 'rabarber'] },
  { pigment: '#A05A78', strength: 0.3, terms: ['fig', 'figen', 'figne'] },

  // Orange / gold — a visible warm shift, but they never make a beer red.
  { pigment: '#FF9632', strength: 0.3, terms: ['papaya'] },
  { pigment: '#FF8C6E', strength: 0.3, terms: ['guava'] },
  { pigment: '#FFA83C', strength: 0.3, terms: ['apricot', 'abrikos'] },
  { pigment: '#FFB41E', strength: 0.3, terms: ['mango'] },
  { pigment: '#FFB428', strength: 0.3, terms: ['passionfruit', 'passion fruit', 'passionsfrugt', 'passion', 'maracuja'] },
  { pigment: '#FFBE6E', strength: 0.25, terms: ['peach', 'fersken', 'nectarine'] },
  { pigment: '#FFD24A', strength: 0.2, terms: ['pineapple', 'ananas'] },
  { pigment: '#FFA032', strength: 0.15, terms: ['tangerine', 'tangerin', 'mandarin', 'clementine'] },
  { pigment: '#FF7A8C', strength: 0.15, terms: ['watermelon', 'vandmelon'] },
  { pigment: '#FFD27A', strength: 0.12, terms: ['melon', 'cantaloupe'] },
  { pigment: '#FFA83C', strength: 0.12, terms: ['orange', 'appelsin', 'valencia'] },

  // Pale to colourless — listed so they're recognised as fruit and reported as
  // "no visible shift" rather than silently ignored.
  { pigment: '#FFF08C', strength: 0.1, terms: ['lemon', 'citron', 'lime', 'calamansi', 'bergamot'] },
  { pigment: '#FFF08C', strength: 0.08, terms: ['yuzu'] },
  { pigment: '#FFE6A0', strength: 0.08, terms: ['banana', 'banan'] },
  { pigment: '#F0E6A0', strength: 0.08, terms: ['apple', 'aeble', 'pear', 'paere', 'williams'] },
  { pigment: '#FFF0DC', strength: 0.05, terms: ['lychee', 'litchi', 'soursop', 'guanabana'] },
  { pigment: '#FFFFFF', strength: 0.03, terms: ['coconut', 'kokos'] },
  { pigment: '#FFFFF0', strength: 0.02, terms: ['elderflower', 'hyldeblomst'] },
];

/**
 * How hard fruit stains, per unit of (strength × batch fraction). Tuned against
 * the house reference: 5 L of raspberry purée in a 55 L pale Berliner Weisse
 * comes out emphatically red, which is what that beer actually looks like.
 */
const FRUIT_TINT_SCALE = 8;

/**
 * Fold a name the way the fruit terms are written: lowercased, Danish letters
 * opened up, accents dropped, punctuation flattened to single spaces.
 */
function foldName(name) {
  return name
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Endings Danish glues straight onto a fruit name — "Solbærpuré",
 * "Havtornpuré", "Blodappelsinpuré" are each one word, and the fruit inside is
 * only reachable by peeling the ending off. Longest first, so "frugtpure" is
 * taken whole rather than leaving a stray "frugt".
 */
const GLUED_ENDINGS = ['frugtpure', 'koncentrat', 'concentrate', 'puree', 'pure', 'juice', 'saft', 'pulp'];

/**
 * The fruit an ingredient line names, or null when it isn't a fruit.
 *
 * Matching is on whole words, so "lime" can't match "slimed" and "passion
 * fruit" matches as a phrase. Compound words are additionally offered stemmed,
 * which is what lets a recipe written as "Solbærpuré" reach blackcurrant.
 */
function matchFruit(name) {
  const words = foldName(name).split(' ').filter(Boolean);
  // Every ending that fits, not just the first: "passionsfrugtpure" stems to
  // both "passions" (peeling "frugtpure") and "passionsfrugt" (peeling "pure"),
  // and only the second is the fruit.
  const stems = words.flatMap((word) =>
    GLUED_ENDINGS.filter((e) => word.length > e.length && word.endsWith(e)).map((e) =>
      word.slice(0, -e.length),
    ),
  );
  const text = ` ${[...words, ...stems].join(' ')} `;
  for (const tint of FRUIT_TINTS) {
    if (tint.terms.some((term) => text.includes(` ${term} `))) return tint;
  }
  return null;
}

function hexToRgb(hex) {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return `#${rgb
    .map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

/** "5 L raspberry in a 55 L batch (9%) — expect a strong red". */
function fruitNote(names, litres, batchSizeL, fraction, intensity) {
  const strength =
    intensity >= 0.55
      ? 'a deep, saturated colour'
      : intensity >= 0.3
        ? 'a strong tint'
        : intensity >= 0.12
          ? 'a noticeable tint'
          : 'barely a shift';
  const round = (n) => (n < 10 ? n.toFixed(1) : n.toFixed(0));
  return (
    `Predicted from the malt colour plus ${round(litres)} L ${names.join(' + ')} ` +
    `in a ${round(batchSizeL)} L batch (${Math.round(fraction * 100)}%) — expect ${strength}. ` +
    'An estimate: real fruit colour varies with variety, dose timing and how much drops out.'
  );
}

/**
 * The colour a beer actually pours, from its malt colour restained by any fruit
 * in the other-ingredients list — so a fruited sour shows red rather than the
 * straw its grain bill implies. Null when there is no usable EBC to start from.
 *
 * `additions` are the recipe's other ingredients; each needs `grams` for a dose,
 * which BrewPlanner has already normalized from whatever unit the recipe used.
 */
export function predictBeerColor({ ebc, batchSizeL, additions }) {
  const base = ebcToColor(ebc);
  if (base == null) return null;

  const doses = (additions || [])
    .map((addition) => {
      const tint = matchFruit(addition.name || '');
      if (tint == null || addition.grams == null || addition.grams <= 0) return null;
      return { tint, name: (addition.name || '').trim(), litres: addition.grams / 1000 };
    })
    .filter(Boolean)
    .sort((a, b) => b.litres - a.litres);

  if (doses.length === 0 || batchSizeL == null || batchSizeL <= 0) {
    return { hex: base, fruit: null };
  }

  // Beer–Lambert: stack each fruit's transmittance, raised to its own dose.
  const rgb = hexToRgb(base);
  const stained = [rgb[0], rgb[1], rgb[2]];
  for (const dose of doses) {
    const exponent = (dose.tint.strength * dose.litres * FRUIT_TINT_SCALE) / batchSizeL;
    const pigment = hexToRgb(dose.tint.pigment);
    for (let i = 0; i < 3; i++) {
      stained[i] = stained[i] * Math.pow(pigment[i] / 255, exponent);
    }
  }

  const litres = doses.reduce((sum, d) => sum + d.litres, 0);
  const fraction = litres / batchSizeL;
  // How far the colour actually moved, as a share of the distance it could have
  // moved — this is what "a strong red" versus "a hint of gold" means.
  const intensity = Math.min(
    1,
    Math.hypot(stained[0] - rgb[0], stained[1] - rgb[1], stained[2] - rgb[2]) / 255,
  );
  const names = [...new Set(doses.map((d) => d.tint.terms[0] ?? d.name))];

  return {
    hex: rgbToHex(stained),
    fruit: {
      names,
      litres: Math.round(litres * 10) / 10,
      fraction,
      intensity,
      note: fruitNote(names, litres, batchSizeL, fraction, intensity),
    },
  };
}
