// Drift Detector — compares a ComponentManifest against a FigmaSnapshot
// to produce a DriftReport listing all differences.

import type {
  ComponentManifest,
  FigmaSnapshot,
  DriftReport,
  DriftEntry,
  Difference,
  TokenDrift,
  ComponentMap
} from './types'
import { tailwindToPx } from './value-mapping'
import { extractSnapshot } from './snapshot-extractor'
import type { IFigmaMCPAdapter } from './adapters/figma-mcp'
import { extractManifest } from './manifest-extractor'

/**
 * Compare a single ComponentManifest against a FigmaSnapshot.
 * Returns a DriftEntry with status and differences.
 */
export function compareSingle(
  manifest: ComponentManifest,
  snapshot: FigmaSnapshot | null,
  figmaNodeId: string | null
): DriftEntry {
  // Unlinked component — no Figma node
  if (!figmaNodeId || !snapshot) {
    return {
      componentName: manifest.componentName,
      filePath: manifest.filePath,
      figmaNodeId: figmaNodeId,
      status: 'unlinked',
      differences: []
    }
  }

  const differences: Difference[] = []

  // Compare variants
  compareVariants(manifest, snapshot, differences)

  // Compare colors
  compareColors(manifest, snapshot, differences)

  // Compare spacing
  compareSpacing(manifest, snapshot, differences)

  // Compare radius
  compareRadius(manifest, snapshot, differences)

  const status = differences.length === 0 ? 'in-sync' : 'drifted'

  return {
    componentName: manifest.componentName,
    filePath: manifest.filePath,
    figmaNodeId,
    status,
    differences
  }
}

/**
 * Compare all components in a ComponentMap.
 * Extracts manifests and snapshots, then computes drift for each.
 */
export async function compareAll(
  componentMap: ComponentMap,
  adapter: IFigmaMCPAdapter
): Promise<DriftReport> {
  const components: DriftEntry[] = []
  const tokens: TokenDrift[] = []

  for (const entry of componentMap.entries) {
    try {
      const manifest = extractManifest(entry.filePath)

      let snapshot: FigmaSnapshot | null = null
      if (entry.figmaNodeId) {
        try {
          snapshot = await extractSnapshot(adapter, entry.figmaNodeId)
        } catch {
          // Figma fetch failed — treat as unlinked for this run
        }
      }

      const driftEntry = compareSingle(manifest, snapshot, entry.figmaNodeId)
      components.push(driftEntry)
    } catch {
      // Component file not found or parse error — mark as unlinked
      components.push({
        componentName: entry.componentName,
        filePath: entry.filePath,
        figmaNodeId: entry.figmaNodeId,
        status: 'unlinked',
        differences: []
      })
    }
  }

  const summary = {
    totalComponents: components.length,
    inSync: components.filter(c => c.status === 'in-sync').length,
    drifted: components.filter(c => c.status === 'drifted').length,
    unlinked: components.filter(c => c.status === 'unlinked').length,
    totalDifferences: components.reduce(
      (sum, c) => sum + c.differences.length,
      0
    )
  }

  return {
    generatedAt: new Date().toISOString(),
    components,
    tokens,
    summary
  }
}

// ── Comparison helpers ───────────────────────────────────────────────

/**
 * Compare variant definitions between manifest and snapshot.
 */
