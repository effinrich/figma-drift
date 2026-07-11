import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SPACING_MAP,
  RADIUS_MAP,
  DEFAULT_ROOT_FONT_SIZE_PX,
  SPACING_UTILITY_PREFIXES
} from './constants'

/** Options for resolving CSS length values to pixels. */
export type LengthResolveOptions = {
  /** px value for 1rem/1em. Defaults to DEFAULT_ROOT_FONT_SIZE_PX (16). */
  rootFontSizePx?: number
  /**
   * Map of CSS custom property name → length value, used to resolve
   * `var(--token)` references (e.g. `{ '--spacing-md': '8px' }`). Keys may be
   * given with or without the leading `--`.
   */
  tokenMap?: Record<string, string>
}

/** Options for the class/length → px lookup. */
export type TailwindToPxOptions = LengthResolveOptions & {
  /** Spacing class → px map. Defaults to SPACING_MAP. */
  spacingMap?: Record<string, number>
  /** Radius class → px map. Defaults to RADIUS_MAP. */
  radiusMap?: Record<string, number>
}

/**
 * Parse a raw CSS length string to pixels.
 *
 * Supports `px`, `rem`, `em`, unitless `0`, and `var(--name)` /
 * `var(--name, fallback)` references resolved against `options.tokenMap`.
 * Returns undefined when the value cannot be resolved to a number.
 */
export function parseCssLength(
  value: string,
  options?: LengthResolveOptions
): number | undefined {
  const raw = value.trim()
  if (raw === '') return undefined

  const rootPx = options?.rootFontSizePx ?? DEFAULT_ROOT_FONT_SIZE_PX

  // var(--name) or var(--name, fallback)
  const varMatch = raw.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/)
  if (varMatch) {
    const [, name, fallback] = varMatch
    const resolved = resolveToken(name, options?.tokenMap)
    if (resolved !== undefined) {
      return parseCssLength(resolved, options)
    }
    if (fallback !== undefined) {
      return parseCssLength(fallback, options)
    }
    return undefined
  }

  const numMatch = raw.match(/^(-?\d*\.?\d+)(px|rem|em)?$/)
  if (!numMatch) return undefined

  const amount = parseFloat(numMatch[1])
  const unit = numMatch[2]

  if (unit === 'px') return amount
  if (unit === 'rem' || unit === 'em') return amount * rootPx
  // Unitless: only 0 is meaningful as a length.
  if (amount === 0) return 0
  return undefined
}

/**
 * Parse a Tailwind arbitrary-value utility (e.g. `p-[13px]`, `gap-[1.5rem]`,
 * `rounded-[6px]`, `p-[var(--x)]`) directly to pixels, without any map lookup.
 * Returns undefined when the class has no bracket value or it is not a length.
 */
export function parseArbitraryUtility(
  className: string,
  options?: LengthResolveOptions
): number | undefined {
  const match = className.match(/\[([^\]]+)\]$/)
  if (!match) return undefined
  // Tailwind encodes spaces as underscores inside arbitrary values.
  const inner = match[1].replace(/_/g, ' ')
  return parseCssLength(inner, options)
}

/**
 * Look up a Tailwind class name and return its pixel value.
 *
 * Resolution order:
 *   1. spacing map (custom or default SPACING_MAP)
 *   2. radius map (custom or default RADIUS_MAP)
 *   3. Tailwind arbitrary-value syntax (`p-[13px]`)
 *   4. a raw CSS length passed directly (`13px`, `1.5rem`, `var(--md)`)
 *
 * Returns undefined if none apply. Backward compatible: called with just a
 * class name it behaves exactly like the original map-only lookup.
 */
export function tailwindToPx(
  className: string,
  options?: TailwindToPxOptions
): number | undefined {
  const spacing = options?.spacingMap ?? SPACING_MAP
  const radius = options?.radiusMap ?? RADIUS_MAP

  if (className in spacing) return spacing[className]
  if (className in radius) return radius[className]

  const arbitrary = parseArbitraryUtility(className, options)
  if (arbitrary !== undefined) return arbitrary

  const rawLength = parseCssLength(className, options)
  if (rawLength !== undefined) return rawLength

  return undefined
}

/**
 * Reverse lookup: given a pixel value and a type ('spacing' or 'radius'),
 * return the first matching Tailwind class name. When no scale class matches,
 * falls back to Tailwind arbitrary-value syntax (e.g. `p-[13px]` / `rounded-[13px]`).
 */
