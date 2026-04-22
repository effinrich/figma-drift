// CLI entry point for bidirectional sync tooling.
// Invoked via: npx @effinrich/figma-drift <subcommand>

import {
  runDriftDetection,
  runCodeToFigmaSync,
  runFigmaToCodeSync,
  runStoryGeneration,
  runFullPipeline
} from './engine'
import { formatDriftReport } from './drift-detector'
import { initComponentMap, loadComponentMap } from './component-map'
import { logInitResult } from './sync-logger'
import { createFigmaMCPAdapter } from './adapters/figma-mcp'
import type { MCPToolCaller } from './adapters/figma-mcp'
import type { SyncDirection } from './engine'

// ── Argument parsing ─────────────────────────────────────────────────

type ParsedArgs = {
  subcommand: string
  componentName?: string
  json: boolean
  direction?: SyncDirection
  dryRun: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] = node, argv[1] = script path, argv[2+] = args
  const args = argv.slice(2)

  const result: ParsedArgs = {
    subcommand: '',
    json: false,
    dryRun: false
  }

  let i = 0

  // First non-flag argument is the subcommand
  while (i < args.length) {
    const arg = args[i]

    if (arg === '--json') {
      result.json = true
      i++
    } else if (arg === '--dry-run') {
      result.dryRun = true
      i++
    } else if (arg === '--direction') {
      i++
      const dir = args[i]
      if (dir === 'code-to-figma' || dir === 'figma-to-code') {
        result.direction = dir
      } else {
        error(
          `Invalid direction: "${dir}". Use "code-to-figma" or "figma-to-code".`
        )
      }
      i++
    } else if (arg.startsWith('--')) {
      error(`Unknown flag: ${arg}`)
      i++
    } else if (!result.subcommand) {
      result.subcommand = arg
      i++
    } else {
      // Additional positional arg = component name
      result.componentName = arg
      i++
    }
  }

  return result
}

// ── Subcommand handlers ──────────────────────────────────────────────

async function handleInit(
  adapter: ReturnType<typeof createFigmaMCPAdapter>
): Promise<void> {
  console.log('Initializing component map...')
  const map = await initComponentMap(adapter)
  logInitResult(map.entries.length, true)
  console.log(`Component map created with ${map.entries.length} components.`)

  for (const entry of map.entries) {
    const status = entry.figmaNodeId ? '✓ linked' : '? unlinked'
    console.log(
      `  ${status}  ${entry.componentName} → ${entry.figmaNodeId ?? 'none'}`
    )
  }
}

async function handleDrift(
  adapter: ReturnType<typeof createFigmaMCPAdapter>,
  args: ParsedArgs
): Promise<void> {
  const report = await runDriftDetection(adapter)

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(formatDriftReport(report))
  }
}

async function handlePush(
  adapter: ReturnType<typeof createFigmaMCPAdapter>,
  args: ParsedArgs
): Promise<void> {
  if (args.componentName) {
    const result = await runCodeToFigmaSync(adapter, args.componentName)
    printSyncResult(result)
  } else {
    // Push all drifted components
    const report = await runDriftDetection(adapter)
    const drifted = report.components.filter(c => c.status === 'drifted')

    if (drifted.length === 0) {
      console.log('All components are in sync. Nothing to push.')
      return
    }

    console.log(`Pushing ${drifted.length} drifted component(s) to Figma...`)
    for (const entry of drifted) {
      const result = await runCodeToFigmaSync(adapter, entry.componentName)
      printSyncResult(result)
    }
  }
}

async function handlePull(
  adapter: ReturnType<typeof createFigmaMCPAdapter>,
  args: ParsedArgs
): Promise<void> {
  if (args.componentName) {
    const result = await runFigmaToCodeSync(adapter, args.componentName)
    printSyncResult(result)
  } else {
    // Pull all drifted components
    const report = await runDriftDetection(adapter)
    const drifted = report.components.filter(c => c.status === 'drifted')

    if (drifted.length === 0) {
      console.log('All components are in sync. Nothing to pull.')
      return
    }

    console.log(`Pulling ${drifted.length} drifted component(s) from Figma...`)
    for (const entry of drifted) {
      const result = await runFigmaToCodeSync(adapter, entry.componentName)
      printSyncResult(result)
    }
  }
}