function compareVariants(
  manifest: ComponentManifest,
  snapshot: FigmaSnapshot,
  differences: Difference[]
): void {
  const codeVariants = manifest.variants
  const figmaVariants = snapshot.variants

  // All variant names from both sides
  const allVariantNames = new Set([
    ...Object.keys(codeVariants),
    ...Object.keys(figmaVariants)
  ])

  for (const variantName of allVariantNames) {
    const codeOptions = codeVariants[variantName]
    const figmaOptions = figmaVariants[variantName]

    if (!codeOptions && figmaOptions) {
      // Variant exists in Figma but not code
      differences.push({
        type: 'variant',
        propertyPath: `variants.${variantName}`,
        codeValue: null,
        figmaValue: figmaOptions.join(', '),
        description: `Variant "${variantName}" exists in Figma but not in code`
      })
      continue
    }

    if (codeOptions && !figmaOptions) {
      // Variant exists in code but not Figma
      differences.push({
        type: 'variant',
        propertyPath: `variants.${variantName}`,
        codeValue: codeOptions.join(', '),
        figmaValue: null,
        description: `Variant "${variantName}" exists in code but not in Figma`
      })
      continue
    }

    if (codeOptions && figmaOptions) {
      // Compare option values
      const codeSorted = [...codeOptions].sort()
      const figmaSorted = [...figmaOptions].sort()

      // Options in code but not Figma
      for (const opt of codeSorted) {
        if (!figmaSorted.includes(opt)) {
          differences.push({
            type: 'variant',
            propertyPath: `variants.${variantName}.${opt}`,
            codeValue: opt,
            figmaValue: null,
            description: `Variant option "${variantName}=${opt}" exists in code but not in Figma`
          })
        }
      }

      // Options in Figma but not code
      for (const opt of figmaSorted) {
        if (!codeSorted.includes(opt)) {
          differences.push({
            type: 'variant',
            propertyPath: `variants.${variantName}.${opt}`,
            codeValue: null,
            figmaValue: opt,
            description: `Variant option "${variantName}=${opt}" exists in Figma but not in code`
          })
        }
      }
    }
  }
}

/**
 * Compare color token references between manifest and snapshot.
 */
function compareColors(
  manifest: ComponentManifest,
  snapshot: FigmaSnapshot,
  differences: Difference[]
): void {
  // Build a set of token names referenced in code
  const codeTokens = new Set(manifest.tokenReferences)

  // Check each Figma color binding
  for (const binding of snapshot.colors) {
    if (binding.tokenName) {
      // Token-bound color — check if code references the same token
      if (!codeTokens.has(binding.tokenName)) {
        // Check with common prefixes/suffixes
        const variants = [
          binding.tokenName,
          binding.tokenName.replace(/-/g, ''),
          `${binding.tokenName}-foreground`
        ]
        const found = variants.some(v => codeTokens.has(v))
        if (!found) {
          differences.push({
            type: 'color',
            propertyPath: `colors.${binding.target}.${binding.layerPath}`,
            codeValue: null,
            figmaValue: `token:${binding.tokenName}`,
            description: `Figma uses token "${binding.tokenName}" for ${binding.target} at ${binding.layerPath}, but code does not reference this token`
          })
        }
      }
    } else {
      // Hardcoded color — flag it
      differences.push({
        type: 'color',
        propertyPath: `colors.${binding.target}.${binding.layerPath}`,
        codeValue: null,
        figmaValue: binding.hexValue,
        description: `Figma has hardcoded color ${binding.hexValue} for ${binding.target} at ${binding.layerPath} (not bound to a token)`
      })
    }
  }
}

/**
 * Compare spacing values between manifest and snapshot.
 */
function compareSpacing(
  manifest: ComponentManifest,
  snapshot: FigmaSnapshot,
  differences: Difference[]
): void {
  if (snapshot.spacing.layoutMode === 'none') {
    return // No auto-layout — skip spacing comparison
  }

  // Check item spacing (gap)
  const gapClasses = manifest.spacingClasses.filter(c => c.startsWith('gap-'))
  if (gapClasses.length > 0) {
    const codePx = tailwindToPx(gapClasses[0])
    if (codePx !== undefined && codePx !== snapshot.spacing.itemSpacing) {
      differences.push({
        type: 'spacing',
        propertyPath: 'spacing.itemSpacing',
        codeValue: `${gapClasses[0]} (${codePx}px)`,
        figmaValue: `${snapshot.spacing.itemSpacing}px`,
        description: `Item spacing mismatch: code uses ${gapClasses[0]} (${codePx}px), Figma has ${snapshot.spacing.itemSpacing}px`
      })
    }
  }

  // Check padding
  const pClasses = manifest.spacingClasses.filter(
    c => c.startsWith('p-') && !c.startsWith('px-') && !c.startsWith('py-')
  )
  const pxClasses = manifest.spacingClasses.filter(c => c.startsWith('px-'))
  const pyClasses = manifest.spacingClasses.filter(c => c.startsWith('py-'))

  // Uniform padding
  if (pClasses.length > 0) {
    const codePx = tailwindToPx(pClasses[0])
    if (codePx !== undefined) {
      checkPaddingValue(
        'paddingTop',
        codePx,
        snapshot.spacing.paddingTop,
        pClasses[0],
        differences
      )
      checkPaddingValue(
        'paddingRight',
        codePx,
        snapshot.spacing.paddingRight,
        pClasses[0],
        differences
      )
      checkPaddingValue(
        'paddingBottom',
        codePx,
        snapshot.spacing.paddingBottom,
        pClasses[0],
        differences
      )
      checkPaddingValue(
        'paddingLeft',
        codePx,
        snapshot.spacing.paddingLeft,
        pClasses[0],
        differences
      )
    }
  }

  // Horizontal padding
  if (pxClasses.length > 0) {
    const codePx = tailwindToPx(pxClasses[0])
    if (codePx !== undefined) {
      checkPaddingValue(
        'paddingRight',
        codePx,
        snapshot.spacing.paddingRight,
        pxClasses[0],
        differences
      )
      checkPaddingValue(
        'paddingLeft',
        codePx,
        snapshot.spacing.paddingLeft,
        pxClasses[0],
        differences
      )
    }
  }

  // Vertical padding
  if (pyClasses.length > 0) {
    const codePx = tailwindToPx(pyClasses[0])
    if (codePx !== undefined) {
      checkPaddingValue(
        'paddingTop',
        codePx,
        snapshot.spacing.paddingTop,
        pyClasses[0],
        differences
      )
      checkPaddingValue(
        'paddingBottom',
        codePx,
        snapshot.spacing.paddingBottom,
        pyClasses[0],
        differences
      )
    }
  }
}

