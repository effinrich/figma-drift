// Manifest Extractor — parses React component files using ts-morph
// to produce a ComponentManifest describing variants, props, tokens, etc.

import { Project, SyntaxKind, Node } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import type { ComponentManifest, PropDefinition } from './types'
import { extractVariants } from './variant-extractors'
import { tailwindToPx } from './value-mapping'
import { extractTokenReferencesFromClasses } from './token-sources'

/** Options controlling manifest extraction. */
export type ExtractManifestOptions = {
  /**
   * Force a specific variant extractor by name (e.g. 'cva',
   * 'tailwind-variants', 'styled-components', 'css-modules'). When omitted,
   * extractors are auto-detected in order (cva first for backward compat).
   */
  variantExtractor?: string
}

/**
 * Extract a ComponentManifest from a React component source file.
 *
 * Variant extraction is delegated to a pluggable adapter (see
 * ./variant-extractors). cva() is tried first, then tailwind-variants,
 * styled-components, and CSS Modules — so non-shadcn stacks are supported
 * without changing the ComponentManifest shape.
 */
export function extractManifest(
  filePath: string,
  options?: ExtractManifestOptions
): ComponentManifest {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
    skipAddingFilesFromTsConfig: true
  })

  const sourceFile = project.addSourceFileAtPath(filePath)
  const componentName = deriveComponentName(sourceFile)

  const { variants, defaultVariants } = extractVariants(sourceFile, {
    override: options?.variantExtractor
  })
  const props = extractProps(sourceFile)
  const allClassStrings = collectClassStrings(sourceFile)
  const tokenReferences = extractTokenReferencesFromClasses(allClassStrings)
  const spacingClasses = extractSpacingClasses(allClassStrings)
  const radiusClasses = extractRadiusClasses(allClassStrings)
  const subComponents = extractSubComponents(sourceFile, componentName)

  return {
    componentName,
    filePath,
    props,
    variants,
    defaultVariants,
    tokenReferences,
    spacingClasses,
    radiusClasses,
    subComponents
  }
}

/**
 * Derive the primary component name from the file.
 * Uses the first PascalCase-named exported function.
 */
function deriveComponentName(sourceFile: SourceFile): string {
  // Check for exported functions first
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName()
    if (name && /^[A-Z]/.test(name) && fn.isExported()) {
      return name
    }
  }

  // Check export declarations (e.g., `export { Button, buttonVariants }`)
  for (const exportDecl of sourceFile.getExportDeclarations()) {
    for (const namedExport of exportDecl.getNamedExports()) {
      const name = namedExport.getName()
      if (/^[A-Z]/.test(name)) {
        return name
      }
    }
  }

  // Fallback: derive from filename
  const baseName = sourceFile.getBaseNameWithoutExtension()
  return baseName.charAt(0).toUpperCase() + baseName.slice(1)
}

/**
 * Extract prop definitions from the component function's parameter type.
 *
 * Handles patterns:
 * - Destructured params with inline type: `({ className, variant }: Props & OtherType)`
 * - Interface-based props: `(props: StatCardProps)`
 * - React.ComponentProps intersection: `React.ComponentProps<"div"> & { size?: ... }`
 */
function extractProps(sourceFile: SourceFile): PropDefinition[] {
  const props: PropDefinition[] = []
  const seenNames = new Set<string>()

  // Find the primary component function (first PascalCase exported function)
  const componentFn = findPrimaryComponentFunction(sourceFile)
  if (!componentFn) {
    return props
  }

  const params = componentFn.getParameters()
  if (params.length === 0) {
    return props
  }

  const firstParam = params[0]
  const typeNode = firstParam.getTypeNode()

  if (typeNode) {
    extractPropsFromTypeNode(typeNode, sourceFile, props, seenNames)
  }

  // Also check for destructured parameter bindings to find prop names
  const bindingPattern = firstParam.getNameNode()
  if (Node.isObjectBindingPattern(bindingPattern)) {
    for (const element of bindingPattern.getElements()) {
      const name = element.getName()
      // Skip common React internals
      if (name === 'className' || name === 'props' || name === 'children')
        continue
      // Skip spread rest (...props)
      if (element.getDotDotDotToken()) continue

      if (!seenNames.has(name)) {
        seenNames.add(name)

        // Try to determine type and optionality from the initializer or type
        const initializer = element.getInitializer()
        const hasDefault = initializer !== undefined

        props.push({
          name,
          type: 'string', // Default; refined below if type info available
          required: !hasDefault,
          ...(hasDefault ? { defaultValue: initializer!.getText() } : {})
        })
      }
    }
  }

  return props
}

/**
 * Find the primary component function — the first PascalCase-named function
 * that is exported (either directly or via an export declaration).
 */
function findPrimaryComponentFunction(sourceFile: SourceFile) {
  // Collect names from export declarations
  const exportedNames = new Set<string>()
  for (const exportDecl of sourceFile.getExportDeclarations()) {
    for (const namedExport of exportDecl.getNamedExports()) {
      exportedNames.add(namedExport.getName())
    }
  }

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName()
    if (!name || !/^[A-Z]/.test(name)) continue
    if (fn.isExported() || exportedNames.has(name)) {
      return fn
    }
  }

  return undefined
}

/**
 * Extract props from a TypeScript type node.
 * Handles intersection types, type references, and inline object types.
 */
