import { describe, it, expect } from 'vitest'
import { parseOKLCH, figmaRGBToHex, colorsMatch } from '../color-utils'

describe('color-utils', () => {
  describe('parseOKLCH', () => {
    it('parses a black OKLCH value', () => {
      // oklch(0 0 0) is black
      const hex = parseOKLCH('oklch(0 0 0)')
      expect(hex.toLowerCase()).toBe('#000000')
    })

    it('parses a white OKLCH value', () => {
      // oklch(1 0 0) is white
      const hex = parseOKLCH('oklch(1 0 0)')
      expect(hex.toLowerCase()).toBe('#ffffff')
    })

    it('parses an OKLCH value from the project CSS tokens', () => {
      // oklch(0.205 0 0) is a very dark gray (--primary in light mode)
      const hex = parseOKLCH('oklch(0.205 0 0)')
      // Should be a dark gray, close to #0a0a0a or similar
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
    })

    it('parses OKLCH with chroma and hue', () => {
      // oklch(0.577 0.245 27.325) is the destructive red
      const hex = parseOKLCH('oklch(0.577 0.245 27.325)')
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
    })

    it('parses OKLCH with alpha (ignores alpha in hex output)', () => {
      const hex = parseOKLCH('oklch(0.5 0 0 / 0.5)')
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
      // Should be a 6-digit hex (no alpha)
      expect(hex.replace('#', '')).toHaveLength(6)
    })

    it('returns #000000 for invalid strings', () => {
      expect(parseOKLCH('not-a-color')).toBe('#000000')
      expect(parseOKLCH('')).toBe('#000000')
    })

    it('parses oklch(0.985 0 0) as near-white', () => {
      const hex = parseOKLCH('oklch(0.985 0 0)')
      // Should be very close to white
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      expect(r).toBeGreaterThan(240)
      expect(g).toBeGreaterThan(240)
      expect(b).toBeGreaterThan(240)
    })
  })

  describe('figmaRGBToHex', () => {
    it('converts black (0, 0, 0) to #000000', () => {
      expect(figmaRGBToHex({ r: 0, g: 0, b: 0 })).toBe('#000000')
    })

    it('converts white (1, 1, 1) to #ffffff', () => {
      expect(figmaRGBToHex({ r: 1, g: 1, b: 1 })).toBe('#ffffff')
    })

    it('converts mid-gray (0.5, 0.5, 0.5) to approximately #808080', () => {
      const hex = figmaRGBToHex({ r: 0.5, g: 0.5, b: 0.5 })
      // Math.round(0.5 * 255) = 128 = 0x80
      expect(hex).toBe('#808080')
    })

    it('converts pure red (1, 0, 0) to #ff0000', () => {
      expect(figmaRGBToHex({ r: 1, g: 0, b: 0 })).toBe('#ff0000')
    })

    it('converts pure green (0, 1, 0) to #00ff00', () => {
      expect(figmaRGBToHex({ r: 0, g: 1, b: 0 })).toBe('#00ff00')
    })

    it('converts pure blue (0, 0, 1) to #0000ff', () => {
      expect(figmaRGBToHex({ r: 0, g: 0, b: 1 })).toBe('#0000ff')
    })

    it('clamps values above 1', () => {
      expect(figmaRGBToHex({ r: 1.5, g: 0, b: 0 })).toBe('#ff0000')
    })

    it('clamps values below 0', () => {
      expect(figmaRGBToHex({ r: -0.5, g: 0, b: 0 })).toBe('#000000')
    })

    it('converts Figma-style dark gray', () => {
      // Figma might represent oklch(0.205 0 0) as approximately {r: 0.04, g: 0.04, b: 0.04}
      const hex = figmaRGBToHex({ r: 0.04, g: 0.04, b: 0.04 })
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
      const r = parseInt(hex.slice(1, 3), 16)
      expect(r).toBe(Math.round(0.04 * 255))
    })
  })

  describe('colorsMatch', () => {
    it('matches identical hex strings', () => {
      expect(colorsMatch('#ff0000', '#ff0000')).toBe(true)
    })

    it('matches case-insensitively', () => {
      expect(colorsMatch('#FF0000', '#ff0000')).toBe(true)
    })

    it('matches with # prefix and without', () => {
      expect(colorsMatch('#ff0000', 'ff0000')).toBe(true)
    })

    it('matches within default tolerance of ±1', () => {
      // #ff0000 vs #fe0000 — red channel differs by 1
      expect(colorsMatch('#ff0000', '#fe0000')).toBe(true)
    })

    it('does not match when difference exceeds tolerance', () => {
      // #ff0000 vs #f00000 — red channel differs by 15
      expect(colorsMatch('#ff0000', '#f00000')).toBe(false)
    })

    it('matches with custom tolerance', () => {
      // #ff0000 vs #f00000 — red channel differs by 15, tolerance 20
      expect(colorsMatch('#ff0000', '#f00000', 20)).toBe(true)
    })

    it('does not match with zero tolerance when channels differ', () => {
      expect(colorsMatch('#ff0000', '#fe0000', 0)).toBe(false)
    })

    it('matches identical colors with zero tolerance', () => {
      expect(colorsMatch('#abcdef', '#abcdef', 0)).toBe(true)
    })

    it('returns false for invalid hex strings', () => {
      expect(colorsMatch('#xyz', '#ff0000')).toBe(false)
      expect(colorsMatch('#ff0000', 'not-hex')).toBe(false)
    })

    it('returns false for short hex strings', () => {
      expect(colorsMatch('#fff', '#ffffff')).toBe(false)
    })
  })

  describe('integration: OKLCH → hex matches Figma RGB → hex', () => {
    it('black in both color spaces matches', () => {
      const oklchHex = parseOKLCH('oklch(0 0 0)')
      const figmaHex = figmaRGBToHex({ r: 0, g: 0, b: 0 })
      expect(colorsMatch(oklchHex, figmaHex)).toBe(true)
    })

    it('white in both color spaces matches', () => {
      const oklchHex = parseOKLCH('oklch(1 0 0)')
      const figmaHex = figmaRGBToHex({ r: 1, g: 1, b: 1 })
      expect(colorsMatch(oklchHex, figmaHex)).toBe(true)
    })
  })
})
