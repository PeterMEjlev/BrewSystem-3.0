/**
 * Temperature color gradient utility
 * Maps 0-100°C to blue-red gradient (no green/yellow)
 */

export function getTemperatureColor(temp) {
  // Clamp temperature to 0-100 range
  const t = Math.max(0, Math.min(100, temp));

  // Blue (0°C) to Red (100°C)
  // Blue: rgb(59, 130, 246)
  // Red: rgb(239, 68, 68)

  const ratio = t / 100;

  const r = Math.round(59 + (239 - 59) * ratio);
  const g = Math.round(130 - 130 * ratio + 68 * ratio);
  const b = Math.round(246 - (246 - 68) * ratio);

  return `rgb(${r}, ${g}, ${b})`;
}

export function getTemperatureGradient() {
  return 'linear-gradient(to right, rgb(59, 130, 246), rgb(239, 68, 68))';
}