function extractPropsFromTypeNode(
  typeNode: Node,
  sourceFile: SourceFile,
  props: PropDefinition[],
  seenNames: Set<string>
): void {
  if (Node.isIntersectionTypeNode(typeNode)) {
    // Handle `TypeA & TypeB & { ... }`
    for (const member of typeNode.getTypeNodes()) {
      extractPropsFromTypeNode(member, sourceFile, props, seenNames)
    }
  } else if (Node.isTypeLiteral(typeNode)) {
    // Handle inline `{ size?: "default" | "sm" }`
    for (const member of typeNode.getMembers()) {
      if (Node.isPropertySignature(member)) {
        const name = member.getName()
        if (name === 'className' || name === 'children') continue
        if (seenNames.has(name)) continue
        seenNames.add(name)

        const memberTypeNode = member.getTypeNode()
        const typeText = memberTypeNode ? memberTypeNode.getText() : 'unknown'
        const isOptional = member.hasQuestionToken()

        props.push({
          name,
          type: typeText,
          required: !isOptional
        })
      }
    }
  } else if (Node.isTypeReference(typeNode)) {
    // Handle named type references like `StatCardProps`, `VariantProps<...>`
    const typeName = typeNode.getTypeName().getText()

    // Skip common React/library types that don't contribute meaningful props
    if (
      typeName === 'VariantProps' ||
      typeName.includes('ComponentProps') ||
      (typeName.includes('Props') && typeName.includes('.'))
    ) {
      return
    }

    // Try to resolve the type in the same file
    const typeAlias = sourceFile.getTypeAlias(typeName)
    if (typeAlias) {
      const resolved = typeAlias.getTypeNode()
      if (resolved) {
        extractPropsFromTypeNode(resolved, sourceFile, props, seenNames)
      }
      return
    }

    const iface = sourceFile.getInterface(typeName)
    if (iface) {
      for (const member of iface.getMembers()) {
        if (Node.isPropertySignature(member)) {
          const name = member.getName()
          if (name === 'className' || name === 'children') continue
          if (seenNames.has(name)) continue
          seenNames.add(name)

          const memberTypeNode = member.getTypeNode()
          const typeText = memberTypeNode ? memberTypeNode.getText() : 'unknown'
          const isOptional = member.hasQuestionToken()

          props.push({
            name,
            type: typeText,
            required: !isOptional
          })
        }
      }
    }
  }
}

/**
 * Collect all string literals and template literal strings from the source file.
 * These are scanned for Tailwind class references.
 */
function collectClassStrings(sourceFile: SourceFile): string[] {
  const strings: string[] = []

  // String literals
  for (const literal of sourceFile.getDescendantsOfKind(
    SyntaxKind.StringLiteral
  )) {
    strings.push(literal.getLiteralValue())
  }

  // Template literals (no-substitution and template expressions)
  for (const template of sourceFile.getDescendantsOfKind(
    SyntaxKind.NoSubstitutionTemplateLiteral
  )) {
    strings.push(template.getLiteralText())
  }

  for (const template of sourceFile.getDescendantsOfKind(
    SyntaxKind.TemplateExpression
  )) {
    // Collect the head and each span's literal text
    const head = template.getHead()
    strings.push(head.getLiteralText())
    for (const span of template.getTemplateSpans()) {
      strings.push(span.getLiteral().getLiteralText())
    }
  }

  return strings
}

/**
 * Extract spacing classes that resolve to a pixel value — either via the
 * spacing map or Tailwind arbitrary-value syntax (e.g. `p-[13px]`).
 */
function extractSpacingClasses(classStrings: string[]): string[] {
  const classes = new Set<string>()
  const spacingPattern =
    /(?:^|\s)((?:gap-x|gap-y|gap|px|py|pt|pr|pb|pl|p|mx|my|m)-(?:\[[^\]]+\]|[\w.]+))/g
  const fullText = classStrings.join(' ')

  let match: RegExpExecArray | null
  while ((match = spacingPattern.exec(fullText)) !== null) {
    const cls = match[1]
    if (tailwindToPx(cls) !== undefined) {
      classes.add(cls)
    }
  }

  return Array.from(classes).sort()
}

/**
 * Extract radius classes that resolve to a pixel value — either via the
 * radius map or Tailwind arbitrary-value syntax (e.g. `rounded-[6px]`).
 */
function extractRadiusClasses(classStrings: string[]): string[] {
  const classes = new Set<string>()
  const radiusPattern = /(?:^|\s)(rounded(?:-(?:\[[^\]]+\]|[\w]+))?)/g
  const fullText = classStrings.join(' ')

  let match: RegExpExecArray | null
  while ((match = radiusPattern.exec(fullText)) !== null) {
    const cls = match[1]
    if (tailwindToPx(cls) !== undefined) {
      classes.add(cls)
    }
  }

  return Array.from(classes).sort()
}

/**
 * Detect sub-components exported from the same file.
 * Returns names of other exported PascalCase functions besides the primary component.
 */
function extractSubComponents(
  sourceFile: SourceFile,
  primaryName: string
): string[] {
  const subComponents: string[] = []

  // Collect all exported names from export declarations
  const exportedNames = new Set<string>()
  for (const exportDecl of sourceFile.getExportDeclarations()) {
    for (const namedExport of exportDecl.getNamedExports()) {
      exportedNames.add(namedExport.getName())
    }
  }

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName()
    if (!name || name === primaryName) continue
    if (!/^[A-Z]/.test(name)) continue
    if (fn.isExported() || exportedNames.has(name)) {
      subComponents.push(name)
    }
  }

  return subComponents.sort()
}
