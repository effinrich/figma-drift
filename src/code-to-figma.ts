// Code-to-Figma Syncer — generates use_figma Plugin API JavaScript
// to update Figma components based on drift detected in code.

import type { DriftEntry, Difference, SyncResult } from './types'
import type { IFigmaMCPAdapter } from './adapters/figma-mcp'

/** Maximum estimated output size per use_figma call (15KB, leaving margin from 20KB limit) */
const MAX_CHUNK_SIZE = 15_000

/** Maximum variant additions per use_figma call */
const MAX_VARIANTS_PER_CALL = 5

/**
 * Sync code changes to Figma for a single component.
 * Generates use_figma scripts based on drift differences and executes them.
 */
export async function syncCodeToFigma(
  adapter: IFigmaMCPAdapter,
  drift: DriftEntry
): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    componentName: drift.componentName,
    direction: 'code-to-figma',
    changesApplied: 0,
    errors: []
  }

  if (!drift.figmaNodeId) {
    result.success = false
    result.errors.push('No Figma node ID — component is unlinked')
    return result
  }

  if (drift.differences.length === 0) {
    return result // Nothing to sync
  }

  // Group differences by type for chunked execution
  const variantDiffs = drift.differences.filter(d => d.type === 'variant')
  const colorDiffs = drift.differences.filter(d => d.type === 'color')
  const spacingDiffs = drift.differences.filter(d => d.type === 'spacing')
  const radiusDiffs = drift.differences.filter(d => d.type === 'radius')

  // Process each type of change
  if (variantDiffs.length > 0) {
    await processVariantChanges(
      adapter,
      drift.figmaNodeId,
      variantDiffs,
      result
    )
  }

  if (colorDiffs.length > 0) {
    await processColorChanges(adapter, drift.figmaNodeId, colorDiffs, result)
  }

  if (spacingDiffs.length > 0) {
    await processSpacingChanges(
      adapter,
      drift.figmaNodeId,
      spacingDiffs,
      result
    )
  }

  if (radiusDiffs.length > 0) {
    await processRadiusChanges(adapter, drift.figmaNodeId, radiusDiffs, result)
  }

  result.success = result.errors.length === 0

  return result
}

// ── Change processors ────────────────────────────────────────────────

/**
 * Process variant additions/removals in Figma.
 * Batches up to MAX_VARIANTS_PER_CALL additions per use_figma call.
 */
async function processVariantChanges(
  adapter: IFigmaMCPAdapter,
  nodeId: string,
  diffs: Difference[],
  result: SyncResult
): Promise<void> {
  // Separate additions (codeValue present, figmaValue null) from removals
  const additions = diffs.filter(
    d => d.codeValue !== null && d.figmaValue === null
  )
  const removals = diffs.filter(
    d => d.codeValue === null && d.figmaValue !== null
  )

  // Process additions in batches
  for (let i = 0; i < additions.length; i += MAX_VARIANTS_PER_CALL) {
    const batch = additions.slice(i, i + MAX_VARIANTS_PER_CALL)
    const script = generateVariantAdditionScript(nodeId, batch)

    if (estimateSize(script) > MAX_CHUNK_SIZE) {
      // Split further if needed
      for (const diff of batch) {
        const singleScript = generateVariantAdditionScript(nodeId, [diff])
        await executeScript(
          adapter,
          singleScript,
          `Add variant ${diff.propertyPath}`,
          result
        )
      }
    } else {
      await executeScript(
        adapter,
        script,
        `Add ${batch.length} variant(s)`,
        result
      )
    }
  }

  // Flag removals — these need user confirmation
  for (const removal of removals) {
    result.errors.push(
      `Orphaned variant "${removal.figmaValue}" at ${removal.propertyPath} — requires manual confirmation to remove from Figma`
    )
  }
}

/**
 * Process color token rebinding in Figma.
 */
async function processColorChanges(
  adapter: IFigmaMCPAdapter,
  nodeId: string,
  diffs: Difference[],
  result: SyncResult
): Promise<void> {
  const script = generateColorUpdateScript(nodeId, diffs)
  await executeScript(adapter, script, 'Update color bindings', result)
}

/**
 * Process spacing adjustments in Figma.
 */
async function processSpacingChanges(
  adapter: IFigmaMCPAdapter,
  nodeId: string,
  diffs: Difference[],
  result: SyncResult
): Promise<void> {
  const script = generateSpacingUpdateScript(nodeId, diffs)
  await executeScript(adapter, script, 'Update spacing values', result)
}

/**
 * Process corner radius changes in Figma.
 */