export function pxToTailwind(
  value: number,
  type: 'spacing' | 'radius',
  options?: { spacingMap?: Record<string, number>; radiusMap?: Record<string, number> }
): string | undefined {
  const map =
    type === 'spacing'
      ? (options?.spacingMap ?? SPACING_MAP)
      : (options?.radiusMap ?? RADIUS_MAP)
  for (const [className, px] of Object.entries(map)) {
    if (px === value) {
      return className
    }
  }
  return undefined
}

// ── Tailwind config resolution ───────────────────────────────────────

/** A raw (un-expanded) theme scale: scale key → CSS length string. */
export type ThemeScale = Record<string, string>

/** Theme scales relevant to spacing/radius drift. */
export type ResolvedTheme = {
  spacing: ThemeScale
  borderRadius: ThemeScale
}

/**
 * Discover and load a project `tailwind.config.*` and return its spacing /
 * borderRadius scales (merging `theme` and `theme.extend`). Supports `.json`,
 * `.cjs`, and CommonJS `.js` configs. Returns null when no config is found or
 * it cannot be loaded.
 */
export function resolveTailwindTheme(projectDir: string): ResolvedTheme | null {
  const candidates = [
    'tailwind.config.js',
    'tailwind.config.cjs',
    'tailwind.config.mjs',
    'tailwind.config.json'
  ]

  for (const name of candidates) {
    const configPath = join(projectDir, name)
    if (!existsSync(configPath)) continue

    const config = loadConfigModule(configPath)
    if (!config || typeof config !== 'object') continue

    const theme = (config as { theme?: Record<string, unknown> }).theme ?? {}
    const extend = (theme.extend as Record<string, unknown>) ?? {}

    return {
      spacing: {
        ...toThemeScale(theme.spacing),
        ...toThemeScale(extend.spacing)
      },
      borderRadius: {
        ...toThemeScale(theme.borderRadius),
        ...toThemeScale(extend.borderRadius)
      }
    }
  }

  return null
}

/**
 * Expand a resolved theme into concrete class → px maps and merge them over
 * the default SPACING_MAP / RADIUS_MAP. Project values take precedence.
 */
export function buildScaleMaps(
  theme: ResolvedTheme,
  options?: LengthResolveOptions & { mergeDefaults?: boolean }
): { spacingMap: Record<string, number>; radiusMap: Record<string, number> } {
  const merge = options?.mergeDefaults ?? true
  const spacingMap: Record<string, number> = merge ? { ...SPACING_MAP } : {}
  const radiusMap: Record<string, number> = merge ? { ...RADIUS_MAP } : {}

  for (const [key, rawValue] of Object.entries(theme.spacing)) {
    const px = parseCssLength(rawValue, options)
    if (px === undefined) continue
    for (const prefix of SPACING_UTILITY_PREFIXES) {
      spacingMap[`${prefix}-${key}`] = px
    }
  }

  for (const [key, rawValue] of Object.entries(theme.borderRadius)) {
    const px = parseCssLength(rawValue, options)
    if (px === undefined) continue
    const cls = key === 'DEFAULT' ? 'rounded' : `rounded-${key}`
    radiusMap[cls] = px
  }

  return { spacingMap, radiusMap }
}

/**
 * Convenience resolver: build merged spacing/radius maps for a project by
 * discovering its tailwind.config. Falls back to the default maps when no
 * config is present.
 */
export function resolveSpacingRadiusMaps(
  options?: LengthResolveOptions & { projectDir?: string; mergeDefaults?: boolean }
): { spacingMap: Record<string, number>; radiusMap: Record<string, number> } {
  if (options?.projectDir) {
    const theme = resolveTailwindTheme(options.projectDir)
    if (theme) {
      return buildScaleMaps(theme, options)
    }
  }
  return { spacingMap: { ...SPACING_MAP }, radiusMap: { ...RADIUS_MAP } }
}

// ── Internal helpers ─────────────────────────────────────────────────

function resolveToken(
  name: string,
  tokenMap?: Record<string, string>
): string | undefined {
  if (!tokenMap) return undefined
  const bare = name.replace(/^--/, '')
  return tokenMap[name] ?? tokenMap[`--${bare}`] ?? tokenMap[bare]
}

function toThemeScale(value: unknown): ThemeScale {
  if (!value || typeof value !== 'object') return {}
  const scale: ThemeScale = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') scale[key] = v
  }
  return scale
}

function loadConfigModule(configPath: string): unknown {
  if (configPath.endsWith('.json')) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch {
      return null
    }
  }
  try {
    const require = createRequire(import.meta.url)
    delete require.cache[require.resolve(configPath)]
    const mod = require(configPath)
    return mod?.default ?? mod
  } catch {
    return null
  }
}