function checkPaddingValue(
  prop: string,
  codePx: number,
  figmaPx: number,
  className: string,
  differences: Difference[]
): void {
  if (codePx !== figmaPx) {
    differences.push({
      type: 'spacing',
      propertyPath: `spacing.${prop}`,
      codeValue: `${className} (${codePx}px)`,
      figmaValue: `${figmaPx}px`,
      description: `${prop} mismatch: code uses ${className} (${codePx}px), Figma has ${figmaPx}px`
    })
  }
}

/**
 * Compare radius values between manifest and snapshot.
 */
function compareRadius(
  manifest: ComponentManifest,
  snapshot: FigmaSnapshot,
  differences: Difference[]
): void {
  if (manifest.radiusClasses.length === 0) {
    return // No radius classes in code — skip
  }

  const codeRadius = tailwindToPx(manifest.radiusClasses[0])
  if (codeRadius === undefined) {
    return
  }

  const figmaRadius = Array.isArray(snapshot.cornerRadius)
    ? snapshot.cornerRadius[0] ?? 0
    : snapshot.cornerRadius

  if (codeRadius !== figmaRadius) {
    differences.push({
      type: 'radius',
      propertyPath: 'cornerRadius',
      codeValue: `${manifest.radiusClasses[0]} (${codeRadius}px)`,
      figmaValue: `${figmaRadius}px`,
      description: `Corner radius mismatch: code uses ${manifest.radiusClasses[0]} (${codeRadius}px), Figma has ${figmaRadius}px`
    })
  }
}

/**
 * Format a DriftReport as a human-readable string.
 */
export function formatDriftReport(report: DriftReport): string {
  const lines: string[] = []

  lines.push(`Drift Report — ${report.generatedAt}`)
  lines.push(`${'─'.repeat(60)}`)
  lines.push(
    `Components: ${report.summary.totalComponents} total, ` +
      `${report.summary.inSync} in-sync, ` +
      `${report.summary.drifted} drifted, ` +
      `${report.summary.unlinked} unlinked`
  )
  lines.push(`Total differences: ${report.summary.totalDifferences}`)
  lines.push('')

  for (const entry of report.components) {
    const icon =
      entry.status === 'in-sync' ? '✓' : entry.status === 'drifted' ? '✗' : '?'
    lines.push(`${icon} ${entry.componentName} [${entry.status}]`)

    if (entry.differences.length > 0) {
      for (const diff of entry.differences) {
        lines.push(`  ${diff.type}: ${diff.description}`)
      }
    }
  }

  if (report.tokens.length > 0) {
    lines.push('')
    lines.push('Token Drift:')
    for (const token of report.tokens) {
      lines.push(
        `  ${token.tokenName} (${token.mode}): CSS=${token.cssHex}, Figma=${token.figmaHex}`
      )
    }
  }

  return lines.join('\n')
}
