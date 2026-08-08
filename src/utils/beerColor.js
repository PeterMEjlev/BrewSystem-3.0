// What a beer of a given colour actually looks like in the glass, for the
// swatches on recipe rows.
//
// EBC is what recipes are written in here; the reference chart is published in
// SRM, so the conversion happens first (SRM = EBC / 1.97).

// Standard SRM colour chart (index = SRM value 1–40+)
const SRM_COLORS = [
  '#FFE699', // 1
  '#FFD878', // 2
  '#FFCA5A', // 3
  '#FFBF42', // 4
  '#FBB123', // 5
  '#F8A600', // 6
  '#F39C00', // 7
  '#EA8F00', // 8
  '#E58500', // 9
  '#DE7C00', // 10
  '#D77200', // 11
  '#CF6900', // 12
  '#CB6200', // 13
  '#C35900', // 14
  '#BB5100', // 15
  '#B54C00', // 16
  '#A63E00', // 17
  '#8D3200', // 18
  '#7C2A00', // 19
  '#6B2400', // 20
  '#5E1E00', // 21
  '#531A00', // 22
  '#4A1700', // 23
  '#421500', // 24
  '#3B1200', // 25
  '#341000', // 26
  '#2E0E00', // 27
  '#290C00', // 28
  '#250B00', // 29
  '#200A00', // 30
  '#1C0900', // 31
  '#180800', // 32
  '#150700', // 33
  '#120600', // 34
  '#100500', // 35
  '#0E0500', // 36
  '#0C0400', // 37
  '#0A0300', // 38
  '#080300', // 39
  '#060200', // 40
];

// Null for a recipe that doesn't state its colour — callers draw no swatch
// rather than guessing at a shade.
export function ebcToColor(ebc) {
  const n = parseFloat(ebc);
  if (isNaN(n)) return null;
  const srm = n / 1.97;
  const idx = Math.min(Math.max(Math.round(srm) - 1, 0), SRM_COLORS.length - 1);
  return SRM_COLORS[idx];
}
