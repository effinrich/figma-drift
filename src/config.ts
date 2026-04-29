// Configuration resolution for figma-drift.
// Resolves the Figma file key from (in priority order):
// 1. Explicit argument (CLI flag or function parameter)
// 2. Config file (.figma-drift.json or package.json "figmaDrift" key)
// 3. Environment variable (FIGMA_DRIFT_FILE_KEY)

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export type FigmaDriftConfig = {
  /** Figma file key (extracted from URL or provided directly) */
  fileKey: string
  /** Optional: component map path override */
  componentMapPath?: string
  /** Optional: sync log path override */
  syncLogPath?: string
  /** When true, sync runs automatically without prompting. Default: false (prompt mode) */
  autoSync?: boolean
  /** Preferred sync direction when autoSync is true. If not set, requires explicit direction. */
  preferDirection?: 'code-to-figma' | 'figma-to-code'
  /** When true, auto-generate stories after every sync. Default: true */
  autoStories?: boolean
}

/**
 * Extract a Figma file key from a full Figma URL.
 * Supports formats:
 *   https://figma.com/design/:fileKey/:fileName
 *   https://figma.com/design/:fileKey/:fileName?node-id=1-2
 *   https://www.figma.com/design/:fileKey/:fileName
 *   https://figma.com/design/:fileKey/branch/:branchKey/:fileName (uses branchKey)
 */
export function extractFileKeyFromURL(url: string): string | null {
  // Branch URL: /design/:fileKey/branch/:branchKey/:fileName
  const branchMatch = url.match(/figma\.com\/design\/[\w-]+\/branch\/([\w-]+)/)
  if (branchMatch) {
    return branchMatch[1]
  }

  // Standard URL: /design/:fileKey/:fileName
  const standardMatch = url.match(/figma\.com\/design\/([\w-]+)/)
  if (standardMatch) {
    return standardMatch[1]
  }

  return null
}

/**
 * Resolve the file key from a string that could be either a URL or a raw key.
 */
export function resolveFileKey(input: string): string {
  // If it looks like a URL, extract the key
  if (input.includes('figma.com')) {
    const key = extractFileKeyFromURL(input)
    if (key) return key
    throw new Error(
      `Could not extract file key from URL: ${input}\n` +
        'Expected format: https://figma.com/design/:fileKey/:fileName'
    )
  }
  // Otherwise treat as a raw file key
  return input
}

/**
 * Load configuration from all sources, merged by priority.
 * Returns null if no file key can be resolved.
 */
export function loadConfig(
  overrides?: Partial<FigmaDriftConfig>
): FigmaDriftConfig | null {
  // Priority 1: Explicit overrides
  if (overrides?.fileKey) {
    return {
      fileKey: resolveFileKey(overrides.fileKey),
      componentMapPath: overrides.componentMapPath,
      syncLogPath: overrides.syncLogPath,
      autoSync: overrides.autoSync,
      preferDirection: overrides.preferDirection,
      autoStories: overrides.autoStories
    }
  }

  // Priority 2: Config file
  const fileConfig = loadConfigFile()
  if (fileConfig?.fileKey) {
    return {
      ...fileConfig,
      fileKey: resolveFileKey(fileConfig.fileKey),
      autoSync: overrides?.autoSync ?? fileConfig.autoSync,
      preferDirection: overrides?.preferDirection ?? fileConfig.preferDirection,
      autoStories: overrides?.autoStories ?? fileConfig.autoStories
    }
  }

  // Priority 3: Environment variable
  const envKey = process.env.FIGMA_DRIFT_FILE_KEY
  if (envKey) {
    return {
      fileKey: resolveFileKey(envKey),
      autoSync: overrides?.autoSync,
      preferDirection: overrides?.preferDirection,
      autoStories: overrides?.autoStories
    }
  }

  return null
}

/**
 * Load config from .figma-drift.json or package.json "figmaDrift" field.
 */
function loadConfigFile(): Partial<FigmaDriftConfig> | null {
  const cwd = process.cwd()

  // Try .figma-drift.json
  const configPath = join(cwd, '.figma-drift.json')
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8')
      return JSON.parse(content) as Partial<FigmaDriftConfig>
    } catch {
      return null
    }
  }

  // Try package.json "figmaDrift" field
  const pkgPath = join(cwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const content = readFileSync(pkgPath, 'utf-8')
      const pkg = JSON.parse(content)
      if (pkg.figmaDrift && typeof pkg.figmaDrift === 'object') {
        return pkg.figmaDrift as Partial<FigmaDriftConfig>
      }
    } catch {
      return null
    }
  }

  return null
}
