// MCP Server for @effinrich/figma-drift
// Exposes drift detection, sync, and story generation as MCP tools.
// Run via: npx @effinrich/figma-drift-mcp
//
// Users add to their mcp.json:
// {
//   "mcpServers": {
//     "figma-drift": {
//       "command": "npx",
//       "args": ["@effinrich/figma-drift-mcp"]
//     }
//   }
// }

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'

import {
  runDriftDetection,
  runSingleDriftDetection,
  runCodeToFigmaSync,
  runFigmaToCodeSync,
  runStoryGeneration,
  runFullPipeline,
  runTokenSync
} from './engine'
import { formatDriftReport } from './drift-detector'
import { extractManifest } from './manifest-extractor'
import { initComponentMap, loadComponentMap } from './component-map'
import { loadConfig } from './config'
import { createFigmaMCPAdapter } from './adapters/figma-mcp'
import type { MCPToolCaller } from './adapters/figma-mcp'
import type { SyncDirection } from './engine'

// ── Figma MCP Bridge ─────────────────────────────────────────────────

// The figma-drift MCP server needs to call the Figma MCP server's tools.
// In a real setup, the host IDE provides the Figma MCP connection.
// For standalone use, we create a placeholder that returns an error
// directing users to ensure the Figma MCP is connected.

function createFigmaBridge(): MCPToolCaller {
  // In production, this would be wired to the Figma MCP server.
  // For now, tools that don't need Figma (manifest extraction, story gen)
  // work standalone. Figma-dependent tools return a helpful error.
  return async (
    _toolName: string,
    _args: Record<string, unknown>
  ): Promise<string> => {
    throw new Error(
      'Figma MCP server is not connected. ' +
        'Ensure the Figma MCP server is configured alongside figma-drift in your MCP client.'
    )
  }
}

function getAdapter() {
  const config = loadConfig()
  const fileKey = config?.fileKey ?? ''
  return createFigmaMCPAdapter(createFigmaBridge(), { fileKey })
}

// ── Server Setup ─────────────────────────────────────────────────────

const server = new McpServer(
  {
    name: '@effinrich/figma-drift',
    version: '0.2.0'
  },
  {
    instructions:
      'figma-drift detects drift between React components and Figma designs, ' +
      'syncs changes in either direction, and auto-generates Storybook stories. ' +
      'Use figma_drift_detect to check for differences, figma_drift_push/pull to sync, ' +
      'and figma_drift_stories to generate test stories.'
  }
)

// ── Tools ────────────────────────────────────────────────────────────