async function processRadiusChanges(
  adapter: IFigmaMCPAdapter,
  nodeId: string,
  diffs: Difference[],
  result: SyncResult
): Promise<void> {
  const script = generateRadiusUpdateScript(nodeId, diffs)
  await executeScript(adapter, script, 'Update corner radius', result)
}

// ── Script generators ────────────────────────────────────────────────

/**
 * Generate use_figma script to add variant options.
 */
function generateVariantAdditionScript(
  nodeId: string,
  diffs: Difference[]
): string {
  const additions = diffs.map(d => {
    // Parse propertyPath like "variants.size.xl"
    const parts = d.propertyPath.split('.')
    const variantName = parts[1] ?? ''
    const optionValue = parts[2] ?? d.codeValue ?? ''
    return { variantName, optionValue }
  })

  return `
const node = figma.getNodeById('${nodeId}');
if (node && node.type === 'COMPONENT_SET') {
  const propDefs = node.componentPropertyDefinitions;
  ${additions
    .map(
      a => `
  if (propDefs['${a.variantName}']) {
    const opts = propDefs['${a.variantName}'].variantOptions || [];
    if (!opts.includes('${a.optionValue}')) {
      opts.push('${a.optionValue}');
      node.editComponentProperty('${a.variantName}', { variantOptions: opts });
    }
  }
  `
    )
    .join('\n')}
}
  `.trim()
}

/**
 * Generate use_figma script to update color bindings.
 */
function generateColorUpdateScript(
  nodeId: string,
  diffs: Difference[]
): string {
  // For color changes, we rebind to the correct token variable
  const updates = diffs
    .filter(d => d.codeValue !== null)
    .map(d => {
      const tokenName = d.codeValue?.replace('token:', '') ?? ''
      return `
  // Update color at ${d.propertyPath}
  const vars_${sanitize(tokenName)} = figma.variables.getLocalVariables().find(v => v.name === '${tokenName}');
  if (vars_${sanitize(tokenName)}) {
    // Apply variable binding to matching layers
    const layers = node.findAll ? node.findAll() : [node];
    for (const layer of layers) {
      if (layer.fills && Array.isArray(layer.fills)) {
        const newFills = layer.fills.map(f => ({
          ...f,
          boundVariables: { ...f.boundVariables, color: { type: 'VARIABLE_ALIAS', id: vars_${sanitize(tokenName)}.id } }
        }));
        layer.fills = newFills;
      }
    }
  }`
    })

  return `
const node = figma.getNodeById('${nodeId}');
if (node) {
  ${updates.join('\n')}
}
  `.trim()
}

/**
 * Generate use_figma script to update spacing values.
 */
function generateSpacingUpdateScript(
  nodeId: string,
  diffs: Difference[]
): string {
  const updates = diffs.map(d => {
    // Extract pixel value from codeValue like "gap-4 (16px)"
    const pxMatch = d.codeValue?.match(/\((\d+)px\)/)
    const px = pxMatch ? pxMatch[1] : '0'
    const prop = d.propertyPath.split('.').pop() ?? ''

    return `  node.${prop} = ${px};`
  })

  return `
const node = figma.getNodeById('${nodeId}');
if (node && 'layoutMode' in node) {
  ${updates.join('\n')}
}
  `.trim()
}

/**
 * Generate use_figma script to update corner radius.
 */
function generateRadiusUpdateScript(
  nodeId: string,
  diffs: Difference[]
): string {
  const pxMatch = diffs[0]?.codeValue?.match(/\((\d+)px\)/)
  const px = pxMatch ? pxMatch[1] : '0'

  return `
const node = figma.getNodeById('${nodeId}');
if (node && 'cornerRadius' in node) {
  node.cornerRadius = ${px};
}
  `.trim()
}

// ── Utilities ────────────────────────────────────────────────────────

/**
 * Execute a use_figma script and update the result.
 */
async function executeScript(
  adapter: IFigmaMCPAdapter,
  script: string,
  description: string,
  result: SyncResult
): Promise<void> {
  try {
    const response = await adapter.useFigma(script, description)
    if (response.success) {
      result.changesApplied++
    } else {
      result.errors.push(`${description}: ${response.error ?? 'Unknown error'}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.errors.push(`${description}: ${message}`)
  }
}

/**
 * Estimate the byte size of a string.
 */
function estimateSize(str: string): number {
  return new TextEncoder().encode(str).length
}

/**
 * Sanitize a string for use as a JavaScript variable name.
 */
function sanitize(str: string): string {
  return str.replace(/[^a-zA-Z0-9_]/g, '_')
}
