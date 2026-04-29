// Sync Engine — main orchestration entry point that coordinates all modules.
// Consumed by both CLI and Kiro hooks.

import type { DriftReport, DriftEntry, SyncResult } from './types'
import type { IFigmaMCPAdapter } from './adapters/figma-mcp'
import { loadConfig, CONFIG_DEFAULTS } from './config'
import { extractManifest } from './manifest-extractor'
import { extractSnapshot } from './snapshot-extractor'
import { compareSingle, compareAll } from './drift-detector'
import { syncCodeToFigma } from './code-to-figma'
import { syncFigmaToCode } from './figma-to-code'
import {
  extractCSSTokens,
  extractFigmaTokens,
  compareTokens,
  syncTokenToFigma,
  syncTokenToCSS
} from './token-syncer'
import { generateStory } from './story-generator'
import {
  loadComponentMap,
  saveComponentMap,
  initComponentMap,
  updateEntry,
  findEntry
} from './component-map'
import {
  logSyncResult,
  logStoryResult,
  logDriftResult,
  logTokenResult,
  logInitResult
} from './sync-logger'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CSS_TOKENS_PATH = 'src/index.css'

export type SyncDirection = 'code-to-figma' | 'figma-to-code'

export type PipelineOptions = {
  /** Sync direction — if not set, each component needs individual direction */
  direction?: SyncDirection
  /** Dry run — print planned operations without executing */
  dryRun?: boolean
  /** Filter to a specific component name */
  componentName?: string
}

export type PipelineResult = {
  driftReport: DriftReport
  syncResults: SyncResult[]
  storiesGenerated: number
  errors: string[]
}

/**
 * Run drift detection across all components in the Component Map.
 */
export async function runDriftDetection(
  adapter: IFigmaMCPAdapter
): Promise<DriftReport> {
  let map = loadComponentMap()
  if (!map) {
    map = await initComponentMap(adapter)
    logInitResult(map.entries.length, true)
  }

  const report = await compareAll(map, adapter)

  // Add token drift
  try {
    const cssTokens = extractCSSTokens(CSS_TOKENS_PATH)
    const figmaTokens = await extractFigmaTokens(
      adapter,
      map.entries[0]?.figmaNodeId ?? '0:0'
    )
    report.tokens = compareTokens(cssTokens, figmaTokens)
  } catch {
    // Token comparison failed — continue without token drift
  }

  logDriftResult(report.summary)
  return report
}

/**
 * Run drift detection for a single component.
 */
export async function runSingleDriftDetection(
  adapter: IFigmaMCPAdapter,
  filePath: string
): Promise<DriftEntry | null> {
  const map = loadComponentMap()
  if (!map) return null

  const entry = map.entries.find(e => e.filePath === filePath)
  if (!entry) return null

  try {
    const manifest = extractManifest(entry.filePath)
    let snapshot = null

    if (entry.figmaNodeId) {
      try {
        snapshot = await extractSnapshot(adapter, entry.figmaNodeId)
      } catch {
        // Figma fetch failed
      }
    }

    return compareSingle(manifest, snapshot, entry.figmaNodeId)
  } catch {
    return null
  }
}

/**
 * Run code-to-Figma sync for a component.
 */
export async function runCodeToFigmaSync(
  adapter: IFigmaMCPAdapter,
  componentName: string
): Promise<SyncResult> {
  const map = loadComponentMap()
  if (!map) {
    return {
      success: false,
      componentName,
      direction: 'code-to-figma',
      changesApplied: 0,
      errors: ['Component map not found. Run sync init first.']
    }
  }

  const entry = findEntry(map, componentName)
  if (!entry) {
    return {
      success: false,
      componentName,
      direction: 'code-to-figma',
      changesApplied: 0,
      errors: [`Component "${componentName}" not found in component map.`]
    }
  }

  // Extract manifest and snapshot
  const manifest = extractManifest(entry.filePath)
  let snapshot = null
  if (entry.figmaNodeId) {
    snapshot = await extractSnapshot(adapter, entry.figmaNodeId)
  }

  const drift = compareSingle(manifest, snapshot, entry.figmaNodeId)

  if (drift.status === 'in-sync') {
    return {
      success: true,
      componentName,
      direction: 'code-to-figma',
      changesApplied: 0,
      errors: []
    }
  }

  const result = await syncCodeToFigma(adapter, drift)

  // Update component map on success
  if (result.success) {
    const updatedMap = updateEntry(map, componentName, {
      lastSyncedAt: new Date().toISOString(),
      lastSyncDirection: 'code-to-figma'
    })
    saveComponentMap(updatedMap)
  }

  logSyncResult(
    componentName,
    'code-to-figma',
    result.success,
    result.errors[0]
  )
  return result
}

