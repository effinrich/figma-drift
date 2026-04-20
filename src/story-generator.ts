// Story Generator — produces Storybook story files with interaction tests
// based on ComponentManifest data. Supports template-based generation
// and merge with existing story files.

import { readFileSync, existsSync } from 'node:fs'
import type { ComponentManifest } from './types'

export type StoryGenOptions = {
  /** Output directory for stories (e.g., 'src/stories/atoms') */
  outputDir?: string
  /** Whether to merge with existing story file */
  merge?: boolean
  /** Existing story file path (for merge mode) */
  existingStoryPath?: string
}

/**
 * Generate a Storybook story file string from a ComponentManifest.
 * Uses template-based generation following the project's conventions.
 */
export function generateStory(
  manifest: ComponentManifest,
  options: StoryGenOptions = {}
): string {
  const storyTitle = deriveStoryTitle(manifest)
  const importPath = deriveImportPath(manifest.filePath)
  const lines: string[] = []

  // Imports
  lines.push(`import type { Meta, StoryObj } from '@storybook/react-vite'`)
  lines.push(`import { expect, fn, userEvent, within } from 'storybook/test'`)
  lines.push(`import { ${manifest.componentName} } from '${importPath}'`)
  lines.push('')

  // Meta
  lines.push(`const meta: Meta<typeof ${manifest.componentName}> = {`)
  lines.push(`  title: '${storyTitle}',`)
  lines.push(`  component: ${manifest.componentName},`)
  lines.push(`  parameters: { layout: 'centered' },`)
  lines.push(`  tags: ['autodocs'],`)

  // Add onClick handler if component likely has click events
  const hasClickProp = manifest.props.some(p => p.name === 'onClick')
  const isInteractive = /button|input|link/i.test(manifest.componentName)
  if (hasClickProp || isInteractive) {
    lines.push(`  args: { onClick: fn() },`)
  }

  // ArgTypes from variants
  if (Object.keys(manifest.variants).length > 0) {
    lines.push(`  argTypes: {`)
    for (const [variantName, options] of Object.entries(manifest.variants)) {
      lines.push(`    ${variantName}: {`)
      lines.push(`      control: 'select',`)
      lines.push(`      options: [${options.map(o => `'${o}'`).join(', ')}]`)
      lines.push(`    },`)
    }
    lines.push(`  }`)
  }

  lines.push(`}`)
  lines.push('')
  lines.push(`export default meta`)
  lines.push(`type Story = StoryObj<typeof meta>`)
  lines.push('')

  // Generate Default story
  lines.push(`export const Default: Story = {`)
  lines.push(`  args: { children: '${manifest.componentName}' },`)
  lines.push(`  play: async ({ canvasElement }) => {`)
  lines.push(`    const canvas = within(canvasElement)`)

  if (isInteractive) {
    lines.push(
      `    const element = canvas.getByRole('button', { name: '${manifest.componentName}' })`
    )
  } else {
    lines.push(
      `    const element = canvas.getByText('${manifest.componentName}')`
    )
  }

  lines.push(`    await expect(element).toBeVisible()`)
  lines.push(`  }`)
  lines.push(`}`)

  // Generate one story per variant option
  for (const [variantName, options] of Object.entries(manifest.variants)) {
    for (const option of options) {
      if (option === manifest.defaultVariants[variantName]) {
        continue // Skip default — already covered by Default story
      }

      const storyName = toStoryName(option)
      lines.push('')
      lines.push(`export const ${storyName}: Story = {`)
      lines.push(
        `  args: { ${variantName}: '${option}', children: '${capitalize(option)}' },`
      )
      lines.push(`  play: async ({ canvasElement }) => {`)
      lines.push(`    const canvas = within(canvasElement)`)

      if (isInteractive) {
        lines.push(
          `    const element = canvas.getByRole('button', { name: '${capitalize(option)}' })`
        )
      } else {
        lines.push(
          `    const element = canvas.getByText('${capitalize(option)}')`
        )
      }

      lines.push(`    await expect(element).toBeVisible()`)
      lines.push(`  }`)
      lines.push(`}`)
    }
  }

  lines.push('')

  let result = lines.join('\n')

  // Merge with existing if requested
  if (
    options.merge &&
    options.existingStoryPath &&
    existsSync(options.existingStoryPath)
  ) {
    const existing = readFileSync(options.existingStoryPath, 'utf-8')
    result = mergeStories(existing, result)
  }

  return result
}

/**
 * Merge new auto-generated stories into an existing story file.
 * Preserves all manually written stories and only adds new variant stories.
 */
export function mergeStories(existing: string, generated: string): string {
  // Extract exported story names from existing file
  const existingExports = extractExportedStoryNames(existing)

  // Extract exported story names from generated file
  const generatedExports = extractExportedStoryNames(generated)

  // Find new stories that don't exist in the current file
  const newStoryNames = generatedExports.filter(
    name => !existingExports.includes(name)
  )

  if (newStoryNames.length === 0) {
    return existing // Nothing new to add
  }

  // Extract the story blocks for new stories from the generated content
  const newBlocks: string[] = []
  for (const name of newStoryNames) {
    const block = extractStoryBlock(generated, name)
    if (block) {
      newBlocks.push(block)
    }
  }

  if (newBlocks.length === 0) {
    return existing
  }

  // Append new stories to the end of the existing file
  let result = existing.trimEnd()
  result += '\n\n' + newBlocks.join('\n\n') + '\n'

  return result
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Derive the Storybook title from the component's file path.
 * Maps to atomic design levels: atoms, molecules, pages.
 */
function deriveStoryTitle(manifest: ComponentManifest): string {
  const filePath = manifest.filePath

  // Determine atomic level from file path
  let level = 'Atoms'
  if (filePath.includes('dashboard/') || filePath.includes('pages/')) {
    // Multi-component compositions are pages
    if (manifest.subComponents.length > 0) {
      level = 'Pages'
    } else {
      level = 'Molecules'
    }
  }

  return `${level}/${manifest.componentName}`
}

/**
 * Derive the import path from the component's file path.
 * Converts src/components/ui/button.tsx to @/components/ui/button
 */
function deriveImportPath(filePath: string): string {
  return filePath.replace(/^src\//, '@/').replace(/\.tsx?$/, '')
}

/**
 * Convert a variant option name to a valid Story export name.
 * e.g., "icon-xs" → "IconXs", "default" → "Default"
 */
function toStoryName(option: string): string {
  return option
    .split(/[-_\s]+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/**
 * Capitalize the first letter of a string.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Extract exported story names from a story file string.
 * Matches patterns like: export const StoryName: Story = {
 */
function extractExportedStoryNames(content: string): string[] {
  const names: string[] = []
  const pattern = /export\s+const\s+(\w+)\s*:\s*Story\b/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    names.push(match[1])
  }

  return names
}

/**
 * Extract a story block (export const Name: Story = { ... }) from content.
 */
function extractStoryBlock(content: string, storyName: string): string | null {
  const pattern = new RegExp(
    `(export\\s+const\\s+${storyName}\\s*:\\s*Story\\s*=\\s*\\{)`,
    'g'
  )
  const match = pattern.exec(content)
  if (!match) return null

  const startIndex = match.index
  let braceCount = 0
  let endIndex = startIndex

  for (let i = match.index + match[1].length - 1; i < content.length; i++) {
    if (content[i] === '{') braceCount++
    if (content[i] === '}') {
      braceCount--
      if (braceCount === 0) {
        endIndex = i + 1
        break
      }
    }
  }

  return content.slice(startIndex, endIndex)
}
