// Snapshot Extractor — calls Figma MCP tools to produce a FigmaSnapshot
// for a component, parsing design context to extract variant properties,
// color bindings, spacing, radius, and layer structure.

import type { IFigmaMCPAdapter } from './adapters/figma-mcp'
import type {
  FigmaSnapshot,
  ColorBinding,
  SpacingValues,
  LayerSummary
} from './types'
import { figmaRGBToHex } from './color-utils'

/**
 * Extract a FigmaSnapshot for a component by its Figma node ID.
 *
 * Strategy:
 * 1. Call get_design_context for the node
 * 2. If truncated, fall back to get_metadata + sub-node re-fetch
 * 3. Parse response to extract variants, colors, spacing, radius, layers
 * 4. Call get_variable_defs for token name resolution
 */
export async function extractSnapshot(
  adapter: IFigmaMCPAdapter,
  figmaNodeId: string
): Promise<FigmaSnapshot> {
  // Step 1: Get design context
  let designContent: string
  const context = await adapter.getDesignContext(figmaNodeId)

  if (context.truncated) {
    // Step 2: Fallback — get metadata for node map, then re-fetch sub-nodes
    const metadata = await adapter.getMetadata(figmaNodeId)
    const subNodeIds = Object.keys(metadata.nodeMap).slice(0, 10) // limit sub-nodes
    const subContents: string[] = [metadata.content]

    for (const subId of subNodeIds) {
      if (subId === figmaNodeId) continue
      try {
        const subContext = await adapter.getDesignContext(subId)
        subContents.push(subContext.content)
      } catch {
        // Skip failed sub-node fetches
      }
    }
    designContent = subContents.join('\n')
  } else {
    designContent = context.content
  }

  // Step 3: Get variable definitions for token name resolution
  let variableMap: Record<string, string> = {}
  try {
    const varDefs = await adapter.getVariableDefs(figmaNodeId)
    variableMap = buildVariableMap(varDefs.collections)
  } catch {
    // Variable defs may not be available — continue without token resolution
  }

  // Step 4: Parse the design content
  const parsed = tryParseJSON(designContent)

  const componentName = extractComponentName(parsed, figmaNodeId)
  const variants = extractVariants(parsed)
  const colors = extractColors(parsed, variableMap)
  const spacing = extractSpacing(parsed)
  const cornerRadius = extractCornerRadius(parsed)
  const layers = extractLayers(parsed)

  return {
    nodeId: figmaNodeId,
    componentName,
    variants,
    colors,
    spacing,
    cornerRadius,
    layers
  }
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Build a map from variable ID/hex to token name from variable collections.
 */
function buildVariableMap(
  collections: Record<
    string,
    {
      name: string
      modes: string[]
      variables: { name: string; valuesByMode: Record<string, string> }[]
    }
  >
): Record<string, string> {
  const map: Record<string, string> = {}

  for (const collection of Object.values(collections)) {
    for (const variable of collection.variables) {
      // Map variable name to itself for direct lookups
      map[variable.name] = variable.name

      // Map resolved hex values to token names for reverse lookup
      for (const value of Object.values(variable.valuesByMode)) {
        const cleaned = value.replace(/^#/, '').toLowerCase()
        if (/^[0-9a-f]{6}$/.test(cleaned)) {
          map[`#${cleaned}`] = variable.name
        }
      }
    }
  }

  return map
}

/**
 * Try to parse a string as JSON. Returns the parsed object or an empty object.
 */
function tryParseJSON(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Not JSON — return empty
  }
  return {}
}

/**
 * Extract the component name from the parsed design context.
 */
function extractComponentName(
  parsed: Record<string, unknown>,
  fallbackId: string
): string {
  if (typeof parsed['name'] === 'string') {
    return parsed['name'] as string
  }
  if (typeof parsed['componentName'] === 'string') {
    return parsed['componentName'] as string
  }
  return `Component_${fallbackId.replace(':', '_')}`
}

/**
 * Extract variant properties from the parsed design context.
 * Looks for componentPropertyDefinitions or variantProperties patterns.
 */
function extractVariants(
  parsed: Record<string, unknown>
): Record<string, string[]> {
  const variants: Record<string, string[]> = {}

  // Pattern 1: componentPropertyDefinitions (Figma component set)
  const propDefs = findNestedValue(parsed, 'componentPropertyDefinitions')
  if (propDefs && typeof propDefs === 'object') {
    const defs = propDefs as Record<string, unknown>
    for (const [key, def] of Object.entries(defs)) {
      if (def && typeof def === 'object') {
        const defObj = def as Record<string, unknown>
        if (
          defObj['type'] === 'VARIANT' &&
          Array.isArray(defObj['variantOptions'])
        ) {
          variants[key] = (defObj['variantOptions'] as string[]).map(String)
        }
      }
    }
  }

  // Pattern 2: variantGroupProperties
  const variantGroup = findNestedValue(parsed, 'variantGroupProperties')
  if (variantGroup && typeof variantGroup === 'object') {
    const group = variantGroup as Record<string, unknown>
    for (const [key, val] of Object.entries(group)) {
      if (Array.isArray(val)) {
        variants[key] = val.map(String)
      } else if (val && typeof val === 'object') {
        const valObj = val as Record<string, unknown>
        if (Array.isArray(valObj['values'])) {
          variants[key] = (valObj['values'] as unknown[]).map(String)
        }
      }
    }
  }

  // Pattern 3: children with variant properties (component set children)
  const children = parsed['children']
  if (Array.isArray(children) && children.length > 0) {
    const variantMap = new Map<string, Set<string>>()
    for (const child of children) {
      if (child && typeof child === 'object') {
        const childObj = child as Record<string, unknown>
        const name = childObj['name']
        if (typeof name === 'string' && name.includes('=')) {
          // Parse "variant=value, size=default" format
          const pairs = name.split(',').map((s: string) => s.trim())
          for (const pair of pairs) {
            const [varName, varValue] = pair
              .split('=')
              .map((s: string) => s.trim())
            if (varName && varValue) {
              if (!variantMap.has(varName)) {
                variantMap.set(varName, new Set())
              }
              variantMap.get(varName)!.add(varValue)
            }
          }
        }
      }
    }
    for (const [name, values] of variantMap) {
      if (!variants[name]) {
        variants[name] = Array.from(values)
      }
    }
  }

  return variants
}

/**
 * Extract color bindings from the parsed design context.
 */
function extractColors(
  parsed: Record<string, unknown>,
  variableMap: Record<string, string>
): ColorBinding[] {
  const colors: ColorBinding[] = []
  collectColors(parsed, '', colors, variableMap)
  return colors
}

/**
 * Recursively collect color bindings from a node tree.
 */
function collectColors(
  node: Record<string, unknown>,
  path: string,
  colors: ColorBinding[],
  variableMap: Record<string, string>
): void {
  const nodeName =
    typeof node['name'] === 'string' ? (node['name'] as string) : ''
  const currentPath = path ? `${path}/${nodeName}` : nodeName

  // Check fills
  const fills = node['fills']
  if (Array.isArray(fills)) {
    for (const fill of fills) {
      if (fill && typeof fill === 'object') {
        const fillObj = fill as Record<string, unknown>
        const color = extractColorFromPaint(fillObj, variableMap)
        if (color) {
          colors.push({
            target: 'fill',
            layerPath: currentPath,
            tokenName: color.tokenName,
            hexValue: color.hexValue
          })
        }
      }
    }
  }

  // Check strokes
  const strokes = node['strokes']
  if (Array.isArray(strokes)) {
    for (const stroke of strokes) {
      if (stroke && typeof stroke === 'object') {
        const strokeObj = stroke as Record<string, unknown>
        const color = extractColorFromPaint(strokeObj, variableMap)
        if (color) {
          colors.push({
            target: 'stroke',
            layerPath: currentPath,
            tokenName: color.tokenName,
            hexValue: color.hexValue
          })
        }
      }
    }
  }

  // Check text styles
  const style = node['style']
  if (style && typeof style === 'object') {
    const styleObj = style as Record<string, unknown>
    const textFills = styleObj['fills'] ?? node['fills']
    if (Array.isArray(textFills) && node['type'] === 'TEXT') {
      for (const fill of textFills) {
        if (fill && typeof fill === 'object') {
          const fillObj = fill as Record<string, unknown>
          const color = extractColorFromPaint(fillObj, variableMap)
          if (color) {
            colors.push({
              target: 'text',
              layerPath: currentPath,
              tokenName: color.tokenName,
              hexValue: color.hexValue
            })
          }
        }
      }
    }
  }

  // Recurse into children
  const children = node['children']
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === 'object') {
        collectColors(
          child as Record<string, unknown>,
          currentPath,
          colors,
          variableMap
        )
      }
    }
  }
}

