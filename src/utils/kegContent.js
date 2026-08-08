/**
 * What's in a keg, and what colour it pours.
 *
 * The keg board is a Google Sheet both this rig and BrewPlanner read, so a keg
 * has to look the same on both screens. BrewPlanner owns the palette — it has
 * the editor for it, under Settings → Keg content colours — and this rig follows
 * along, falling back to the values below when there's no web server to ask.
 * Those defaults are the palette BrewPlanner ships with, so an unreachable
 * BrewPlanner looks exactly like it always did rather than like a bug.
 */

// Colours chosen to evoke the actual appearance of each beer / keg state.
export const DEFAULT_CONTENT_COLORS = {
  'IPA':       '#C8782A', // amber copper
  'NEIPA':     '#3ee849', // hazy orange-gold
  'Wiessbeer': '#E8C84A', // cloudy banana-gold
  'Sour':      '#D64878', // tart raspberry pink
  'Brown Ale': '#7A3B1A', // rich mahogany
  'Starsan':   '#b8faff', // sanitiser blue
  'SIPA':      '#2a9826', // lighter golden session IPA
  'Pilsner':   '#DEC05C', // pale straw gold
  'Stout':     '#3A2A1A', // near-black dark roast (card uses overrides)
  'Dirty':     '#ff0000', // warning red-brown
  'Clean':     '#ffffff', // fresh aqua
  '???':       '#707070', // neutral grey
};

// Derived from the palette rather than listed again, so every option has a
// colour and every colour is selectable — the same rule BrewPlanner follows.
export const CONTENT_OPTIONS = Object.keys(DEFAULT_CONTENT_COLORS);

/**
 * Terms that map a recipe onto one of the palette's beer types, in match order —
 * the first hit wins, so the more specific rule has to come first.
 *
 * Sour leads: a Berliner Weisse is a wheat beer and a sour IPA is an IPA, but
 * what either one pours as — and what the keg board is saying — is sour. NEIPA
 * and SIPA are subsets of IPA, so both precede the bare IPA rule.
 *
 * Word boundaries matter: bare "ipa" would otherwise match "Ipanema", and "wit"
 * would match "Wit(h) Honey". Styles the palette has no colour for (Saison,
 * Helles Bock, Schwarzbier) are deliberately left unmatched rather than forced
 * into the nearest slot — a missing colour is honest, a wrong one isn't.
 *
 * Kept in step with BrewPlanner's own rules, so linking the same recipe there
 * and here labels the keg the same.
 */
const CONTENT_MATCH_RULES = [
  ['Sour', /\b(sour|gose|berliner|lambic|gueuze|geuze|kriek|flanders|oud bruin|wild ale|brett\w*)\b/],
  ['Stout', /\b(stout|porter)\b/],
  ['NEIPA', /\b(neipa|ne ipa|new england|hazy)\b/],
  ['SIPA', /\b(sipa|session ipa)\b/],
  ['IPA', /\b(ipa|iipa|india pale ale)\b/],
  // "wiess" as well as "weiss": that's the spelling the palette itself uses.
  ['Wiessbeer', /\b(wheat|weizen|w(ei|ie)ss\w*|wit|witbier|hefe\w*)\b/],
  ['Pilsner', /\b(pilsner|pils|lager|helles)\b/],
  ['Brown Ale', /\b(brown ale|nut brown)\b/],
];

/**
 * Best-effort map of a recipe's name/style onto one of the known content
 * options, so linking a Brewer's Friend recipe can pre-fill the contents field
 * (e.g. "Galaxy NEIPA" → "NEIPA", "My Tropical Gose" → "Sour"). Null when
 * nothing matches, leaving the caller to fall back to the recipe name.
 *
 * Name and style are tested together, one rule at a time, so priority is decided
 * by the rules rather than by which field happened to mention a beer first —
 * "Peach Fuzz" / "Berliner Weisse" is a sour, whichever half says so. They're
 * joined by a separator no pattern can span, so no rule matches a phrase that
 * only exists across the seam.
 */
export function matchContentOption(recipeName, recipeStyle = '') {
  const text = `${recipeName || ''} | ${recipeStyle || ''}`.toLowerCase();
  for (const [content, pattern] of CONTENT_MATCH_RULES) {
    if (pattern.test(text)) return content;
  }
  return null;
}

/** The colour for a keg's contents, matched case-insensitively. Null if unknown. */
export function getContentColor(contents, colors = DEFAULT_CONTENT_COLORS) {
  const key = CONTENT_OPTIONS.find(
    (k) => k.toLowerCase() === String(contents || '').trim().toLowerCase(),
  );
  return key ? colors[key] : null;
}

/**
 * BrewPlanner's palette, merged over the defaults. Returns the defaults
 * unchanged for every way there might not be an answer — no web server
 * configured, unreachable, a reply that isn't a palette — because the keg board
 * is worth drawing in either case.
 */
export async function fetchContentColors() {
  try {
    const response = await fetch('/api/brew-planner/keg-colors');
    if (!response.ok) return DEFAULT_CONTENT_COLORS;
    const data = await response.json();
    if (!data.colors || typeof data.colors !== 'object') return DEFAULT_CONTENT_COLORS;
    // Merged, not replaced: a palette from a BrewPlanner that has since gained a
    // content type this rig doesn't know still colours the ones it does.
    return { ...DEFAULT_CONTENT_COLORS, ...data.colors };
  } catch {
    return DEFAULT_CONTENT_COLORS;
  }
}
