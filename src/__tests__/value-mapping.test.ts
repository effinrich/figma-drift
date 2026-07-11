import { describe, it, expect } from 'vitest'
import path from 'path'
import {
  tailwindToPx,
  pxToTailwind,
  parseCssLength,
  parseArbitraryUtility,
  resolveTailwindTheme,
  buildScaleMaps,
  resolveSpacingRadiusMaps
} from '../value-mapping'
import { SPACING_MAP, RADIUS_MAP } from '../constants'

const fixture = (p: string) => path.resolve(__dirname, 'fixtures', p)

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

  describe('parseCssLength', () => {
    it('parses px, rem, and em units', () => {
      expect(parseCssLength('13px')).toBe(13)
      expect(parseCssLength('1.5rem')).toBe(24)
      expect(parseCssLength('2em')).toBe(32)
    })

    it('honors a custom root font size', () => {
      expect(parseCssLength('1rem', { rootFontSizePx: 10 })).toBe(10)
    })

    it('treats unitless zero as 0 and rejects other unitless numbers', () => {
      expect(parseCssLength('0')).toBe(0)
      expect(parseCssLength('12')).toBeUndefined()
    })

    it('resolves var() references against a token map', () => {
      expect(
        parseCssLength('var(--spacing-md)', {
          tokenMap: { '--spacing-md': '8px' }
        })
      ).toBe(8)
      // token map key without leading --
      expect(parseCssLength('var(--gap)', { tokenMap: { gap: '1rem' } })).toBe(
        16
      )
    })

    it('falls back to the var() default when the token is unknown', () => {
      expect(parseCssLength('var(--nope, 5px)')).toBe(5)
    })

    it('returns undefined for non-length strings', () => {
      expect(parseCssLength('auto')).toBeUndefined()
      expect(parseCssLength('')).toBeUndefined()
    })
  })

  describe('arbitrary-value parsing', () => {
    it('parses arbitrary spacing/radius utilities directly', () => {
      expect(parseArbitraryUtility('p-[13px]')).toBe(13)
      expect(parseArbitraryUtility('gap-[1.5rem]')).toBe(24)
      expect(parseArbitraryUtility('rounded-[6px]')).toBe(6)
    })

    it('is reachable through tailwindToPx without a map entry', () => {
      expect(tailwindToPx('p-[13px]')).toBe(13)
      expect(tailwindToPx('rounded-[6px]')).toBe(6)
      expect(tailwindToPx('gap-[0.5rem]')).toBe(8)
    })

    it('returns undefined for non-length arbitrary values', () => {
      expect(parseArbitraryUtility('bg-[#fff]')).toBeUndefined()
      expect(parseArbitraryUtility('p-4')).toBeUndefined()
    })
  })

  describe('non-Tailwind raw CSS lengths', () => {
    it('resolves raw length strings and var() tokens through tailwindToPx', () => {
      expect(tailwindToPx('13px')).toBe(13)
      expect(tailwindToPx('1rem')).toBe(16)
      expect(
        tailwindToPx('var(--radius-md)', {
          tokenMap: { '--radius-md': '10px' }
        })
      ).toBe(10)
    })
  })

  describe('custom tailwind.config resolution', () => {
    it('resolves spacing/radius scales from a project config', () => {
      const theme = resolveTailwindTheme(fixture('tw-project'))
      expect(theme).not.toBeNull()
      expect(theme!.spacing['13']).toBe('13px')
      expect(theme!.borderRadius.card).toBe('6px')
    })

    it('returns null when no config exists', () => {
      expect(resolveTailwindTheme(fixture('.'))).toBeNull()
    })

    it('expands and merges config scales over the defaults', () => {
      const theme = resolveTailwindTheme(fixture('tw-project'))!
      const { spacingMap, radiusMap } = buildScaleMaps(theme)
      // custom scale keys expanded across spacing prefixes
      expect(spacingMap['p-13']).toBe(13)
      expect(spacingMap['gap-huge']).toBe(64)
      expect(radiusMap['rounded-card']).toBe(6)
      expect(radiusMap['rounded-pill']).toBe(24)
      // defaults still present (merge)
      expect(spacingMap['p-4']).toBe(16)
      expect(radiusMap['rounded-lg']).toBe(10)
    })

    it('looks up a custom class via tailwindToPx with resolved maps', () => {
      const { spacingMap, radiusMap } = resolveSpacingRadiusMaps({
        projectDir: fixture('tw-project')
      })
      expect(tailwindToPx('p-13', { spacingMap, radiusMap })).toBe(13)
      expect(tailwindToPx('rounded-card', { spacingMap, radiusMap })).toBe(6)
    })

    it('falls back to default maps when no project config is found', () => {
      const { spacingMap, radiusMap } = resolveSpacingRadiusMaps({
        projectDir: fixture('.')
      })
      expect(spacingMap).toEqual(SPACING_MAP)
      expect(radiusMap).toEqual(RADIUS_MAP)
    })
  })
})
