// Token Syncer — handles design token synchronization between
// src/index.css and Figma variables.

import { readFileSync, writeFileSync } from 'node:fs'
import type { DesignToken, TokenDrift } from './types'
import type { IFigmaMCPAdapter } from './adapters/figma-mcp'
import { parseOKLCH, figmaRGBToHex, colorsMatch } from './color-utils'

/**
 * Extract all CSS custom property definitions from a CSS file.
 * Parses :root and .dark blocks for --token-name: oklch(...) declarations.
 */
export function extractCSSTokens(cssPath: string): DesignToken[] {
  const content = readFileSync(cssPath, 'utf-8')
  return extractCSSTokensFromString(content)
}

/**
 * Extract CSS tokens from a CSS string (testable without file system).
 */
export function extractCSSTokensFromString(content: string): DesignToken[] {
  const lightTokens = parseBlock(content, ':root')
  const darkTokens = parseBlock(content, '.dark')

  // Merge light and dark values into DesignToken objects
  const allNames = new Set([
    ...Object.keys(lightTokens),
    ...Object.keys(darkTokens)
  ])

  const tokens: DesignToken[] = []

  for (const name of allNames) {
    const lightValue = lightTokens[name] ?? ''
    const darkValue = darkTokens[name] ?? lightValue // fallback to light if no dark

    const lightHex = lightValue ? parseOKLCH(lightValue) : '#000000'
    const darkHex = darkValue ? parseOKLCH(darkValue) : '#000000'

    tokens.push({
      name,
      lightValue,
      darkValue,
      lightHex,
      darkHex,
      source: 'css'
    })
  }

  return tokens
}

/**
 * Extract Figma tokens via get_variable_defs through the MCP adapter.
 */
export async function extractFigmaTokens(
  adapter: IFigmaMCPAdapter,
  nodeId: string
): Promise<DesignToken[]> {
  const varDefs = await adapter.getVariableDefs(nodeId)
  const tokens: DesignToken[] = []

  for (const collection of Object.values(varDefs.collections)) {
    for (const variable of collection.variables) {
      // Try to find light and dark mode values
      const modes = collection.modes
      const lightMode = modes.find(m => /light/i.test(m)) ?? modes[0] ?? ''
      const darkMode = modes.find(m => /dark/i.test(m)) ?? modes[1] ?? ''

      const lightValue = variable.valuesByMode[lightMode] ?? ''
      const darkValue = variable.valuesByMode[darkMode] ?? lightValue

      // Parse hex values from Figma (they may be hex strings or RGB objects)
      const lightHex = normalizeColorValue(lightValue)
      const darkHex = normalizeColorValue(darkValue)

      tokens.push({
        name: variable.name,
        lightValue,
        darkValue,
        lightHex,
        darkHex,
        source: 'figma'
      })
    }
  }

  return tokens
}

/**
 * Compare CSS tokens against Figma tokens using normalized hex values.
 * Returns a list of token drifts.
 */
export function compareTokens(
  cssTokens: DesignToken[],
  figmaTokens: DesignToken[]
): TokenDrift[] {
  const drifts: TokenDrift[] = []

  // Build a map of Figma tokens by name
  const figmaMap = new Map<string, DesignToken>()
  for (const token of figmaTokens) {
    figmaMap.set(token.name, token)
  }

  for (const cssToken of cssTokens) {
    const figmaToken = figmaMap.get(cssToken.name)
    if (!figmaToken) {
      continue // Token only in CSS — not a drift, it's a new token
    }

    // Compare light mode
    if (!colorsMatch(cssToken.lightHex, figmaToken.lightHex, 2)) {
      drifts.push({
        tokenName: cssToken.name,
        cssValue: cssToken.lightValue,
        figmaValue: figmaToken.lightValue,
        cssHex: cssToken.lightHex,
        figmaHex: figmaToken.lightHex,
        mode: 'light'
      })
    }

    // Compare dark mode
    if (!colorsMatch(cssToken.darkHex, figmaToken.darkHex, 2)) {
      drifts.push({
        tokenName: cssToken.name,
        cssValue: cssToken.darkValue,
        figmaValue: figmaToken.darkValue,
        cssHex: cssToken.darkHex,
        figmaHex: figmaToken.darkHex,
        mode: 'dark'
      })
    }
  }

  return drifts
}

