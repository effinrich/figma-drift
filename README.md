# @forgekitdev/figma-drift

Bidirectional drift detection and sync between React components and Figma design systems.

Detects when your code and Figma components diverge, syncs changes in either direction, and auto-generates Storybook stories with interaction tests.

## Install

```bash
npm install @forgekitdev/figma-drift
```

## Setup

Create a `.figma-drift.json` in your project root:

```json
{
  "fileKey": "https://figma.com/design/YOUR_FILE_KEY/YourFile"
}
```

Or provide just the key:

```json
{
  "fileKey": "YOUR_FILE_KEY"
}
```

Or set the environment variable:

```bash
export FIGMA_DRIFT_FILE_KEY="YOUR_FILE_KEY"
```

Or add to your `package.json`:

```json
{
  "figmaDrift": {
    "fileKey": "YOUR_FILE_KEY"
  }
}
```

## CLI Usage

```bash
# Initialize component map (scans code, matches to Figma)
npx figma-drift init

# Detect drift between code and Figma
npx figma-drift drift
npx figma-drift drift --json

# Push code changes to Figma
npx figma-drift push              # all drifted components
npx figma-drift push Button       # specific component

# Pull Figma changes into code
npx figma-drift pull              # all drifted components
npx figma-drift pull Card         # specific component

# Generate Storybook stories
npx figma-drift stories           # all components
npx figma-drift stories Button    # specific component

# Full pipeline: drift → sync → stories
npx figma-drift all --direction code-to-figma
npx figma-drift all --direction figma-to-code
npx figma-drift all --dry-run     # preview without changes
```

## Programmatic API

```typescript
import {
  runDriftDetection,
  runCodeToFigmaSync,
  runFigmaToCodeSync,
  runFullPipeline,
  createFigmaMCPAdapter,
  loadConfig,
} from "@forgekitdev/figma-drift";

// Create adapter with your MCP tool caller
const adapter = createFigmaMCPAdapter(myMCPCaller, {
  fileKey: "YOUR_FILE_KEY",
});

// Detect drift
const report = await runDriftDetection(adapter);
console.log(report.summary);

// Sync a component
const result = await runCodeToFigmaSync(adapter, "Button");

// Full pipeline
const pipelineResult = await runFullPipeline(adapter, {
  direction: "code-to-figma",
});
```

## How It Works

1. **Manifest Extraction** — Parses React component source (via ts-morph) to extract variants, props, design tokens, and spacing
2. **Figma Snapshot** — Fetches component structure from Figma via MCP tools (variants, colors, layout, radius)
3. **Drift Detection** — Compares manifests vs snapshots, categorizes differences (color, spacing, radius, variant, prop)
4. **Sync** — Pushes code→Figma via `use_figma` Plugin API scripts, or pulls Figma→code via AST modification
5. **Story Generation** — Produces Storybook stories with interaction tests for synced components

## Requirements

- Node.js >= 18
- Figma MCP server connected (for Figma operations)
- React + TypeScript project with shadcn/ui or cva-based components
- Tailwind CSS for styling (token extraction)

## Configuration Resolution

File key is resolved in this priority order:

1. CLI `--file-key` flag or `--figma-url` flag
2. `.figma-drift.json` in project root
3. `"figmaDrift"` field in `package.json`
4. `FIGMA_DRIFT_FILE_KEY` environment variable

Full Figma URLs are accepted anywhere a file key is expected — the key is automatically extracted.

## License

MIT
