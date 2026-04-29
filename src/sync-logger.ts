// Sync Logger — appends structured log entries to .kiro/sync/sync.log

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadConfig, CONFIG_DEFAULTS } from './config'

function getLogPath(): string {
  return loadConfig()?.syncLogPath ?? CONFIG_DEFAULTS.syncLogPath
}

export type LogType = 'SYNC' | 'STORY' | 'DRIFT' | 'TOKEN' | 'INIT'

export type LogEntry = {
  type: LogType
  component?: string
  direction?: 'code-to-figma' | 'figma-to-code'
  result: 'success' | 'error'
  error?: string
  /** Additional key-value pairs for the log line */
  extra?: Record<string, string | number>
}

/**
 * Append a structured log entry to the sync log file.
 * Format: [ISO8601] TYPE component=Name direction=dir result=status error="details"
 */
export function logSync(entry: LogEntry): void {
  const timestamp = new Date().toISOString()
  const parts: string[] = [`[${timestamp}]`, entry.type]

  if (entry.component) {
    parts.push(`component=${entry.component}`)
  }

  if (entry.direction) {
    parts.push(`direction=${entry.direction}`)
  }

  parts.push(`result=${entry.result}`)

  if (entry.error) {
    parts.push(`error="${entry.error}"`)
  }

  if (entry.extra) {
    for (const [key, value] of Object.entries(entry.extra)) {
      parts.push(`${key}=${value}`)
    }
  }

  const line = parts.join(' ') + '\n'

  ensureLogDir()
  appendFileSync(getLogPath(), line, 'utf-8')
}

/**
 * Log a sync operation result.
 */
export function logSyncResult(
  component: string,
  direction: 'code-to-figma' | 'figma-to-code',
  success: boolean,
  error?: string
): void {
  logSync({
    type: 'SYNC',
    component,
    direction,
    result: success ? 'success' : 'error',
    error
  })
}

/**
 * Log a story generation result.
 */
export function logStoryResult(
  component: string,
  success: boolean,
  path?: string,
  error?: string
): void {
  logSync({
    type: 'STORY',
    component,
    result: success ? 'success' : 'error',
    error,
    extra: path ? { path } : undefined
  })
}

/**
 * Log a drift detection result.
 */
export function logDriftResult(summary: {
  totalComponents: number
  inSync: number
  drifted: number
  unlinked: number
}): void {
  logSync({
    type: 'DRIFT',
    result: 'success',
    extra: {
      components: summary.totalComponents,
      'in-sync': summary.inSync,
      drifted: summary.drifted,
      unlinked: summary.unlinked
    }
  })
}

/**
 * Log a token sync result.
 */
export function logTokenResult(
  tokenName: string,
  direction: 'code-to-figma' | 'figma-to-code',
  success: boolean,
  error?: string
): void {
  logSync({
    type: 'TOKEN',
    component: tokenName,
    direction,
    result: success ? 'success' : 'error',
    error
  })
}

/**
 * Log an init operation result.
 */
export function logInitResult(
  componentCount: number,
  success: boolean,
  error?: string
): void {
  logSync({
    type: 'INIT',
    result: success ? 'success' : 'error',
    error,
    extra: { components: componentCount }
  })
}

/**
 * Get the path to the sync log file.
 */
export function getSyncLogPath(): string {
  return getLogPath()
}

// ── Internal helpers ─────────────────────────────────────────────────

function ensureLogDir(): void {
  const dir = dirname(getLogPath())
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
