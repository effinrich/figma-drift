// Core data models for bidirectional sync tooling
// All types use the `type` keyword for verbatimModuleSyntax compatibility

// --- ComponentManifest ---

export type PropDefinition = {
  name: string
  type: string
  required: boolean
  defaultValue?: string
}

export type ComponentManifest = {
  /** Component display name, e.g. "Button" */
  componentName: string
  /** File path relative to project root */
  filePath: string
  /** Exported props with TypeScript types */
  props: PropDefinition[]
  /** Variant definitions from cva() */
  variants: Record<string, string[]>
  /** Default variant values */
  defaultVariants: Record<string, string>
  /** Design token names referenced in Tailwind classes */
  tokenReferences: string[]
  /** Tailwind spacing classes used (gap-*, p-*, px-*, py-*) */
  spacingClasses: string[]
  /** Tailwind radius classes used (rounded-*) */
  radiusClasses: string[]
  /** Sub-components exported from the same file */
  subComponents: string[]
}

// --- FigmaSnapshot ---

export type ColorBinding = {
  /** Where the color is applied: fill, stroke, or text */
  target: 'fill' | 'stroke' | 'text'
  /** Layer path within the component */
  layerPath: string
  /** Token name if bound to a variable, null if hardcoded */
  tokenName: string | null
  /** Hex color value (always present, resolved from variable or hardcoded) */
  hexValue: string
}

export type SpacingValues = {
  layoutMode: 'horizontal' | 'vertical' | 'none'
  itemSpacing: number
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
}

export type LayerSummary = {
  name: string
  type: string
  children?: LayerSummary[]
}

export type FigmaSnapshot = {
  /** Figma node ID */
  nodeId: string
  /** Component name in Figma */
  componentName: string
  /** Variant properties and their values */
  variants: Record<string, string[]>
  /** Color bindings: token name when variable-bound, hex when hardcoded */
  colors: ColorBinding[]
  /** Auto-layout spacing values in px */
  spacing: SpacingValues
  /** Corner radius in px */
  cornerRadius: number | number[]
  /** Layer structure summary */
  layers: LayerSummary[]
}

// --- DriftReport ---

export type Difference = {
  type: 'color' | 'spacing' | 'radius' | 'variant' | 'prop'
  propertyPath: string
  codeValue: string | null
  figmaValue: string | null
  description: string
}

export type DriftEntry = {
  componentName: string
  filePath: string
  figmaNodeId: string | null
  status: 'in-sync' | 'drifted' | 'unlinked'
  differences: Difference[]
}

export type TokenDrift = {
  tokenName: string
  cssValue: string
  figmaValue: string
  cssHex: string
  figmaHex: string
  mode: 'light' | 'dark'
}

export type DriftReport = {
  /** ISO 8601 timestamp of when the report was generated */
  generatedAt: string
  /** Per-component drift entries */
  components: DriftEntry[]
  /** Token-level drift (src/index.css vs Figma variables) */
  tokens: TokenDrift[]
  /** Summary counts */
  summary: {
    totalComponents: number
    inSync: number
    drifted: number
    unlinked: number
    totalDifferences: number
  }
}

// --- ComponentMap ---

export type ComponentMapEntry = {
  filePath: string
  figmaNodeId: string | null
  figmaPageName: string | null
  componentName: string
  lastSyncedAt: string | null
  lastSyncDirection: 'code-to-figma' | 'figma-to-code' | null
}

export type ComponentMap = {
  version: 1
  figmaFileKey: string
  entries: ComponentMapEntry[]
}

// --- DesignToken ---

export type DesignToken = {
  name: string
  lightValue: string // OKLCH string from CSS or hex from Figma
  darkValue: string // OKLCH string from CSS or hex from Figma
  lightHex: string // Normalized hex for comparison
  darkHex: string // Normalized hex for comparison
  source: 'css' | 'figma'
}

// --- SyncResult ---

export type SyncResult = {
  /** Whether the sync operation succeeded */
  success: boolean
  /** Component that was synced */
  componentName: string
  /** Direction of the sync */
  direction: 'code-to-figma' | 'figma-to-code'
  /** Number of changes applied */
  changesApplied: number
  /** Error details if the sync failed */
  errors: string[]
}

// --- Figma MCP Adapter Types ---

/** Raw design context returned by get_design_context MCP tool */
export type FigmaDesignContext = {
  /** The Figma node ID that was queried */
  nodeId: string
  /** Raw design context content from the MCP tool */
  content: string
  /** Whether the response was truncated due to the 20KB limit */
  truncated: boolean
}

/** Metadata returned by get_metadata MCP tool */
export type FigmaMetadata = {
  /** The Figma node ID that was queried */
  nodeId: string
  /** Raw metadata content from the MCP tool */
  content: string
  /** Node map for sub-node navigation when design context is truncated */
  nodeMap: Record<string, string>
}

/** Variable definitions returned by get_variable_defs MCP tool */
export type FigmaVariableCollection = {
  /** Raw variable definitions content from the MCP tool */
  content: string
  /** Parsed variable collections, keyed by collection name */
  collections: Record<string, FigmaVariableGroup>
}

/** A group of variables within a collection */
export type FigmaVariableGroup = {
  /** Collection name */
  name: string
  /** Mode names (e.g., "Light", "Dark") */
  modes: string[]
  /** Variables in this collection */
  variables: FigmaVariable[]
}

/** A single Figma variable definition */
export type FigmaVariable = {
  /** Variable name (e.g., "primary", "background") */
  name: string
  /** Values per mode, keyed by mode name */
  valuesByMode: Record<string, string>
}

/** Search result from search_design_system MCP tool */
export type FigmaSearchResult = {
  /** Node ID of the matching component */
  nodeId: string
  /** Component name in Figma */
  name: string
  /** Page name where the component lives */
  pageName: string
  /** Description of the component */
  description: string
}

/** Result from use_figma MCP tool */
export type UseFigmaResult = {
  /** Whether the script executed successfully */
  success: boolean
  /** Raw output from the use_figma call */
  output: string
  /** Error message if the script failed */
  error?: string
}

/** Options for configuring the Figma MCP adapter */
export type FigmaMCPAdapterOptions = {
  /** Figma file key */
  fileKey: string
  /** Connection timeout in milliseconds (default: 10000) */
  connectionTimeoutMs?: number
  /** Maximum number of retries for transient failures (default: 2) */
  maxRetries?: number
  /** Delay between retries in milliseconds (default: 1000) */
  retryDelayMs?: number
  /** Output size limit in bytes for truncation detection (default: 20480) */
  outputLimitBytes?: number
}
