import { describe, it, expect } from 'vitest'
import { extractManifest } from '../manifest-extractor'
import path from 'path'

// Resolve paths relative to test fixtures
const resolve = (p: string) => path.resolve(__dirname, 'fixtures', p)

describe('ManifestExtractor', () => {
  describe('button.tsx — cva with variants and sizes', () => {
    it('extracts component name', () => {
      const manifest = extractManifest(resolve('button.tsx'))
      expect(manifest.componentName).toBe('Button')
    })

    it('extracts variant names and options', () => {
      const manifest = extractManifest(resolve('button.tsx'))
      expect(manifest.variants).toHaveProperty('variant')
      expect(manifest.variants).toHaveProperty('size')
      expect(manifest.variants.variant).toEqual(
        expect.arrayContaining([
          'default',
          'outline',
          'secondary',
          'ghost',
          'destructive',
          'link'
        ])
      )
      expect(manifest.variants.variant).toHaveLength(6)
      expect(manifest.variants.size).toEqual(
        expect.arrayContaining([
          'default',
          'xs',
          'sm',
          'lg',
          'icon',
          'icon-xs',
          'icon-sm',
          'icon-lg'
        ])
      )
      expect(manifest.variants.size).toHaveLength(8)
    })

    it('extracts defaultVariants', () => {
      const manifest = extractManifest(resolve('button.tsx'))
      expect(manifest.defaultVariants).toEqual({
        variant: 'default',
        size: 'default'
      })
    })

    it('extracts token references', () => {
      const manifest = extractManifest(resolve('button.tsx'))
      // button.tsx references tokens like primary, primary-foreground, etc.
      expect(manifest.tokenReferences).toEqual(
        expect.arrayContaining(['primary', 'primary-foreground'])
      )
      expect(manifest.tokenReferences.length).toBeGreaterThan(0)
    })

    it('extracts spacing classes', () => {
      const manifest = extractManifest(resolve('button.tsx'))
      // button.tsx uses gap-1.5, px-2.5, etc.
      expect(manifest.spacingClasses.length).toBeGreaterThan(0)
    })

    it('extracts radius classes', () => {
      const manifest = extractManifest(resolve('button.tsx'))
      expect(manifest.radiusClasses).toEqual(
        expect.arrayContaining(['rounded-lg'])
      )
    })

    it('sets filePath correctly', () => {
      const filePath = resolve('button.tsx')
      const manifest = extractManifest(filePath)
      expect(manifest.filePath).toBe(filePath)
    })
  })

  describe('badge.tsx — cva with variants only, no size', () => {
    it('extracts component name', () => {
      const manifest = extractManifest(resolve('badge.tsx'))
      expect(manifest.componentName).toBe('Badge')
    })

    it('extracts variants without size', () => {
      const manifest = extractManifest(resolve('badge.tsx'))
      expect(manifest.variants).toHaveProperty('variant')
      expect(manifest.variants).not.toHaveProperty('size')
      expect(manifest.variants.variant).toEqual(
        expect.arrayContaining([
          'default',
          'secondary',
          'destructive',
          'outline',
          'ghost',
          'link'
        ])
      )
      expect(manifest.variants.variant).toHaveLength(6)
    })

    it('extracts defaultVariants', () => {
      const manifest = extractManifest(resolve('badge.tsx'))
      expect(manifest.defaultVariants).toEqual({
        variant: 'default'
      })
    })

    it('extracts radius classes including rounded-4xl', () => {
      const manifest = extractManifest(resolve('badge.tsx'))
      expect(manifest.radiusClasses).toEqual(
        expect.arrayContaining(['rounded-4xl'])
      )
    })
  })

  describe('card.tsx — no cva, multiple sub-components', () => {
    it('extracts primary component name as Card', () => {
      const manifest = extractManifest(resolve('card.tsx'))
      expect(manifest.componentName).toBe('Card')
    })

    it('has empty variants when no cva is present', () => {
      const manifest = extractManifest(resolve('card.tsx'))
      expect(manifest.variants).toEqual({})
      expect(manifest.defaultVariants).toEqual({})
    })

    it('detects sub-components', () => {
      const manifest = extractManifest(resolve('card.tsx'))
      expect(manifest.subComponents).toEqual(
        expect.arrayContaining([
          'CardHeader',
          'CardFooter',
          'CardTitle',
          'CardDescription',
          'CardContent'
        ])
      )
    })

    it('extracts props from React.ComponentProps intersection', () => {
      const manifest = extractManifest(resolve('card.tsx'))
      // Card has { size?: "default" | "sm" } in its type
      const sizeProp = manifest.props.find(p => p.name === 'size')
      expect(sizeProp).toBeDefined()
      expect(sizeProp!.required).toBe(false)
    })

    it('extracts token references from class strings', () => {
      const manifest = extractManifest(resolve('card.tsx'))
      // card.tsx references bg-card, text-card-foreground, etc.
      expect(manifest.tokenReferences).toEqual(
        expect.arrayContaining(['card', 'card-foreground'])
      )
    })

    it('extracts spacing classes', () => {
      const manifest = extractManifest(resolve('card.tsx'))
      // card.tsx uses gap-4, py-4, px-4, p-4, etc.
      expect(manifest.spacingClasses.length).toBeGreaterThan(0)
    })

    it('extracts radius classes', () => {
      const manifest = extractManifest(resolve('card.tsx'))
      expect(manifest.radiusClasses).toEqual(
        expect.arrayContaining(['rounded-xl'])
      )
    })
  })

  describe('StatCard.tsx — no cva, custom interface', () => {
    it('extracts component name', () => {
      const manifest = extractManifest(resolve('StatCard.tsx'))
      expect(manifest.componentName).toBe('StatCard')
    })

    it('has empty variants', () => {
      const manifest = extractManifest(resolve('StatCard.tsx'))
      expect(manifest.variants).toEqual({})
      expect(manifest.defaultVariants).toEqual({})
    })

    it('extracts props from StatCardProps interface', () => {
      const manifest = extractManifest(resolve('StatCard.tsx'))
      const propNames = manifest.props.map(p => p.name)
      expect(propNames).toEqual(
        expect.arrayContaining(['title', 'value', 'change', 'trend'])
      )
    })

    it('marks required and optional props correctly', () => {
      const manifest = extractManifest(resolve('StatCard.tsx'))
      const titleProp = manifest.props.find(p => p.name === 'title')
      const changeProp = manifest.props.find(p => p.name === 'change')
      const trendProp = manifest.props.find(p => p.name === 'trend')

      expect(titleProp!.required).toBe(true)
      expect(changeProp!.required).toBe(false)
      expect(trendProp!.required).toBe(false)
    })

    it('extracts token references', () => {
      const manifest = extractManifest(resolve('StatCard.tsx'))
      // StatCard references text-muted-foreground, text-emerald-600, text-red-600
      expect(manifest.tokenReferences).toEqual(
        expect.arrayContaining(['muted-foreground'])
      )
    })

    it('has no sub-components', () => {
      const manifest = extractManifest(resolve('StatCard.tsx'))
      expect(manifest.subComponents).toEqual([])
    })
  })
})
