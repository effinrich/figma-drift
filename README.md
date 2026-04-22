# @forgekitdev/figma-drift

Bidirectional drift detection and sync between React components and Figma design systems.

Detects when your code and Figma components diverge, syncs changes in either direction, and auto-generates Storybook stories with interaction tests.

## What It Does

Most Figma tools are one-way — they generate code from designs. **figma-drift** keeps both sides in sync:

- **Extracts component structure from React code** — variants, props, design tokens, spacing (via ts-morph AST parsing)
- **Extracts component structure from Figma** — variants, color bindings, auto-layout, corner radius (via Figma MCP server)
- **Detects drift** — categorized differences: color, spacing, radius, variant, prop
- **Syncs in either direction** — push code changes to Figma canvas, or pull Figma changes into code
- **Auto-generates Storybook stories** — with interaction tests on every sync
- **Manages design token parity** — between CSS custom properties (OKLCH) and Figma variables (RGB)

## Prerequisites

### Figma MCP Server

figma-drift communicates with Figma through the [Figma MCP server](https://github.com/figma/mcp-server-guide). You need it connected to your IDE/MCP client.

**Quick setup** — add to your MCP config (VS Code, Cursor, Kiro, etc.):

```json
{
  "mcpServers": {
    "figma": {
      "url": "https://mcp.figma.com/mcp"
    }
  }
}
```

**Rate limits:**
- Starter / View / Collab seats: 6 tool calls per month
- Dev or Full seats on Professional, Organization, or Enterprise plans: per-minute limits (Tier 1 REST API)

**Write to canvas** (`use_figma`) is free during the beta period and will eventually become a usage-based paid feature. A Full seat is required for write operations; Dev seats are read-only.

### Project Requirements

- Node.js >= 18
- React + TypeScript project
- Components using [class-variance-authority](https://cva.style/) (cva) for variants — standard with [shadcn/ui](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/) for styling and design token extraction
- Design tokens as CSS custom properties in your stylesheet (OKLCH or hex)

### Optional

- [Storybook](https://storybook.js.org/) >= 8.0 — for auto-generated story files with interaction tests

## Install

```bash
npm install @forgekitdev/figma-drift
```

## Setup

### 1. Configure your Figma file key

Create a `.figma-drift.json` in your project root:

```json
{
  "fileKey": "YOUR_FILE_KEY"
}
```

You can also provide a full Figma URL — the file key is extracted automatically:

```json
{
  "fileKey": "https://figma.com/design/YOUR_FILE_KEY/YourFile"
}
```

**Alternative configuration methods** (resolved in priority order):

1. `.figma-drift.json` in project root
2. `"figmaDrift"` field in `package.json`
3. `FIGMA_DRIFT_FILE_KEY` environment variable

```bash
# Environment variable
export FIGMA_DRIFT_FILE_KEY="YOUR_FILE_KEY"
```

```json
// package.json
{
  "figmaDrift": {
    "fileKey": "YOUR_FILE_KEY"
  }
}
```

### 2. Initialize the component map

```bash
npx @forgekitdev/figma-drift init
```

This scans `src/components/ui/` and `src/components/dashboard/` for React components, then matches them to Figma components via `search_design_system`. The resulting map is saved to `.kiro/sync/component-map.json`.

## CLI Usage

```bash
# Initialize component map (scans code, matches to Figma)
npx @forgekitdev/figma-drift init

# Detect drift between code and Figma
npx @forgekitdev/figma-drift drift
npx @forgekitdev/figma-drift drift --json

# Push code changes to Figma
npx @forgekitdev/figma-drift push              # all drifted components
npx @forgekitdev/figma-drift push Button       # specific component

# Pull Figma changes into code
npx @forgekitdev/figma-drift pull              # all drifted components
npx @forgekitdev/figma-drift pull Card         # specific component

# Generate Storybook stories
npx @forgekitdev/figma-drift stories           # all components
npx @forgekitdev/figma-drift stories Button    # specific component

# Full pipeline: drift → sync → stories
npx @forgekitdev/figma-drift all --direction code-to-figma
npx @forgekitdev/figma-drift all --direction figma-to-code
npx @forgekitdev/figma-drift all --dry-run     # preview without changes
```

## Programmatic API

```typescript
import {
  runDriftDetection,
  runCodeToFigmaSync,
  runFigmaToCodeSync,
  runFullPipeline,
  createFigmaMCPAdapter,
  formatDriftReport,
} from "@forgekitdev/figma-drift";
import type { MCPToolCaller } from "@forgekitdev/figma-drift";

// Create an MCP tool caller (this is the bridge to your MCP client)
const myMCPCaller: MCPToolCaller = async (toolName, args) => {
  // Your MCP client integration here
  // Returns the raw string response from the Figma MCP tool
};

// Create adapter
const adapter = createFigmaMCPAdapter(myMCPCaller, {
  fileKey: "YOUR_FILE_KEY",
});

// Detect drift
const report = await runDriftDetection(adapter);
console.log(formatDriftReport(report));
// → Components: 14 total, 11 in-sync, 2 drifted, 1 unlinked

// Sync a specific component to Figma
const result = await runCodeToFigmaSync(adapter, "Button");
console.log(result);
// → { success: true, componentName: "Button", direction: "code-to-figma", changesApplied: 3 }

// Pull Figma changes into code
const pullResult = await runFigmaToCodeSync(adapter, "Card");

// Full pipeline
const pipelineResult = await runFullPipeline(adapter, {
  direction: "code-to-figma",
  dryRun: false,
});
```

## How It Works

### Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  React Code  │────▶│  Manifest    │────▶│                 │
│  (ts-morph)  │     │  Extractor   │     │  Drift Detector │──▶ Drift Report
│              │     └──────────────┘     │                 │
└──────────────┘                          └────────┬────────┘
                                                   │
┌─────────────┐     ┌──────────────┐              │
│  Figma File  │────▶│  Snapshot    │──────────────┘
│  (MCP tools) │     │  Extractor   │
│              │     └──────────────┘
└──────────────┘
        │                                  ┌─────────────────┐
        │◀─────────────────────────────────│ Code→Figma Sync │
        │                                  │ (use_figma API) │
        │                                  └─────────────────┘
        │
        │──────────────────────────────────▶┌─────────────────┐
                                            │ Figma→Code Sync │
                                            │ (AST rewrite)   │
                                            └─────────────────┘
```

### Pipeline Steps

1. **Manifest Extraction** — Parses React component source via ts-morph to extract cva variants, TypeScript props, Tailwind token references, spacing classes, and radius classes
2. **Figma Snapshot** — Fetches component structure from Figma via `get_design_context`, extracts variant properties, color bindings (token-bound or hardcoded), auto-layout spacing, and corner radius
3. **Drift Detection** — Compares manifests vs snapshots, produces a categorized report:
   - `color` — token mismatch or hardcoded vs token-bound
   - `spacing` — gap, padding, or item-spacing mismatch
   - `radius` — corner radius mismatch
   - `variant` — variant exists in code but not Figma, or vice versa
   - `prop` — prop exists in code but not mapped in Figma
4. **Sync** — Code→Figma generates chunked `use_figma` Plugin API scripts (respecting the 20KB output limit). Figma→Code modifies the component AST via ts-morph.
5. **Story Generation** — Produces Storybook stories with `play` functions using `expect`, `within`, `userEvent` from `storybook/test`

### Design Token Sync

figma-drift also syncs design tokens between CSS custom properties and Figma variables:

- Parses `:root` and `.dark` blocks from your CSS for OKLCH token values
- Fetches Figma variable definitions via `get_variable_defs`
- Normalizes both to hex for comparison (using [culori](https://culorijs.org/) for OKLCH→sRGB conversion)
- Syncs in either direction: update Figma variables from CSS, or update CSS from Figma

### Figma MCP Tools Used

| Tool | Purpose |
|------|---------|
| `get_design_context` | Fetch structured design data for a component |
| `get_metadata` | Fallback for large components (>20KB) — get node map first |
| `get_screenshot` | Visual reference for validation |
| `get_variable_defs` | Fetch design token variable definitions |
| `search_design_system` | Match code components to Figma components |
| `use_figma` | Write changes to Figma canvas via Plugin API |

## Component Map

The component map (`.kiro/sync/component-map.json`) links each React component file to its Figma counterpart:

```json
{
  "version": 1,
  "figmaFileKey": "YOUR_FILE_KEY",
  "entries": [
    {
      "filePath": "src/components/ui/button.tsx",
      "figmaNodeId": "17:14",
      "figmaPageName": "Atoms",
      "componentName": "Button",
      "lastSyncedAt": "2025-01-15T10:30:00.000Z",
      "lastSyncDirection": "code-to-figma"
    }
  ]
}
```

## Sync Logging

All operations are logged to `.kiro/sync/sync.log`:

```
[2025-01-15T10:30:00.000Z] SYNC component=Button direction=code-to-figma result=success
[2025-01-15T10:30:01.000Z] STORY component=Button result=success path=src/stories/atoms/Button.stories.tsx
[2025-01-15T10:30:02.000Z] DRIFT components=14 in-sync=11 drifted=2 unlinked=1
```

## Kiro Hook Integration

If you're using [Kiro](https://kiro.dev), figma-drift provides hooks for automatic sync:

- **component-drift-check** — `fileEdited` on component files → auto drift detection
- **full-drift-scan** — `userTriggered` → full drift scan across all components
- **figma-pull** — `userTriggered` → pull Figma changes into code
- **post-sync-stories** — `postTaskExecution` → auto-generate stories after sync

## Limitations

- **20KB output limit** per `use_figma` call — large operations are automatically chunked
- **No image support** in `use_figma` yet — images use placeholder rectangles
- **No custom fonts** in Figma write operations — Inter is used as fallback
- **Code Connect** requires Organization or Enterprise Figma plan — figma-drift uses component descriptions as metadata on Pro plans
- **cva-based components** — the manifest extractor is optimized for class-variance-authority patterns (shadcn/ui, Radix UI)

## License

MIT
