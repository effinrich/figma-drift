// Component Map — manages the registry that associates each React
// component file path with its corresponding Figma node ID.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync
} from 'node:fs'
import { join, dirname } from 'node:path'
import type { ComponentMap, ComponentMapEntry } from './types'
import type { IFigmaMCPAdapter } from './adapters/figma-mcp'
import { loadConfig, CONFIG_DEFAULTS } from './config'

function getMapPath(): string {
  return loadConfig()?.componentMapPath ?? CONFIG_DEFAULTS.componentMapPath
}

function getComponentDirs(): string[] {
  return loadConfig()?.componentDirs ?? [...CONFIG_DEFAULTS.componentDirs]
}

/**
 * Load the Component Map from disk.
 * Returns null if the file doesn't exist.
 */
export function loadComponentMap(): ComponentMap | null {
  if (!existsSync(getMapPath())) {
    return null
  }

  try {
    const content = readFileSync(getMapPath(), 'utf-8')
    return JSON.parse(content) as ComponentMap
  } catch {
    return null
  }
}

/**
 * Save the Component Map to disk.
 * Creates the directory structure if it doesn't exist.
 */
export function saveComponentMap(map: ComponentMap): void {
  const dir = dirname(getMapPath())
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(getMapPath(), JSON.stringify(map, null, 2) + '\n', 'utf-8')
}

/**
 * Initialize a Component Map by scanning component directories
 * and matching to Figma components via search_design_system.
 */
export async function initComponentMap(
  adapter: IFigmaMCPAdapter
): Promise<ComponentMap> {
  const entries: ComponentMapEntry[] = []

  // Scan component directories
  const componentDirs = getComponentDirs()

  for (const dir of componentDirs) {
    if (!existsSync(dir)) continue

    const files = readdirSync(dir).filter(f => f.endsWith('.tsx'))

    for (const file of files) {
      const filePath = join(dir, file)
      const componentName = deriveComponentName(file)

      // Try to match with Figma via search
      let figmaNodeId: string | null = null
      let figmaPageName: string | null = null

      try {
        const results = await adapter.searchDesignSystem(componentName)
        if (results.length > 0) {
          // Use the best match (first result)
          figmaNodeId = results[0].nodeId || null
          figmaPageName = results[0].pageName || null
        }
      } catch {
        // Search failed — leave as unlinked
      }

      entries.push({
        filePath,
        figmaNodeId,
        figmaPageName,
        componentName,
        lastSyncedAt: null,
        lastSyncDirection: null
      })
    }
  }

  const map: ComponentMap = {
    version: 1,
    figmaFileKey: loadConfig()?.fileKey ?? '',
    entries
  }

  saveComponentMap(map)
  return map
}

/**
 * Update a single entry in the Component Map.
 */
export function updateEntry(
  map: ComponentMap,
  componentName: string,
  updates: Partial<
    Pick<
      ComponentMapEntry,
      'lastSyncedAt' | 'lastSyncDirection' | 'figmaNodeId' | 'figmaPageName'
    >
  >
): ComponentMap {
  const updatedEntries = map.entries.map(entry => {
    if (entry.componentName === componentName) {
      return { ...entry, ...updates }
    }
    return entry
  })

  return {
    ...map,
    entries: updatedEntries
  }
}

/**
 * Find an entry by component name.
 */
export function findEntry(
  map: ComponentMap,
  componentName: string
): ComponentMapEntry | undefined {
  return map.entries.find(e => e.componentName === componentName)
}

/**
 * Find an entry by file path.
 */
export function findEntryByPath(
  map: ComponentMap,
  filePath: string
): ComponentMapEntry | undefined {
  return map.entries.find(e => e.filePath === filePath)
}

/**
 * Get the path to the component map file.
 */
export function getComponentMapPath(): string {
  return getMapPath()
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Derive a component name from a filename.
 * e.g., "button.tsx" → "Button", "stat-card.tsx" → "StatCard"
 */
function deriveComponentName(filename: string): string {
  const base = filename.replace(/\.tsx?$/, '')
  return base
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}
