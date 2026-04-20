// Figma-to-Code Syncer — modifies React source files based on
// Figma changes using ts-morph for AST manipulation.

import { Project, SyntaxKind, Node } from 'ts-morph'
import type { DriftEntry, Difference, SyncResult } from './types'
import { pxToTailwind } from './value-mapping'

/**
 * Sync Figma changes to code for a single component.
 * Uses ts-morph to modify the component's AST directly.
 */
export async function syncFigmaToCode(drift: DriftEntry): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    componentName: drift.componentName,
    direction: 'figma-to-code',
    changesApplied: 0,
    errors: []
  }

  if (drift.differences.length === 0) {
    return result // Nothing to sync
  }

  // Check for hardcoded hex colors that need user resolution
  const hardcodedColors = drift.differences.filter(
    d =>
      d.type === 'color' && d.figmaValue && !d.figmaValue.startsWith('token:')
  )
  if (hardcodedColors.length > 0) {
    for (const hc of hardcodedColors) {
      result.errors.push(
        `Hardcoded hex color ${hc.figmaValue} at ${hc.propertyPath} — resolve to a token before applying`
      )
    }
  }

  try {
    const project = new Project({
      tsConfigFilePath: 'tsconfig.app.json',
      skipAddingFilesFromTsConfig: true
    })

    const sourceFile = project.addSourceFileAtPath(drift.filePath)
    let modified = false

    // Process variant changes
    const variantDiffs = drift.differences.filter(d => d.type === 'variant')
    if (variantDiffs.length > 0) {
      const changed = applyVariantChanges(sourceFile, variantDiffs)
      if (changed) {
        modified = true
        result.changesApplied += variantDiffs.length
      }
    }

    // Process color changes
    const colorDiffs = drift.differences.filter(
      d => d.type === 'color' && d.figmaValue?.startsWith('token:')
    )
    if (colorDiffs.length > 0) {
      const changed = applyColorChanges(sourceFile, colorDiffs)
      if (changed) {
        modified = true
        result.changesApplied += colorDiffs.length
      }
    }

    // Process spacing changes
    const spacingDiffs = drift.differences.filter(d => d.type === 'spacing')
    if (spacingDiffs.length > 0) {
      const changed = applySpacingChanges(sourceFile, spacingDiffs)
      if (changed) {
        modified = true
        result.changesApplied += spacingDiffs.length
      }
    }

    // Process radius changes
    const radiusDiffs = drift.differences.filter(d => d.type === 'radius')
    if (radiusDiffs.length > 0) {
      const changed = applyRadiusChanges(sourceFile, radiusDiffs)
      if (changed) {
        modified = true
        result.changesApplied += radiusDiffs.length
      }
    }

    if (modified) {
      sourceFile.saveSync()
    }

    result.success = result.errors.length === 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.success = false
    result.errors.push(`File modification failed: ${message}`)
  }

  return result
}

// ── Change appliers ──────────────────────────────────────────────────

/**
 * Apply variant changes to the source file's cva() call.
 * Adds new variant options that exist in Figma but not in code.
 */
function applyVariantChanges(
  sourceFile: ReturnType<Project['addSourceFileAtPath']>,
  diffs: Difference[]
): boolean {
  let changed = false

  // Find the cva() call
  const cvaCall = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find(call => call.getExpression().getText() === 'cva')

  if (!cvaCall) return false

  const args = cvaCall.getArguments()
  if (args.length < 2) return false

  const configArg = args[1]
  if (!Node.isObjectLiteralExpression(configArg)) return false

  const variantsProp = configArg.getProperty('variants')
  if (!variantsProp || !Node.isPropertyAssignment(variantsProp)) return false

  const variantsObj = variantsProp.getInitializer()
  if (!variantsObj || !Node.isObjectLiteralExpression(variantsObj)) return false

  for (const diff of diffs) {
    // Only handle additions from Figma (figmaValue present, codeValue null)
    if (diff.figmaValue === null || diff.codeValue !== null) continue

    const parts = diff.propertyPath.split('.')
    const variantName = parts[1]
    const optionValue = parts[2] ?? diff.figmaValue

    if (!variantName || !optionValue) continue

    // Find or create the variant group
    const variantGroup = variantsObj.getProperty(variantName)
    if (variantGroup && Node.isPropertyAssignment(variantGroup)) {
      const optionsObj = variantGroup.getInitializer()
      if (optionsObj && Node.isObjectLiteralExpression(optionsObj)) {
        // Check if option already exists
        const existing = optionsObj.getProperty(optionValue)
        if (!existing) {
          // Add new option with empty class string
          optionsObj.addPropertyAssignment({
            name: /^[a-zA-Z_$][\w$]*$/.test(optionValue)
              ? optionValue
              : `"${optionValue}"`,
            initializer: '""'
          })
          changed = true
        }
      }
    }
  }

  return changed
}

