import { describe, it, expect } from 'vitest'
import { tailwindToPx, pxToTailwind } from '../value-mapping'
import { SPACING_MAP, RADIUS_MAP } from '../constants'

describe('value-mapping', () => {
  describe('tailwindToPx', () => {
    it('converts spacing classes to pixel values', () => {
      expect(tailwindToPx('gap-1')).toBe(4)
      expect(tailwindToPx('gap-2')).toBe(8)
      expect(tailwindToPx('gap-4')).toBe(16)
      expect(tailwindToPx('p-4')).toBe(16)
      expect(tailwindToPx('px-3')).toBe(12)
      expect(tailwindToPx('py-2')).toBe(8)
    })

    it('converts radius classes to pixel values', () => {
      expect(tailwindToPx('rounded-sm')).toBe(5)
      expect(tailwindToPx('rounded-md')).toBe(8)
      expect(tailwindToPx('rounded-lg')).toBe(10)
      expect(tailwindToPx('rounded-xl')).toBe(14)
      expect(tailwindToPx('rounded-full')).toBe(9999)
      expect(tailwindToPx('rounded-4xl')).toBe(26)
    })

    it('returns undefined for unknown classes', () => {
      expect(tailwindToPx('gap-99')).toBeUndefined()
      expect(tailwindToPx('rounded-none')).toBeUndefined()
      expect(tailwindToPx('text-lg')).toBeUndefined()
      expect(tailwindToPx('')).toBeUndefined()
    })

    it('handles fractional spacing classes', () => {
      expect(tailwindToPx('gap-1.5')).toBe(6)
      expect(tailwindToPx('px-2.5')).toBe(10)
    })

    it('returns correct values for all SPACING_MAP entries', () => {
      for (const [className, px] of Object.entries(SPACING_MAP)) {
        expect(tailwindToPx(className)).toBe(px)
      }
    })

    it('returns correct values for all RADIUS_MAP entries', () => {
      for (const [className, px] of Object.entries(RADIUS_MAP)) {
        expect(tailwindToPx(className)).toBe(px)
      }
    })
  })

  describe('pxToTailwind', () => {
    it('converts pixel values to spacing classes', () => {
      expect(pxToTailwind(4, 'spacing')).toBe('gap-1')
      expect(pxToTailwind(8, 'spacing')).toBe('gap-2')
      expect(pxToTailwind(16, 'spacing')).toBe('gap-4')
    })

    it('converts pixel values to radius classes', () => {
      expect(pxToTailwind(5, 'radius')).toBe('rounded-sm')
      expect(pxToTailwind(8, 'radius')).toBe('rounded-md')
      expect(pxToTailwind(10, 'radius')).toBe('rounded-lg')
      expect(pxToTailwind(14, 'radius')).toBe('rounded-xl')
      expect(pxToTailwind(9999, 'radius')).toBe('rounded-full')
      expect(pxToTailwind(26, 'radius')).toBe('rounded-4xl')
    })

    it('returns undefined for unmapped pixel values', () => {
      expect(pxToTailwind(999, 'spacing')).toBeUndefined()
      expect(pxToTailwind(7, 'radius')).toBeUndefined()
      expect(pxToTailwind(0, 'spacing')).toBeUndefined()
    })

    it('returns the first matching class for duplicate px values in spacing', () => {
      // 4px maps to gap-1, p-1, px-1, py-1 — should return the first one
      const result = pxToTailwind(4, 'spacing')
      expect(result).toBeDefined()
      expect(SPACING_MAP[result!]).toBe(4)
    })

    it('uses spacing map when type is spacing', () => {
      // 8 maps to gap-2 in spacing, rounded-md in radius
      const spacingResult = pxToTailwind(8, 'spacing')
      expect(spacingResult).toBeDefined()
      expect(spacingResult).not.toContain('rounded')
    })

    it('uses radius map when type is radius', () => {
      // 8 maps to gap-2 in spacing, rounded-md in radius
      const radiusResult = pxToTailwind(8, 'radius')
      expect(radiusResult).toBe('rounded-md')
    })
  })

  describe('round-trip: tailwindToPx → pxToTailwind', () => {
    it('round-trips all RADIUS_MAP entries', () => {
      for (const [className, px] of Object.entries(RADIUS_MAP)) {
        const converted = tailwindToPx(className)
        expect(converted).toBe(px)
        const roundTripped = pxToTailwind(converted!, 'radius')
        expect(roundTripped).toBe(className)
      }
    })

    it('round-trips unique SPACING_MAP entries (first match for duplicate px values)', () => {
      // For spacing, multiple classes can map to the same px value.
      // The round-trip should return *some* valid class for that px value.
      const seenPx = new Set<number>()
      for (const [className, px] of Object.entries(SPACING_MAP)) {
        if (seenPx.has(px)) continue
        seenPx.add(px)

        const converted = tailwindToPx(className)
        expect(converted).toBe(px)
        const roundTripped = pxToTailwind(converted!, 'spacing')
        expect(roundTripped).toBeDefined()
        expect(SPACING_MAP[roundTripped!]).toBe(px)
      }
    })
  })
})
