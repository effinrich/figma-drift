// @forgekitdev/figma-drift — Public API

// Core types
export type {
  ComponentManifest,
  PropDefinition,
  FigmaSnapshot,
  ColorBinding,
  SpacingValues,
  LayerSummary,
  DriftReport,
  DriftEntry,
  Difference,
  TokenDrift,
  ComponentMap,
  ComponentMapEntry,
  DesignToken,
  SyncResult,
  FigmaDesignContext,
  FigmaMetadata,
  FigmaVariableCollection,
  FigmaVariableGroup,
  FigmaVariable,
  FigmaSearchResult,
  UseFigmaResult,
  FigmaMCPAdapterOptions
} from './types'

// Engine — main orchestration
export {
  runDriftDetection,
  runSingleDriftDetection,
  runCodeToFigmaSync,
  runFigmaToCodeSync,
  runTokenSync,
  runStoryGeneration,
  runFullPipeline
} from './engine'
export type { SyncDirection, PipelineOptions, PipelineResult } from './engine'

// Manifest Extractor
export { extractManifest } from './manifest-extractor'

// Snapshot Extractor
export { extractSnapshot } from './snapshot-extractor'

// Drift Detector
export { compareSingle, compareAll, formatDriftReport } from './drift-detector'

// Code-to-Figma Syncer
export { syncCodeToFigma } from './code-to-figma'

// Figma-to-Code Syncer
export { syncFigmaToCode } from './figma-to-code'

// Token Syncer
export {
  extractCSSTokens,
  extractCSSTokensFromString,
  extractFigmaTokens,
  compareTokens,
  syncTokenToFigma,
  syncTokenToCSS
} from './token-syncer'

// Story Generator
export { generateStory, mergeStories } from './story-generator'
export type { StoryGenOptions } from './story-generator'

// Component Map
export {
  loadComponentMap,
  saveComponentMap,
  initComponentMap,
  updateEntry,
  findEntry,
  findEntryByPath,
  getComponentMapPath
} from './component-map'

// Sync Logger
export {
  logSync,
  logSyncResult,
  logStoryResult,
  logDriftResult,
  logTokenResult,
  logInitResult,
  getSyncLogPath
} from './sync-logger'
export type { LogType, LogEntry } from './sync-logger'

// Color Utilities
export { parseOKLCH, figmaRGBToHex, colorsMatch } from './color-utils'

// Value Mapping
export { tailwindToPx, pxToTailwind } from './value-mapping'

// Configuration
export { loadConfig, resolveFileKey, extractFileKeyFromURL } from './config'
export type { FigmaDriftConfig } from './config'

// Constants
export { SPACING_MAP, RADIUS_MAP, TOKEN_PATTERN } from './constants'

// Figma MCP Adapter
export {
  FigmaMCPAdapter,
  FigmaMCPError,
  FigmaConnectionError,
  FigmaTruncationError,
  createFigmaMCPAdapter
} from './adapters/figma-mcp'
export type { MCPToolCaller, IFigmaMCPAdapter } from './adapters/figma-mcp'