/**
 * Extract color info from a Figma paint object.
 */
function extractColorFromPaint(
  paint: Record<string, unknown>,
  variableMap: Record<string, string>
): { tokenName: string | null; hexValue: string } | null {
  if (paint['type'] !== 'SOLID' && paint['visible'] === false) {
    return null
  }

  const color = paint['color']
  if (!color || typeof color !== 'object') {
    return null
  }

  const colorObj = color as Record<string, unknown>
  const r = typeof colorObj['r'] === 'number' ? colorObj['r'] : 0
  const g = typeof colorObj['g'] === 'number' ? colorObj['g'] : 0
  const b = typeof colorObj['b'] === 'number' ? colorObj['b'] : 0

  const hexValue = figmaRGBToHex({
    r: r as number,
    g: g as number,
    b: b as number
  })

  // Check for variable binding
  let tokenName: string | null = null

  // Check boundVariables
  const boundVars = paint['boundVariables']
  if (boundVars && typeof boundVars === 'object') {
    const bv = boundVars as Record<string, unknown>
    const colorVar = bv['color']
    if (colorVar && typeof colorVar === 'object') {
      const cv = colorVar as Record<string, unknown>
      const varId = cv['id'] ?? cv['name']
      if (typeof varId === 'string' && variableMap[varId]) {
        tokenName = variableMap[varId]
      }
    }
  }

  // Fallback: try to match hex to a known token
  if (!tokenName) {
    const hexLower = hexValue.toLowerCase()
    if (variableMap[hexLower]) {
      tokenName = variableMap[hexLower]
    }
  }

  return { tokenName, hexValue }
}

