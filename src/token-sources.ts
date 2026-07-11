// Color token sources — pluggable strategies for discovering design-token
// names/values from different stacks.
//
// Originally the only token discovery was TOKEN_PATTERN matching against
// Tailwind utility classes (bg-/text-/…), which yields nothing for teams that
// keep colors in a JS/TS theme object (styled-system, theme-ui, MUI palette).
// Each source below produces the same `name -> value` shape used downstream.

import { TOKEN_PATTERN } from './constants'
import { isColorValue } from './color-utils'

/**
 * A source of design-color tokens. `getTokens()` returns a map of token name
 * to raw color value. Sources that only know token names (e.g. Tailwind class
 * references) return an empty string for the value.
 */
export interface ColorTokenSource {
  readonly name: string
  getTokens(): Record<string, string>
}

/**
 * Non-token utility values that TOKEN_PATTERN can capture but which are not
 * design tokens (Tailwind keywords, layout values, …).
 */
const NON_TOKENS = new Set([
  'clip',
  'padding',
  'none',
  'transparent',
  'current',
  'inherit',
  'auto',
  'hidden',
  'visible',
  'fixed',
  'absolute',
  'relative'
])

function isLikelyToken(name: string): boolean {
  if (/^\d/.test(name)) return false
  return !NON_TOKENS.has(name)
}

/**
 * Extract design-token names referenced by Tailwind color utilities
 * (bg-/text-/border-/ring-/fill-/stroke-) within the given class strings.
 * This is the original manifest behavior, now exposed as a token source.
 */
export function extractTokenReferencesFromClasses(
  classStrings: string[]
): string[] {
  const tokens = new Set<string>()
  const fullText = classStrings.join(' ')
  const pattern = new RegExp(TOKEN_PATTERN.source, TOKEN_PATTERN.flags)

  let match: RegExpExecArray | null
  while ((match = pattern.exec(fullText)) !== null) {
    const tokenName = match[1]
    if (!isLikelyToken(tokenName)) continue
    tokens.add(tokenName)
  }

  return Array.from(tokens).sort()
}

/** Token source backed by Tailwind color utility classes (names only). */
export class TailwindClassTokenSource implements ColorTokenSource {
  readonly name = 'tailwind-classes'

  constructor(private readonly classStrings: string[]) {}

  getTokens(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const token of extractTokenReferencesFromClasses(this.classStrings)) {
      out[token] = ''
    }
    return out
  }
}

/** Options for flattening a theme object into color tokens. */
export type FlattenThemeOptions = {
  /**
   * Top-level container keys to unwrap before flattening (so `{ colors: {…} }`
   * and `{ palette: {…} }` produce `primary` rather than `colors-primary`).
   */
  colorKeys?: string[]
  /** Separator used to join nested key paths. Default '-'. */
  separator?: string
  /**
   * Leaf keys that collapse onto their parent name (so MUI's
   * `palette.primary.main` and Tailwind's `primary.DEFAULT` both yield
   * `primary`). Default: ['DEFAULT', 'main'].
   */
  collapseKeys?: string[]
}

/**
 * Flatten a (possibly nested) theme object into a `tokenName -> colorValue`
 * map, keeping only leaves that parse as CSS colors.
 *
 * Examples:
 *   { colors: { primary: '#111', accent: { fg: '#fff' } } }
 *     -> { primary: '#111', 'accent-fg': '#fff' }
 *   { palette: { primary: { main: '#111', light: '#333' } } }
 *     -> { primary: '#111', 'primary-light': '#333' }
 */
export function flattenThemeColors(
  theme: unknown,
  options?: FlattenThemeOptions
): Record<string, string> {
  const containers = options?.colorKeys ?? ['colors', 'palette', 'color']
  const separator = options?.separator ?? '-'
  const collapse = new Set(options?.collapseKeys ?? ['DEFAULT', 'main'])

  if (!theme || typeof theme !== 'object') return {}

  let root = theme as Record<string, unknown>
  for (const key of containers) {
    const candidate = root[key]
    if (candidate && typeof candidate === 'object') {
      root = candidate as Record<string, unknown>
      break
    }
  }

  const out: Record<string, string> = {}

  const walk = (node: Record<string, unknown>, path: string[]): void => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') {
        if (!isColorValue(value)) continue
        const name =
          collapse.has(key) && path.length > 0
            ? path.join(separator)
            : [...path, key].join(separator)
        out[name] = value
      } else if (value && typeof value === 'object') {
        walk(value as Record<string, unknown>, [...path, key])
      }
    }
  }

  walk(root, [])
  return out
}

/** Token source backed by a plain JS/TS/JSON theme object. */
export class ThemeObjectTokenSource implements ColorTokenSource {
  readonly name = 'theme-object'

  constructor(
    private readonly theme: unknown,
    private readonly options?: FlattenThemeOptions
  ) {}

  getTokens(): Record<string, string> {
    return flattenThemeColors(this.theme, this.options)
  }
}