async function handleStories(args: ParsedArgs): Promise<void> {
  if (args.componentName) {
    const result = runStoryGeneration(args.componentName)
    if (result.success) {
      console.log(`✓ Story generated: ${result.storyPath}`)
    } else {
      error(`Story generation failed: ${result.error}`)
    }
  } else {
    // Generate stories for all components
    const map = loadComponentMap()
    if (!map) {
      error('Component map not found. Run "sync init" first.')
      return
    }

    let generated = 0
    for (const entry of map.entries) {
      const result = runStoryGeneration(entry.componentName)
      if (result.success) {
        console.log(`✓ ${entry.componentName} → ${result.storyPath}`)
        generated++
      } else {
        console.error(`✗ ${entry.componentName}: ${result.error}`)
      }
    }
    console.log(`\nGenerated ${generated} story file(s).`)
  }
}

async function handleAll(
  adapter: ReturnType<typeof createFigmaMCPAdapter>,
  args: ParsedArgs
): Promise<void> {
  console.log('Running full sync pipeline...\n')

  const result = await runFullPipeline(adapter, {
    direction: args.direction,
    dryRun: args.dryRun,
    componentName: args.componentName
  })

  // Print drift report
  console.log(formatDriftReport(result.driftReport))

  if (args.dryRun) {
    console.log('\n[DRY RUN] No changes were applied.')
    const drifted = result.driftReport.components.filter(
      c => c.status === 'drifted'
    )
    if (drifted.length > 0) {
      console.log('\nPlanned operations:')
      for (const entry of drifted) {
        const dir = args.direction ?? 'needs direction'
        console.log(
          `  ${entry.componentName}: ${entry.differences.length} change(s) [${dir}]`
        )
      }
    }
    return
  }

  // Print sync summary
  if (result.syncResults.length > 0) {
    console.log('\nSync Results:')
    for (const sr of result.syncResults) {
      const icon = sr.success ? '✓' : '✗'
      console.log(
        `  ${icon} ${sr.componentName} [${sr.direction}] — ${sr.changesApplied} change(s)`
      )
      for (const err of sr.errors) {
        console.error(`    Error: ${err}`)
      }
    }
  }

  console.log(`\nSummary:`)
  console.log(
    `  Components synced: ${result.syncResults.filter(r => r.success).length}`
  )
  console.log(`  Stories generated: ${result.storiesGenerated}`)
  if (result.errors.length > 0) {
    console.log(`  Errors: ${result.errors.length}`)
    for (const err of result.errors) {
      console.error(`    ${err}`)
    }
  }
}

// ── Utilities ────────────────────────────────────────────────────────

function printSyncResult(result: {
  success: boolean
  componentName: string
  direction: string
  changesApplied: number
  errors: string[]
}): void {
  if (result.success) {
    console.log(
      `✓ ${result.componentName} [${result.direction}] — ${result.changesApplied} change(s) applied`
    )
  } else {
    console.error(`✗ ${result.componentName} [${result.direction}] — failed`)
    for (const err of result.errors) {
      console.error(`  ${err}`)
    }
  }
}

function error(message: string): void {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function printUsage(): void {
  console.log(
    `
Usage: npx @forgekitdev/figma-drift <subcommand> [options]

Subcommands:
  init                          Generate initial Component Map
  drift [--json]                Run drift detection, print report
  push [component-name]         Code → Figma sync
  pull [component-name]         Figma → Code sync
  stories [component-name]      Generate/update Storybook stories
  all [--direction <dir>] [--dry-run]  Full orchestrator workflow

Options:
  --json                        Output as JSON (drift command)
  --direction <dir>             Sync direction: code-to-figma | figma-to-code
  --dry-run                     Print planned operations without executing
  `.trim()
  )
}

// ── Main ─────────────────────────────────────────────────────────────

/**
 * Create a placeholder MCP tool caller.
 * In production, this would be replaced with the actual Kiro power system caller.
 */
function createMCPCaller(): MCPToolCaller {
  return async (
    _toolName: string,
    _args: Record<string, unknown>
  ): Promise<string> => {
    throw new Error(
      'Figma MCP server is not connected. ' +
        'Please ensure the Figma MCP is running and connected.'
    )
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  if (!args.subcommand) {
    printUsage()
    process.exit(1)
  }

  const mcpCaller = createMCPCaller()
  const adapter = createFigmaMCPAdapter(mcpCaller)

  try {
    switch (args.subcommand) {
      case 'init':
        await handleInit(adapter)
        break
      case 'drift':
        await handleDrift(adapter, args)
        break
      case 'push':
        await handlePush(adapter, args)
        break
      case 'pull':
        await handlePull(adapter, args)
        break
      case 'stories':
        await handleStories(args)
        break
      case 'all':
        await handleAll(adapter, args)
        break
      default:
        error(
          `Unknown subcommand: "${args.subcommand}". Run without arguments to see usage.`
        )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${message}`)
    process.exit(1)
  }
}

main()
