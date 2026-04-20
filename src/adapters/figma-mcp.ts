// Figma MCP Adapter — wraps Figma MCP tool calls with error handling,
// timeout detection, retry logic, and output truncation management.
//
// This adapter defines the interface for interacting with Figma through
// the Kiro power system's MCP tools. The concrete implementation delegates
// to an injected MCP caller function, making it testable without a live
// MCP connection.

import type {
  FigmaDesignContext,
  FigmaMetadata,
  FigmaVariableCollection,
  FigmaVariableGroup,
  FigmaVariable,
  FigmaSearchResult,
  UseFigmaResult,
  FigmaMCPAdapterOptions
} from '../types'

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 1_000
const DEFAULT_OUTPUT_LIMIT_BYTES = 20_480 // 20KB

// ── Error types ────────────────────────────────────────────────────────

export class FigmaMCPError extends Error {
  readonly toolName: string
  override readonly cause?: unknown

  constructor(message: string, toolName: string, cause?: unknown) {
    super(message)
    this.name = 'FigmaMCPError'
    this.toolName = toolName
    this.cause = cause
  }
}

export class FigmaConnectionError extends FigmaMCPError {
  constructor(toolName: string, timeoutMs: number) {
    super(
      `Figma MCP server is not connected. Timed out after ${timeoutMs}ms. ` +
        'Please ensure the Figma MCP is running and connected.',
      toolName
    )
    this.name = 'FigmaConnectionError'
  }
}

export class FigmaTruncationError extends FigmaMCPError {
  constructor(toolName: string, nodeId: string) {
    super(
      `Response for node ${nodeId} was truncated (exceeded 20KB output limit). ` +
        'Use get_metadata to obtain the node map, then re-fetch specific sub-nodes.',
      toolName
    )
    this.name = 'FigmaTruncationError'
  }
}

// ── MCP Caller interface ───────────────────────────────────────────────

/**
 * Function signature for making MCP tool calls.
 * This is the injection point — in production, this delegates to the
 * Kiro power system; in tests, it's replaced with a mock.
 */
export type MCPToolCaller = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<string>

// ── Adapter interface ──────────────────────────────────────────────────

/**
 * Interface for interacting with Figma through MCP tools.
 * All methods handle error recovery, timeouts, and retries internally.
 */
export type IFigmaMCPAdapter = {
  getDesignContext(nodeId: string): Promise<FigmaDesignContext>
  getMetadata(nodeId: string): Promise<FigmaMetadata>
  getScreenshot(nodeId: string): Promise<string>
  getVariableDefs(nodeId: string): Promise<FigmaVariableCollection>
  searchDesignSystem(query: string): Promise<FigmaSearchResult[]>
  useFigma(script: string, description: string): Promise<UseFigmaResult>
}

// ── Concrete implementation ────────────────────────────────────────────

export class FigmaMCPAdapter implements IFigmaMCPAdapter {
  private readonly fileKey: string
  private readonly connectionTimeoutMs: number
  private readonly maxRetries: number
  private readonly retryDelayMs: number
  private readonly outputLimitBytes: number
  private readonly callTool: MCPToolCaller

  constructor(callTool: MCPToolCaller, options: FigmaMCPAdapterOptions) {
    this.callTool = callTool
    this.fileKey = options.fileKey
    this.connectionTimeoutMs =
      options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    this.outputLimitBytes =
      options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES
  }

  /**
   * Fetch design context for a Figma node.
   * Detects truncation when the response approaches the 20KB limit.
   */
  async getDesignContext(nodeId: string): Promise<FigmaDesignContext> {
    const content = await this.callWithRetry('get_design_context', {
      fileKey: this.fileKey,
      nodeId
    })

    const truncated = this.isLikelyTruncated(content)

    return {
      nodeId,
      content,
      truncated
    }
  }

  /**
   * Fetch metadata for a Figma node.
   * Used as a fallback when get_design_context is truncated.
   */
  async getMetadata(nodeId: string): Promise<FigmaMetadata> {
    const content = await this.callWithRetry('get_metadata', {
      fileKey: this.fileKey,
      nodeId
    })

    const nodeMap = this.parseNodeMap(content)

    return {
      nodeId,
      content,
      nodeMap
    }
  }

  /**
   * Get a screenshot of a Figma node.
   * Returns the raw screenshot data/URL as a string.
   */
  async getScreenshot(nodeId: string): Promise<string> {
    return this.callWithRetry('get_screenshot', {
      fileKey: this.fileKey,
      nodeId
    })
  }

  /**
   * Fetch variable definitions from the Figma file.
   * The nodeId parameter scopes the query to a specific node's variables.
   */
  async getVariableDefs(nodeId: string): Promise<FigmaVariableCollection> {
    const content = await this.callWithRetry('get_variable_defs', {
      fileKey: this.fileKey,
      nodeId
    })

    const collections = this.parseVariableCollections(content)

    return {
      content,
      collections
    }
  }

  /**
   * Search the Figma design system for components matching a query.
   */
  async searchDesignSystem(query: string): Promise<FigmaSearchResult[]> {
    const content = await this.callWithRetry('search_design_system', {
      fileKey: this.fileKey,
      query
    })

    return this.parseSearchResults(content)
  }

