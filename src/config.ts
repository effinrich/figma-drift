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
  /** Path to the component map JSON file. Default: '.kiro/sync/component-map.json' */
  componentMapPath?: string
  /** Path to the sync log file. Default: '.kiro/sync/sync.log' */
  syncLogPath?: string
  /** Directories to scan for React components. Default: ['src/components/ui', 'src/components/dashboard'] */
  componentDirs?: string[]
  /** Story output directory mapping. Keys are path fragments to match, values are output dirs. */
  storyDirMap?: Record<string, string>
  /** Default story output directory when no mapping matches. Default: 'src/stories' */
  defaultStoryDir?: string
  /** When true, sync runs automatically without prompting. Default: false (prompt mode) */
  autoSync?: boolean
  /** Preferred sync direction when autoSync is true. If not set, requires explicit direction. */
  preferDirection?: 'code-to-figma' | 'figma-to-code'
  /** When true, auto-generate stories after every sync. Default: true */
  autoStories?: boolean
}

/** Default configuration values */
export const CONFIG_DEFAULTS = {
  componentMapPath: '.kiro/sync/component-map.json',
  syncLogPath: '.kiro/sync/sync.log',
  componentDirs: ['src/components/ui', 'src/components/dashboard'],
  storyDirMap: {
    'components/ui/': 'src/stories/atoms',
    'components/dashboard/': 'src/stories/molecules'
  } as Record<string, string>,
  defaultStoryDir: 'src/stories',
  autoSync: false,
  autoStories: true
} as const

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
  // Priority 2: Config file (load first so we can merge)
  const fileConfig = loadConfigFile() ?? {}

  // Priority 1: Explicit overrides
  if (overrides?.fileKey) {
    return mergeConfig(
      { fileKey: resolveFileKey(overrides.fileKey) },
      overrides,
      fileConfig
    )
  }

  // Priority 2: Config file
  if (fileConfig?.fileKey) {
    return mergeConfig(
      { fileKey: resolveFileKey(fileConfig.fileKey) },
      overrides ?? {},
      fileConfig
    )
  }

  // Priority 3: Environment variable
  const envKey = process.env.FIGMA_DRIFT_FILE_KEY
  if (envKey) {
    return mergeConfig(
      { fileKey: resolveFileKey(envKey) },
      overrides ?? {},
      fileConfig
    )
  }

  return null
}

/**
 * Merge config from overrides, file config, and defaults.
 * Priority: overrides > fileConfig > defaults
 */
function mergeConfig(
  base: { fileKey: string },
  overrides: Partial<FigmaDriftConfig>,
  fileConfig: Partial<FigmaDriftConfig>
): FigmaDriftConfig {
  return {
    fileKey: base.fileKey,
    componentMapPath:
      overrides.componentMapPath ??
      fileConfig.componentMapPath ??
      CONFIG_DEFAULTS.componentMapPath,
    syncLogPath:
      overrides.syncLogPath ??
      fileConfig.syncLogPath ??
      CONFIG_DEFAULTS.syncLogPath,
    componentDirs: overrides.componentDirs ??
      fileConfig.componentDirs ?? [...CONFIG_DEFAULTS.componentDirs],
    storyDirMap: overrides.storyDirMap ??
      fileConfig.storyDirMap ?? { ...CONFIG_DEFAULTS.storyDirMap },
    defaultStoryDir:
      overrides.defaultStoryDir ??
      fileConfig.defaultStoryDir ??
      CONFIG_DEFAULTS.defaultStoryDir,
    autoSync:
      overrides.autoSync ?? fileConfig.autoSync ?? CONFIG_DEFAULTS.autoSync,
    preferDirection: overrides.preferDirection ?? fileConfig.preferDirection,
    autoStories:
      overrides.autoStories ??
      fileConfig.autoStories ??
      CONFIG_DEFAULTS.autoStories
  }
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
