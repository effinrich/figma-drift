import { describe, it, expect } from 'vitest'
import {
  extractTokenReferencesFromClasses,
  flattenThemeColors,
  TailwindClassTokenSource,
  ThemeObjectTokenSource
} from '../token-sources'
import { extractThemeObjectTokens } from '../token-syncer'
import { extractCSSTokensFromString } from '../token-syncer'

describe('token-sources', () => {
  describe('TailwindClassTokenSource', () => {
    it('extracts token names from color utility classes', () => {
      const classes = [
        'bg-primary text-primary-foreground border-input',
        'ring-ring/50 bg-clip-padding'
      ]
      expect(extractTokenReferencesFromClasses(classes)).toEqual(
        expect.arrayContaining(['primary', 'primary-foreground', 'input'])
      )
      const source = new TailwindClassTokenSource(classes)
      const tokens = source.getTokens()
      expect(tokens).toHaveProperty('primary')
      // class references carry names only, not values
      expect(tokens.primary).toBe('')
    })

    it('filters out non-token utility values', () => {
      const names = extractTokenReferencesFromClasses(['bg-clip-padding'])
      expect(names).not.toContain('clip')
    })
  })

  describe('flattenThemeColors', () => {
    it('flattens a bare colors object', () => {
      const flat = flattenThemeColors({
        colors: { primary: '#111111', accent: { fg: '#ffffff' } }
      })
      expect(flat).toEqual({ primary: '#111111', 'accent-fg': '#ffffff' })
    })

    it('collapses DEFAULT / main leaf keys onto the parent', () => {
      const flat = flattenThemeColors({
        palette: {
          primary: { main: 'rgb(17,17,17)', light: '#333333' }
        }
      })
      expect(flat.primary).toBe('rgb(17,17,17)')
      expect(flat['primary-light']).toBe('#333333')
    })

    it('ignores non-color leaf values', () => {
      const flat = flattenThemeColors({
        palette: { mode: 'light', primary: { main: '#000000' } }
      })
      expect(flat).not.toHaveProperty('mode')
      expect(flat.primary).toBe('#000000')
    })

    it('works via the ThemeObjectTokenSource wrapper', () => {
      const source = new ThemeObjectTokenSource({
        colors: { brand: 'hsl(200, 50%, 40%)' }
      })
      expect(source.getTokens()).toEqual({ brand: 'hsl(200, 50%, 40%)' })
    })
  })

  describe('extractThemeObjectTokens', () => {
    it('flattens a theme object into DesignTokens with hex', () => {
      const tokens = extractThemeObjectTokens({
        colors: { primary: '#ff0000', secondary: 'rgb(0, 0, 255)' }
      })
      const primary = tokens.find(t => t.name === 'primary')!
      const secondary = tokens.find(t => t.name === 'secondary')!
      expect(primary.lightHex.toLowerCase()).toBe('#ff0000')
      expect(primary.darkHex.toLowerCase()).toBe('#ff0000')
      expect(secondary.lightHex.toLowerCase()).toBe('#0000ff')
      expect(primary.source).toBe('css')
    })
  })

  describe('CSS token parsing accepts non-OKLCH formats', () => {
    it('parses HSL and RGB custom properties from :root/.dark', () => {
      const css = `
        :root {
          --primary: hsl(0, 100%, 50%);
          --secondary: rgb(0, 0, 255);
          --radius: 0.625rem;
        }
        .dark {
          --primary: #00ff00;
        }
      `
      const tokens = extractCSSTokensFromString(css)
      const primary = tokens.find(t => t.name === 'primary')!
      const secondary = tokens.find(t => t.name === 'secondary')!
      // color tokens parsed; non-color --radius skipped
      expect(tokens.find(t => t.name === 'radius')).toBeUndefined()
      expect(primary.lightHex.toLowerCase()).toBe('#ff0000')
      expect(primary.darkHex.toLowerCase()).toBe('#00ff00')
      expect(secondary.lightHex.toLowerCase()).toBe('#0000ff')
    })
  })
})