  /**
   * Execute a Figma Plugin API script via use_figma.
   * The script is JavaScript that runs in the Figma plugin context.
   */
  async useFigma(script: string, description: string): Promise<UseFigmaResult> {
    try {
      const output = await this.callWithRetry('use_figma', {
        fileKey: this.fileKey,
        script,
        description
      })

      return {
        success: true,
        output
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        output: '',
        error: message
      }
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────

  /**
   * Call an MCP tool with timeout and retry logic.
   * Retries on transient failures up to maxRetries times.
   */
  private async callWithRetry(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    let lastError: unknown

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.callWithTimeout(toolName, args)
        return result
      } catch (error) {
        lastError = error

        // Don't retry connection errors — they won't resolve on their own
        if (error instanceof FigmaConnectionError) {
          throw error
        }

        // Don't retry on the last attempt
        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelayMs)
        }
      }
    }

    throw new FigmaMCPError(
      `${toolName} failed after ${this.maxRetries + 1} attempts`,
      toolName,
      lastError
    )
  }

  /**
   * Call an MCP tool with a connection timeout.
   * Throws FigmaConnectionError if the call doesn't resolve in time.
   */
  private async callWithTimeout(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new FigmaConnectionError(toolName, this.connectionTimeoutMs))
      }, this.connectionTimeoutMs)
    })

    const callPromise = this.callTool(toolName, args)

    return Promise.race([callPromise, timeoutPromise])
  }

  /**
   * Detect whether a response is likely truncated based on size.
   * Uses a heuristic: if the byte length is within 95% of the output limit,
   * it's likely truncated.
   */
  isLikelyTruncated(content: string): boolean {
    const byteLength = new TextEncoder().encode(content).length
    const threshold = this.outputLimitBytes * 0.95
    return byteLength >= threshold
  }

  /**
   * Parse a node map from get_metadata response content.
   * Extracts node IDs and names from the metadata structure.
   */
  private parseNodeMap(content: string): Record<string, string> {
    const nodeMap: Record<string, string> = {}

    try {
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === 'object') {
        // Walk the structure looking for nodes with id and name
        this.extractNodes(parsed, nodeMap)
      }
    } catch {
      // If content isn't JSON, try to extract node references via regex
      const nodePattern = /(\d+:\d+)\s*[-–—]\s*([^\n,]+)/g
      let match: RegExpExecArray | null
      while ((match = nodePattern.exec(content)) !== null) {
        nodeMap[match[1]] = match[2].trim()
      }
    }

    return nodeMap
  }

  /**
   * Recursively extract node IDs and names from a parsed object.
   */
  private extractNodes(obj: unknown, nodeMap: Record<string, string>): void {
    if (!obj || typeof obj !== 'object') return

    const record = obj as Record<string, unknown>

    if (
      typeof record['id'] === 'string' &&
      typeof record['name'] === 'string'
    ) {
      nodeMap[record['id'] as string] = record['name'] as string
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          this.extractNodes(item, nodeMap)
        }
      } else if (value && typeof value === 'object') {
        this.extractNodes(value, nodeMap)
      }
    }
  }

  /**
   * Parse variable collections from get_variable_defs response.
   */
  private parseVariableCollections(
    content: string
  ): Record<string, FigmaVariableGroup> {
    const collections: Record<string, FigmaVariableGroup> = {}

    try {
      const parsed = JSON.parse(content)
      if (parsed && typeof parsed === 'object') {
        this.extractVariableGroups(parsed, collections)
      }
    } catch {
      // Content may not be JSON — return empty collections
      // Callers can still use the raw content string
    }

    return collections
  }

  /**
   * Extract variable groups from a parsed variable definitions object.
   */
  private extractVariableGroups(
    obj: unknown,
    collections: Record<string, FigmaVariableGroup>
  ): void {
    if (!obj || typeof obj !== 'object') return

    const record = obj as Record<string, unknown>

    // Look for collection-like structures
    if (
      typeof record['name'] === 'string' &&
      Array.isArray(record['modes']) &&
      Array.isArray(record['variables'])
    ) {
      const name = record['name'] as string
      const modes = (record['modes'] as unknown[]).map(String)
      const variables: FigmaVariable[] = []

      for (const v of record['variables'] as unknown[]) {
        if (v && typeof v === 'object') {
          const varRecord = v as Record<string, unknown>
          if (typeof varRecord['name'] === 'string') {
            const valuesByMode: Record<string, string> = {}
            if (
              varRecord['valuesByMode'] &&
              typeof varRecord['valuesByMode'] === 'object'
            ) {
              for (const [mode, val] of Object.entries(
                varRecord['valuesByMode'] as Record<string, unknown>
              )) {
                valuesByMode[mode] = String(val)
              }
            }
            variables.push({
              name: varRecord['name'] as string,
              valuesByMode
            })
          }
        }
      }

      collections[name] = { name, modes, variables }
    }

    // Recurse into nested objects
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          this.extractVariableGroups(item, collections)
        }
      } else if (value && typeof value === 'object') {
        this.extractVariableGroups(value, collections)
      }
    }
  }

  /**
   * Parse search results from search_design_system response.
   */
  private parseSearchResults(content: string): FigmaSearchResult[] {
    const results: FigmaSearchResult[] = []

    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object') {
            results.push({
              nodeId: String(item.nodeId ?? item.id ?? ''),
              name: String(item.name ?? ''),
              pageName: String(item.pageName ?? item.page ?? ''),
              description: String(item.description ?? '')
            })
          }
        }
      }
    } catch {
      // Content may not be JSON — return empty results
    }

    return results
  }

  /**
   * Delay execution for the specified number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * Create a FigmaMCPAdapter with the default file key from constants.
 * The callTool function is the injection point for the MCP caller.
 */
export function createFigmaMCPAdapter(
  callTool: MCPToolCaller,
  options?: Partial<FigmaMCPAdapterOptions>
): FigmaMCPAdapter {
  return new FigmaMCPAdapter(callTool, {
    fileKey: options?.fileKey ?? '',
    ...options
  })
}