/**
 * Apply color token changes by replacing Tailwind class strings.
 */
function applyColorChanges(
  sourceFile: ReturnType<Project['addSourceFileAtPath']>,
  diffs: Difference[]
): boolean {
  let changed = false

  for (const diff of diffs) {
    if (!diff.figmaValue || !diff.codeValue) continue

    const newToken = diff.figmaValue.replace('token:', '')
    const oldToken = diff.codeValue.replace('token:', '')

    if (newToken === oldToken) continue

    // Find and replace in string literals
    const stringLiterals = sourceFile.getDescendantsOfKind(
      SyntaxKind.StringLiteral
    )
    for (const literal of stringLiterals) {
      const text = literal.getLiteralValue()
      // Replace token references in Tailwind classes
      const patterns = [
        `bg-${oldToken}`,
        `text-${oldToken}`,
        `border-${oldToken}`,
        `ring-${oldToken}`,
        `fill-${oldToken}`,
        `stroke-${oldToken}`
      ]

      let newText = text
      for (const pattern of patterns) {
        const replacement = pattern.replace(oldToken, newToken)
        newText = newText.replace(pattern, replacement)
      }

      if (newText !== text) {
        literal.setLiteralValue(newText)
        changed = true
      }
    }
  }

  return changed
}

/**
 * Apply spacing changes by replacing Tailwind spacing classes.
 */
function applySpacingChanges(
  sourceFile: ReturnType<Project['addSourceFileAtPath']>,
  diffs: Difference[]
): boolean {
  let changed = false

  for (const diff of diffs) {
    if (!diff.figmaValue || !diff.codeValue) continue

    // Extract old class name from codeValue like "gap-4 (16px)"
    const oldClassMatch = diff.codeValue.match(/^([\w.-]+)/)
    if (!oldClassMatch) continue
    const oldClass = oldClassMatch[1]

    // Extract new pixel value from figmaValue like "24px"
    const newPxMatch = diff.figmaValue.match(/^(\d+)px$/)
    if (!newPxMatch) continue
    const newPx = parseInt(newPxMatch[1], 10)

    // Determine the type (spacing or radius) based on the class prefix
    const newClass = pxToTailwind(newPx, 'spacing')
    if (!newClass) continue

    // Replace in string literals
    const stringLiterals = sourceFile.getDescendantsOfKind(
      SyntaxKind.StringLiteral
    )
    for (const literal of stringLiterals) {
      const text = literal.getLiteralValue()
      if (text.includes(oldClass)) {
        const newText = text.replace(
          new RegExp(`\\b${escapeRegex(oldClass)}\\b`, 'g'),
          newClass
        )
        if (newText !== text) {
          literal.setLiteralValue(newText)
          changed = true
        }
      }
    }
  }

  return changed
}

/**
 * Apply radius changes by replacing Tailwind radius classes.
 */
function applyRadiusChanges(
  sourceFile: ReturnType<Project['addSourceFileAtPath']>,
  diffs: Difference[]
): boolean {
  let changed = false

  for (const diff of diffs) {
    if (!diff.figmaValue || !diff.codeValue) continue

    // Extract old class name
    const oldClassMatch = diff.codeValue.match(/^([\w-]+)/)
    if (!oldClassMatch) continue
    const oldClass = oldClassMatch[1]

    // Extract new pixel value
    const newPxMatch = diff.figmaValue.match(/^(\d+)px$/)
    if (!newPxMatch) continue
    const newPx = parseInt(newPxMatch[1], 10)

    const newClass = pxToTailwind(newPx, 'radius')
    if (!newClass) continue

    // Replace in string literals
    const stringLiterals = sourceFile.getDescendantsOfKind(
      SyntaxKind.StringLiteral
    )
    for (const literal of stringLiterals) {
      const text = literal.getLiteralValue()
      if (text.includes(oldClass)) {
        const newText = text.replace(
          new RegExp(`\\b${escapeRegex(oldClass)}\\b`, 'g'),
          newClass
        )
        if (newText !== text) {
          literal.setLiteralValue(newText)
          changed = true
        }
      }
    }
  }

  return changed
}

// ── Utilities ────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