/**
 * Sync a token value to Figma by generating a use_figma script.
 */
export async function syncTokenToFigma(
  adapter: IFigmaMCPAdapter,
  token: DesignToken,
  mode: 'light' | 'dark'
): Promise<void> {
  const hexValue = mode === 'light' ? token.lightHex : token.darkHex
  const r = parseInt(hexValue.slice(1, 3), 16) / 255
  const g = parseInt(hexValue.slice(3, 5), 16) / 255
  const b = parseInt(hexValue.slice(5, 7), 16) / 255

  const script = `
    const variables = figma.variables.getLocalVariables();
    const target = variables.find(v => v.name === '${token.name}');
    if (target) {
      const modes = target.variableCollectionId
        ? figma.variables.getVariableCollectionById(target.variableCollectionId)?.modes
        : [];
      const modeId = modes?.find(m => m.name.toLowerCase().includes('${mode}'))?.modeId;
      if (modeId) {
        target.setValueForMode(modeId, { r: ${r}, g: ${g}, b: ${b} });
      }
    }
  `.trim()

  await adapter.useFigma(script, `Update ${token.name} ${mode} mode color`)
}

/**
 * Sync a token value to CSS by modifying the CSS file.
 */
export function syncTokenToCSS(
  token: DesignToken,
  cssPath: string,
  mode: 'light' | 'dark'
): void {
  const content = readFileSync(cssPath, 'utf-8')
  const value = mode === 'light' ? token.lightValue : token.darkValue
  const blockSelector = mode === 'light' ? ':root' : '.dark'

  // Find the block and replace the token value
  const blockRegex = new RegExp(
    `(${escapeRegex(blockSelector)}\\s*\\{[^}]*--${escapeRegex(token.name)}:\\s*)([^;]+)(;)`,
    's'
  )

  const updated = content.replace(blockRegex, `$1${value}$3`)

  if (updated !== content) {
    writeFileSync(cssPath, updated, 'utf-8')
  }
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Parse a CSS block (e.g., :root { ... }) and extract custom property declarations.
 */
function parseBlock(content: string, selector: string): Record<string, string> {
  const tokens: Record<string, string> = {}

  // Find the block
  const escapedSelector = escapeRegex(selector)
  const blockRegex = new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`, 'g')
  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(content)) !== null) {
    const blockContent = match[1]

    // Extract --name: value declarations
    const propRegex = /--([a-zA-Z][\w-]*):\s*([^;]+);/g
    let propMatch: RegExpExecArray | null

    while ((propMatch = propRegex.exec(blockContent)) !== null) {
      const name = propMatch[1]
      const value = propMatch[2].trim()

      // Only include OKLCH values and simple values (skip calc/var references)
      if (
        value.startsWith('oklch(') ||
        value.startsWith('#') ||
        /^\d/.test(value)
      ) {
        tokens[name] = value
      }
    }
  }

  return tokens
}

/**
 * Normalize a color value string to hex.
 * Handles hex strings, OKLCH strings, and RGB object strings.
 */
function normalizeColorValue(value: string): string {
  if (!value) return '#000000'

  // Already hex
  if (value.startsWith('#') && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return value.toLowerCase()
  }

  // OKLCH string
  if (value.startsWith('oklch(')) {
    return parseOKLCH(value)
  }

  // Try to parse as JSON RGB object
  try {
    const obj = JSON.parse(value)
    if (typeof obj === 'object' && 'r' in obj && 'g' in obj && 'b' in obj) {
      return figmaRGBToHex(obj)
    }
  } catch {
    // Not JSON
  }

  return '#000000'
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
