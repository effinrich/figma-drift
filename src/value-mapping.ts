import { SPACING_MAP, RADIUS_MAP } from './constants'

/**
 * Look up a Tailwind class name in SPACING_MAP or RADIUS_MAP
 * and return the corresponding pixel value.
 *
 * Returns undefined if the class is not found in either map.
 */
export function tailwindToPx(className: string): number | undefined {
  if (className in SPACING_MAP) {
    return SPACING_MAP[className]
  }
  if (className in RADIUS_MAP) {
    return RADIUS_MAP[className]
  }
  return undefined
}

/**
 * Reverse lookup: given a pixel value and a type ('spacing' or 'radius'),
 * return the first matching Tailwind class name.
 *
 * Returns undefined if no class maps to the given value.
 */
export function pxToTailwind(
  value: number,
  type: 'spacing' | 'radius'
): string | undefined {
  const map = type === 'spacing' ? SPACING_MAP : RADIUS_MAP
  for (const [className, px] of Object.entries(map)) {
    if (px === value) {
      return className
    }
  }
  return undefined
}