server.registerTool(
  'figma_drift_init',
  {
    description:
      'Initialize the component map by scanning React component directories and matching to Figma components. ' +
      'Run this first before using other figma-drift tools.',
    inputSchema: z.object({})
  },
  async () => {
    try {
      const adapter = getAdapter()
      const map = await initComponentMap(adapter)
      const linked = map.entries.filter(e => e.figmaNodeId).length
      const unlinked = map.entries.length - linked
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `Component map initialized with ${map.entries.length} components.\n` +
              `Linked: ${linked}, Unlinked: ${unlinked}\n\n` +
              map.entries
                .map(
                  e =>
                    `${e.figmaNodeId ? '✓' : '?'} ${e.componentName} → ${e.figmaNodeId ?? 'unlinked'}`
                )
                .join('\n')
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }
)

server.registerTool(
  'figma_drift_detect',
  {
    description:
      'Detect drift between React components and their Figma counterparts. ' +
      'Returns a categorized report of differences (color, spacing, radius, variant, prop). ' +
      'Optionally specify a component name to check a single component.',
    inputSchema: z.object({
      componentName: z
        .string()
        .optional()
        .describe(
          'Specific component name to check. If omitted, checks all components.'
        ),
      json: z
        .boolean()
        .optional()
        .describe('Return raw JSON instead of formatted report')
    })
  },
  async ({ componentName, json }) => {
    try {
      const adapter = getAdapter()

      if (componentName) {
        const map = loadComponentMap()
        if (!map) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Component map not found. Run figma_drift_init first.'
              }
            ],
            isError: true
          }
        }
        const entry = map.entries.find(e => e.componentName === componentName)
        if (!entry) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Component "${componentName}" not found in component map.`
              }
            ],
            isError: true
          }
        }
        const drift = await runSingleDriftDetection(adapter, entry.filePath)
        return {
          content: [
            {
              type: 'text' as const,
              text: drift
                ? json
                  ? JSON.stringify(drift, null, 2)
                  : `${drift.componentName} [${drift.status}]\n` +
                    drift.differences
                      .map(d => `  ${d.type}: ${d.description}`)
                      .join('\n')
                : `No drift data for ${componentName}`
            }
          ]
        }
      }

      const report = await runDriftDetection(adapter)
      return {
        content: [
          {
            type: 'text' as const,
            text: json
              ? JSON.stringify(report, null, 2)
              : formatDriftReport(report)
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }
)

server.registerTool(
  'figma_drift_push',
  {
    description:
      'Push code changes to Figma (code → Figma sync). ' +
      'Updates the Figma component to match the React source code.',
    inputSchema: z.object({
      componentName: z
        .string()
        .describe('Name of the component to push to Figma')
    })
  },
  async ({ componentName }) => {
    try {
      const adapter = getAdapter()
      const result = await runCodeToFigmaSync(adapter, componentName)
      const icon = result.success ? '✓' : '✗'
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `${icon} ${result.componentName} [${result.direction}] — ${result.changesApplied} change(s)\n` +
              (result.errors.length > 0
                ? result.errors.map(e => `  Error: ${e}`).join('\n')
                : '')
          }
        ],
        isError: !result.success
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }
)

server.registerTool(
  'figma_drift_pull',
  {
    description:
      'Pull Figma changes into code (Figma → code sync). ' +
      'Updates the React component to match the Figma design.',
    inputSchema: z.object({
      componentName: z
        .string()
        .describe('Name of the component to pull from Figma')
    })
  },
  async ({ componentName }) => {
    try {
      const adapter = getAdapter()
      const result = await runFigmaToCodeSync(adapter, componentName)
      const icon = result.success ? '✓' : '✗'
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `${icon} ${result.componentName} [${result.direction}] — ${result.changesApplied} change(s)\n` +
              (result.errors.length > 0
                ? result.errors.map(e => `  Error: ${e}`).join('\n')
                : '')
          }
        ],
        isError: !result.success
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }
)

server.registerTool(
  'figma_drift_stories',
  {
    description:
      'Generate or update Storybook stories with interaction tests for a component. ' +
      'Stories include play functions with expect, userEvent, and within from storybook/test.',
    inputSchema: z.object({
      componentName: z
        .string()
        .describe('Name of the component to generate stories for')
    })
  },
  async ({ componentName }) => {
    try {
      const result = runStoryGeneration(componentName)
      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `✓ Story generated: ${result.storyPath}`
            }
          ]
        }
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `✗ Story generation failed: ${result.error}`
          }
        ],
        isError: true
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }
)

server.registerTool(
  'figma_drift_manifest',
  {
    description:
      'Extract a component manifest from a React source file. ' +
      'Returns variants, props, design tokens, spacing, and radius information. ' +
      'Does not require Figma connection.',
    inputSchema: z.object({
      filePath: z
        .string()
        .describe(
          'Path to the React component file (e.g., src/components/ui/button.tsx)'
        )
    })
  },
  async ({ filePath }) => {
    try {
      const manifest = extractManifest(filePath)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(manifest, null, 2)
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }
)

server.registerTool(
  'figma_drift_sync_all',
  {
    description:
      'Run the full sync pipeline: detect drift → sync in chosen direction → generate stories. ' +
      'Use --dry-run to preview without making changes.',
    inputSchema: z.object({
      direction: z
        .enum(['code-to-figma', 'figma-to-code'])
        .describe('Sync direction'),
      dryRun: z
        .boolean()
        .optional()
        .describe('Preview planned operations without executing'),
      componentName: z
        .string()
        .optional()
        .describe('Filter to a specific component')
    })
  },
  async ({ direction, dryRun, componentName }) => {
    try {
      const adapter = getAdapter()
      const result = await runFullPipeline(adapter, {
        direction: direction as SyncDirection,
        dryRun: dryRun ?? false,
        componentName
      })

      const lines: string[] = []
      lines.push(formatDriftReport(result.driftReport))

      if (dryRun) {
        lines.push('\n[DRY RUN] No changes were applied.')
      } else {
        if (result.syncResults.length > 0) {
          lines.push('\nSync Results:')
          for (const sr of result.syncResults) {
            const icon = sr.success ? '✓' : '✗'
            lines.push(
              `  ${icon} ${sr.componentName} [${sr.direction}] — ${sr.changesApplied} change(s)`
            )
          }
        }
        lines.push(
          `\nSummary: ${result.syncResults.filter(r => r.success).length} synced, ` +
            `${result.storiesGenerated} stories generated, ` +
            `${result.errors.length} errors`
        )
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }
)

server.registerTool(
  'figma_drift_tokens',
  {
    description:
      'Sync design tokens between CSS custom properties and Figma variables. ' +
      'Detects mismatches in color values between src/index.css and Figma.',
    inputSchema: z.object({
      direction: z
        .enum(['code-to-figma', 'figma-to-code'])
        .describe('Sync direction for token values')
    })
  },
  async ({ direction }) => {
    try {
      const adapter = getAdapter()
      const result = await runTokenSync(adapter, direction as SyncDirection)
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `Token sync complete: ${result.synced} token(s) synced [${direction}]\n` +
              (result.errors.length > 0
                ? result.errors.map(e => `  Error: ${e}`).join('\n')
                : '')
          }
        ],
        isError: result.errors.length > 0
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }
)

// ── Start Server ─────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('@effinrich/figma-drift MCP server running on stdio')
}

main().catch(error => {
  console.error('Failed to start MCP server:', error)
  process.exit(1)
})