/**
 * Run Figma-to-code sync for a component.
 */
export async function runFigmaToCodeSync(
  adapter: IFigmaMCPAdapter,
  componentName: string
): Promise<SyncResult> {
  const map = loadComponentMap()
  if (!map) {
    return {
      success: false,
      componentName,
      direction: 'figma-to-code',
      changesApplied: 0,
      errors: ['Component map not found. Run sync init first.']
    }
  }

  const entry = findEntry(map, componentName)
  if (!entry) {
    return {
      success: false,
      componentName,
      direction: 'figma-to-code',
      changesApplied: 0,
      errors: [`Component "${componentName}" not found in component map.`]
    }
  }

  // Extract manifest and snapshot
  const manifest = extractManifest(entry.filePath)
  let snapshot = null
  if (entry.figmaNodeId) {
    snapshot = await extractSnapshot(adapter, entry.figmaNodeId)
  }

  const drift = compareSingle(manifest, snapshot, entry.figmaNodeId)

  if (drift.status === 'in-sync') {
    return {
      success: true,
      componentName,
      direction: 'figma-to-code',
      changesApplied: 0,
      errors: []
    }
  }

  const result = await syncFigmaToCode(drift)

  // Update component map on success
  if (result.success) {
    const updatedMap = updateEntry(map, componentName, {
      lastSyncedAt: new Date().toISOString(),
      lastSyncDirection: 'figma-to-code'
    })
    saveComponentMap(updatedMap)
  }

  logSyncResult(
    componentName,
    'figma-to-code',
    result.success,
    result.errors[0]
  )
  return result
}

/**
 * Run token sync between CSS and Figma.
 */