/**
 * Extract spacing values from the parsed design context.
 */
function extractSpacing(parsed: Record<string, unknown>): SpacingValues {
  const defaults: SpacingValues = {
    layoutMode: 'none',
    itemSpacing: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0
  }

  const layoutMode = parsed['layoutMode']
  if (layoutMode === 'HORIZONTAL') {
    defaults.layoutMode = 'horizontal'
  } else if (layoutMode === 'VERTICAL') {
    defaults.layoutMode = 'vertical'
  }

  if (typeof parsed['itemSpacing'] === 'number') {
    defaults.itemSpacing = parsed['itemSpacing'] as number
  }
  if (typeof parsed['paddingTop'] === 'number') {
    defaults.paddingTop = parsed['paddingTop'] as number
  }
  if (typeof parsed['paddingRight'] === 'number') {
    defaults.paddingRight = parsed['paddingRight'] as number
  }
  if (typeof parsed['paddingBottom'] === 'number') {
    defaults.paddingBottom = parsed['paddingBottom'] as number
  }
  if (typeof parsed['paddingLeft'] === 'number') {
    defaults.paddingLeft = parsed['paddingLeft'] as number
  }

  return defaults
}

/**
 * Extract corner radius from the parsed design context.
 */
function extractCornerRadius(
  parsed: Record<string, unknown>
): number | number[] {
  if (typeof parsed['cornerRadius'] === 'number') {
    return parsed['cornerRadius'] as number
  }

  // Check for individual corner radii
  const tl = parsed['topLeftRadius']
  const tr = parsed['topRightRadius']
  const br = parsed['bottomRightRadius']
  const bl = parsed['bottomLeftRadius']

  if (
    typeof tl === 'number' ||
    typeof tr === 'number' ||
    typeof br === 'number' ||
    typeof bl === 'number'
  ) {
    return [
      (tl as number) ?? 0,
      (tr as number) ?? 0,
      (br as number) ?? 0,
      (bl as number) ?? 0
    ]
  }

  return 0
}

/**
 * Extract layer structure summary from the parsed design context.
 */
function extractLayers(parsed: Record<string, unknown>): LayerSummary[] {
  const layers: LayerSummary[] = []
  const children = parsed['children']

  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === 'object') {
        layers.push(buildLayerSummary(child as Record<string, unknown>))
      }
    }
  }

  return layers
}

/**
 * Build a LayerSummary from a node object.
 */
function buildLayerSummary(node: Record<string, unknown>): LayerSummary {
  const name =
    typeof node['name'] === 'string' ? (node['name'] as string) : 'unnamed'
  const type =
    typeof node['type'] === 'string' ? (node['type'] as string) : 'unknown'

  const summary: LayerSummary = { name, type }

  const children = node['children']
  if (Array.isArray(children) && children.length > 0) {
    summary.children = children
      .filter(
        (c): c is Record<string, unknown> => c !== null && typeof c === 'object'
      )
      .map(buildLayerSummary)
  }

  return summary
}

/**
 * Find a nested value by key in an object tree (breadth-first).
 */
function findNestedValue(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) {
    return obj[key]
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const found = findNestedValue(value as Record<string, unknown>, key)
      if (found !== undefined) {
        return found
      }
    }
  }

  return undefined
}
