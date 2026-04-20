import { parse, formatHex } from 'culori'

/**
 * Parse an OKLCH CSS string (e.g. "oklch(0.205 0 0)" or "oklch(0.205 0 0 / 0.5)")
 * and return a 6-digit hex string (without alpha).
 *
 * Returns '#000000' for invalid/unparseable strings.
 */
export function parseOKLCH(oklchString: string): string {
  const color = parse(oklchString)
  if (!color) {
    return '#000000'
  }
  // formatHex converts any culori color to a 6-digit hex string
  const hex = formatHex(color)
  return hex
}

/**
 * Convert Figma RGB floats (0-1 range) to a 6-digit hex string.
 * Values are clamped to [0, 1] before conversion.
 */
export function figmaRGBToHex(rgb: {
  r: number
  g: number
  b: number
}): string {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const toHexByte = (v: number) =>
    Math.round(clamp(v) * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${toHexByte(rgb.r)}${toHexByte(rgb.g)}${toHexByte(rgb.b)}`
}

/**
 * Compare two hex color strings with optional per-channel tolerance.
 * Returns true if all RGB channels are within the tolerance (default ±1).
 *
 * Accepts hex strings with or without '#' prefix, case-insensitive.
 */
export function colorsMatch(
  hex1: string,
  hex2: string,
  tolerance: number = 1
): boolean {
  const parseHex = (hex: string): [number, number, number] | null => {
    const cleaned = hex.replace(/^#/, '')
    if (cleaned.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      return null
    }
    return [
      parseInt(cleaned.slice(0, 2), 16),
      parseInt(cleaned.slice(2, 4), 16),
      parseInt(cleaned.slice(4, 6), 16)
    ]
  }

  const c1 = parseHex(hex1)
  const c2 = parseHex(hex2)

  if (!c1 || !c2) {
    return false
  }

  return (
    Math.abs(c1[0] - c2[0]) <= tolerance &&
    Math.abs(c1[1] - c2[1]) <= tolerance &&
    Math.abs(c1[2] - c2[2]) <= tolerance
  )
}