export async function runTokenSync(
  adapter: IFigmaMCPAdapter,
  direction: SyncDirection
): Promise<{ synced: number; errors: string[] }> {
  const cssTokens = extractCSSTokens(CSS_TOKENS_PATH)

  const map = loadComponentMap()
  const nodeId = map?.entries[0]?.figmaNodeId ?? '0:0'
  const figmaTokens = await extractFigmaTokens(adapter, nodeId)

  const drifts = compareTokens(cssTokens, figmaTokens)

  let synced = 0
  const errors: string[] = []

  for (const drift of drifts) {
    try {
      const cssToken = cssTokens.find(t => t.name === drift.tokenName)
      const figmaToken = figmaTokens.find(t => t.name === drift.tokenName)

      if (direction === 'code-to-figma' && cssToken) {
        await syncTokenToFigma(adapter, cssToken, drift.mode)
        synced++
        logTokenResult(drift.tokenName, direction, true)
      } else if (direction === 'figma-to-code' && figmaToken) {
        syncTokenToCSS(figmaToken, CSS_TOKENS_PATH, drift.mode)
        synced++
        logTokenResult(drift.tokenName, direction, true)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      errors.push(`Token ${drift.tokenName}: ${msg}`)
      logTokenResult(drift.tokenName, direction, false, msg)
    }
  }

  return { synced, errors }
}

/**
 * Run story generation for a component.
 */
export function runStoryGeneration(componentName: string): {
  success: boolean
  storyPath: string
  error?: string
} {
  const map = loadComponentMap()
  if (!map) {
    return { success: false, storyPath: '', error: 'Component map not found' }
  }

  const entry = findEntry(map, componentName)
  if (!entry) {
    return {
      success: false,
      storyPath: '',
      error: `Component "${componentName}" not found`
    }
  }

  try {
    const manifest = extractManifest(entry.filePath)

    // Determine story output path
    const storyDir = deriveStoryDir(entry.filePath)
    const storyPath = join(storyDir, `${manifest.componentName}.stories.tsx`)

    const options = {
      merge: existsSync(storyPath),
      existingStoryPath: existsSync(storyPath) ? storyPath : undefined
    }

    const storyContent = generateStory(manifest, options)

    // Ensure directory exists
    if (!existsSync(storyDir)) {
      mkdirSync(storyDir, { recursive: true })
    }

    writeFileSync(storyPath, storyContent, 'utf-8')

    logStoryResult(componentName, true, storyPath)
    return { success: true, storyPath }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logStoryResult(componentName, false, undefined, msg)
    return { success: false, storyPath: '', error: msg }
  }
}

/**
 * Run the full pipeline: drift → sync → stories.
 */
export async function runFullPipeline(
  adapter: IFigmaMCPAdapter,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const errors: string[] = []
  const syncResults: SyncResult[] = []
  let storiesGenerated = 0

  // Step 1: Load or init component map
  let map = loadComponentMap()
  if (!map) {
    map = await initComponentMap(adapter)
    logInitResult(map.entries.length, true)
  }

  // Step 2: Run drift detection
  const driftReport = await compareAll(map, adapter)

  // Add token drift
  try {
    const cssTokens = extractCSSTokens(CSS_TOKENS_PATH)
    const nodeId = map.entries[0]?.figmaNodeId ?? '0:0'
    const figmaTokens = await extractFigmaTokens(adapter, nodeId)
    driftReport.tokens = compareTokens(cssTokens, figmaTokens)
  } catch {
    // Token comparison failed
  }

  logDriftResult(driftReport.summary)

  if (options.dryRun) {
    return { driftReport, syncResults, storiesGenerated, errors }
  }

  // Step 3: Sync drifted components
  const driftedComponents = driftReport.components.filter(c => {
    if (options.componentName) {
      return c.componentName === options.componentName && c.status === 'drifted'
    }
    return c.status === 'drifted'
  })

  for (const drift of driftedComponents) {
    const direction = options.direction
    if (!direction) continue // No direction specified — skip

    try {
      let result: SyncResult

      if (direction === 'code-to-figma') {
        result = await syncCodeToFigma(adapter, drift)
      } else {
        result = await syncFigmaToCode(drift)
      }

      syncResults.push(result)

      // Update component map on success
      if (result.success) {
        map = updateEntry(map, drift.componentName, {
          lastSyncedAt: new Date().toISOString(),
          lastSyncDirection: direction
        })
      }

      logSyncResult(
        drift.componentName,
        direction,
        result.success,
        result.errors[0]
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      errors.push(`${drift.componentName}: ${msg}`)
      logSyncResult(drift.componentName, direction, false, msg)
    }
  }

  // Step 4: Generate stories for synced components
  for (const result of syncResults) {
    if (result.success) {
      const storyResult = runStoryGeneration(result.componentName)
      if (storyResult.success) {
        storiesGenerated++
      }
    }
  }

  // Step 5: Save updated component map
  saveComponentMap(map)

  return { driftReport, syncResults, storiesGenerated, errors }
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Derive the story directory from a component file path.
 * Uses storyDirMap from config, falling back to defaults.
 */
function deriveStoryDir(filePath: string): string {
  const config = loadConfig()
  const storyDirMap = config?.storyDirMap ?? CONFIG_DEFAULTS.storyDirMap
  const defaultDir = config?.defaultStoryDir ?? CONFIG_DEFAULTS.defaultStoryDir

  for (const [pathFragment, storyDir] of Object.entries(storyDirMap)) {
    if (filePath.includes(pathFragment)) {
      return storyDir
    }
  }
  return defaultDir
}
