import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'path'
import {
  extractVariants,
  CvaVariantExtractor,
  TailwindVariantsExtractor,
  StyledComponentsPropsExtractor,
  CssModulesExtractor,
  EmotionExtractor
} from '../variant-extractors'
import { extractManifest } from '../manifest-extractor'

const resolve = (p: string) => path.resolve(__dirname, 'fixtures', p)

function sourceFor(fixture: string) {
  const project = new Project({ useInMemoryFileSystem: false })
  return project.addSourceFileAtPath(resolve(fixture))
}

describe('variant-extractors', () => {
  describe('CvaVariantExtractor', () => {
    it('detects and extracts cva() variants and defaults', () => {
      const sf = sourceFor('button.tsx')
      const extractor = new CvaVariantExtractor()
      expect(extractor.detect(sf)).toBe(true)
      const { variants, defaultVariants } = extractor.extract(sf)
      expect(variants.variant).toHaveLength(6)
      expect(variants.size).toHaveLength(8)
      expect(defaultVariants).toEqual({ variant: 'default', size: 'default' })
    })

    it('does not detect a non-cva file', () => {
      const sf = sourceFor('tv-button.tsx')
      expect(new CvaVariantExtractor().detect(sf)).toBe(false)
    })
  })

  describe('TailwindVariantsExtractor', () => {
    it('detects and extracts tv() variants and defaults', () => {
      const sf = sourceFor('tv-button.tsx')
      const extractor = new TailwindVariantsExtractor()
      expect(extractor.detect(sf)).toBe(true)
      const { variants, defaultVariants } = extractor.extract(sf)
      expect(variants.variant).toEqual(
        expect.arrayContaining(['primary', 'secondary', 'ghost'])
      )
      expect(variants.size).toEqual(expect.arrayContaining(['sm', 'md', 'lg']))
      expect(defaultVariants).toEqual({ variant: 'primary', size: 'md' })
    })
  })

  describe('StyledComponentsPropsExtractor', () => {
    it('detects styled templates and extracts prop-based variants', () => {
      const sf = sourceFor('StyledButton.tsx')
      const extractor = new StyledComponentsPropsExtractor()
      expect(extractor.detect(sf)).toBe(true)
      const { variants } = extractor.extract(sf)
      expect(variants.variant).toEqual(
        expect.arrayContaining(['primary', 'secondary'])
      )
      expect(variants.size).toEqual(expect.arrayContaining(['lg', 'sm']))
    })
  })

  describe('CssModulesExtractor', () => {
    it('detects styles.* usage from a .module.css import and extracts keys', () => {
      const sf = sourceFor('ModuleButton.tsx')
      const extractor = new CssModulesExtractor()
      expect(extractor.detect(sf)).toBe(true)
      const { variants } = extractor.extract(sf)
      expect(variants.variant).toEqual(
        expect.arrayContaining(['root', 'primary', 'secondary', 'disabled'])
      )
    })
  })

  describe('EmotionExtractor', () => {
    it('detects @emotion/styled templates and extracts prop-based variants', () => {
      const sf = sourceFor('EmotionButton.tsx')
      const extractor = new EmotionExtractor()
      expect(extractor.detect(sf)).toBe(true)
      const { variants } = extractor.extract(sf)
      expect(variants.variant).toEqual(
        expect.arrayContaining(['primary', 'secondary'])
      )
      expect(variants.size).toEqual(expect.arrayContaining(['lg', 'sm']))
    })

    it('detects @emotion/react css`` and css() forms', () => {
      const sf = sourceFor('EmotionCssButton.tsx')
      const extractor = new EmotionExtractor()
      expect(extractor.detect(sf)).toBe(true)
      const { variants } = extractor.extract(sf)
      // tagged-template form
      expect(variants.variant).toEqual(expect.arrayContaining(['primary']))
      // object-styles form
      expect(variants.tone).toEqual(expect.arrayContaining(['danger']))
    })

    it('does not detect a styled-components file lacking an @emotion import', () => {
      const sf = sourceFor('StyledButton.tsx')
      expect(new EmotionExtractor().detect(sf)).toBe(false)
    })
  })

  describe('extractVariants auto-detection', () => {
    it('picks cva for shadcn components', () => {
      const sf = sourceFor('button.tsx')
      const { variants } = extractVariants(sf)
      expect(Object.keys(variants)).toEqual(
        expect.arrayContaining(['variant', 'size'])
      )
    })

    it('falls through to tailwind-variants when no cva present', () => {
      const sf = sourceFor('tv-button.tsx')
      const { defaultVariants } = extractVariants(sf)
      expect(defaultVariants).toEqual({ variant: 'primary', size: 'md' })
    })

    it('honors an explicit override', () => {
      const sf = sourceFor('ModuleButton.tsx')
      const { variants } = extractVariants(sf, { override: 'css-modules' })
      expect(variants.variant).toEqual(
        expect.arrayContaining(['primary', 'secondary'])
      )
    })

    it('auto-detects emotion for @emotion/styled components', () => {
      const sf = sourceFor('EmotionButton.tsx')
      const { variants } = extractVariants(sf)
      expect(variants.variant).toEqual(
        expect.arrayContaining(['primary', 'secondary'])
      )
    })

    it('honors an explicit emotion override', () => {
      const sf = sourceFor('EmotionCssButton.tsx')
      const { variants } = extractVariants(sf, { override: 'emotion' })
      expect(variants.tone).toEqual(expect.arrayContaining(['danger']))
    })

    it('returns empty variants when nothing matches', () => {
      const sf = sourceFor('StatCard.tsx')
      const { variants, defaultVariants } = extractVariants(sf)
      expect(variants).toEqual({})
      expect(defaultVariants).toEqual({})
    })
  })

  describe('extractManifest integration', () => {
    it('extracts tailwind-variants via the manifest extractor', () => {
      const manifest = extractManifest(resolve('tv-button.tsx'))
      expect(manifest.componentName).toBe('TvButton')
      expect(manifest.variants.variant).toEqual(
        expect.arrayContaining(['primary', 'secondary', 'ghost'])
      )
      expect(manifest.defaultVariants).toEqual({
        variant: 'primary',
        size: 'md'
      })
    })

    it('extracts styled-components variants via the manifest extractor', () => {
      const manifest = extractManifest(resolve('StyledButton.tsx'))
      expect(manifest.variants.variant).toEqual(
        expect.arrayContaining(['primary', 'secondary'])
      )
    })

    it('extracts emotion variants via the manifest extractor', () => {
      const manifest = extractManifest(resolve('EmotionButton.tsx'))
      expect(manifest.componentName).toBe('EmotionButton')
      expect(manifest.variants.variant).toEqual(
        expect.arrayContaining(['primary', 'secondary'])
      )
    })
  })
})
