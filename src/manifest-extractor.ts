// Manifest Extractor — parses React component files using ts-morph
// to produce a ComponentManifest describing variants, props, tokens, etc.

import { Project, SyntaxKind, Node } from 'ts-morph'
import type {
  CallExpression,
  ObjectLiteralExpression,
  SourceFile
} from 'ts-morph'
import type { ComponentManifest, PropDefinition } from './types'
import { TOKEN_PATTERN, SPACING_MAP, RADIUS_MAP } from './constants'

/**
 * Extract a ComponentManifest from a React component source file.
 *
 * Handles four patterns:
 * 1. Components with cva() variants (button.tsx, badge.tsx)
 * 2. Components with multiple sub-component exports (card.tsx)
 * 3. Components with custom prop interfaces (StatCard.tsx)
 * 4. Components with no cva() and simple props
 */
export function extractManifest(filePath: string): ComponentManifest {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
    skipAddingFilesFromTsConfig: true
  })

  const sourceFile = project.addSourceFileAtPath(filePath)
  const componentName = deriveComponentName(sourceFile)

  const { variants, defaultVariants } = extractCvaData(sourceFile)
  const props = extractProps(sourceFile)
  const allClassStrings = collectClassStrings(sourceFile)
  const tokenReferences = extractTokenReferences(allClassStrings)
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
 * Find cva() call expressions and extract variants + defaultVariants.
 */
function extractCvaData(sourceFile: SourceFile): {
  variants: Record<string, string[]>
  defaultVariants: Record<string, string>
} {
  const variants: Record<string, string[]> = {}
  const defaultVariants: Record<string, string> = {}

  const cvaCall = findCvaCall(sourceFile)
  if (!cvaCall) {
    return { variants, defaultVariants }
  }

  const args = cvaCall.getArguments()
  // cva(baseClasses, config) — config is the second argument
  if (args.length < 2) {
    return { variants, defaultVariants }
  }

  const configArg = args[1]
  if (!Node.isObjectLiteralExpression(configArg)) {
    return { variants, defaultVariants }
  }

  // Extract variants
  const variantsProp = configArg.getProperty('variants')
  if (variantsProp && Node.isPropertyAssignment(variantsProp)) {
    const variantsObj = variantsProp.getInitializer()
    if (variantsObj && Node.isObjectLiteralExpression(variantsObj)) {
      extractVariantKeys(variantsObj, variants)
    }
  }

  // Extract defaultVariants
  const defaultVariantsProp = configArg.getProperty('defaultVariants')
  if (defaultVariantsProp && Node.isPropertyAssignment(defaultVariantsProp)) {
    const defaultObj = defaultVariantsProp.getInitializer()
    if (defaultObj && Node.isObjectLiteralExpression(defaultObj)) {
      for (const prop of defaultObj.getProperties()) {
        if (Node.isPropertyAssignment(prop)) {
          const key = prop.getName()
          const init = prop.getInitializer()
          if (init) {
            // Remove quotes from string literals
            const value = init.getText().replace(/^["']|["']$/g, '')
            defaultVariants[key] = value
          }
        }
      }
    }
  }

  return { variants, defaultVariants }
}

/**
 * Find the cva() call expression in the source file.
 */
function findCvaCall(sourceFile: SourceFile): CallExpression | undefined {
  const callExpressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression
  )
  return callExpressions.find(call => {
    const expr = call.getExpression()
    return expr.getText() === 'cva'
  })
}

/**
 * Extract variant names and their option keys from a variants object literal.
 */
function extractVariantKeys(
  variantsObj: ObjectLiteralExpression,
  variants: Record<string, string[]>
): void {
  for (const prop of variantsObj.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const variantName = prop.getName()
      const optionsObj = prop.getInitializer()
      if (optionsObj && Node.isObjectLiteralExpression(optionsObj)) {
        const optionKeys: string[] = []
        for (const optionProp of optionsObj.getProperties()) {
          if (Node.isPropertyAssignment(optionProp)) {
            const key = optionProp.getName()
            // Remove quotes from computed property names like "icon-xs"
            optionKeys.push(key.replace(/^["']|["']$/g, ''))
          }
        }
        variants[variantName] = optionKeys
      }
    }
  }
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
 * Extract design token references from class strings using TOKEN_PATTERN.
 * Returns deduplicated token names.
 */
function extractTokenReferences(classStrings: string[]): string[] {
  const tokens = new Set<string>()
  const fullText = classStrings.join(' ')

  // Reset regex state
  const pattern = new RegExp(TOKEN_PATTERN.source, TOKEN_PATTERN.flags)
  let match: RegExpExecArray | null

  while ((match = pattern.exec(fullText)) !== null) {
    const tokenName = match[1]
    // Filter out non-token values (pure numbers, common non-token utilities)
    if (!isLikelyToken(tokenName)) continue
    tokens.add(tokenName)
  }

  return Array.from(tokens).sort()
}

/**
 * Determine if a captured group from TOKEN_PATTERN is likely a design token
 * rather than a Tailwind utility value like "sm", "clip", "3", etc.
 */
function isLikelyToken(name: string): boolean {
  // Filter out pure numbers or number/number patterns (e.g., "3", "ring/50")
  if (/^\d/.test(name)) return false
  // Filter out common Tailwind non-token values
  const nonTokens = new Set([
    'clip',
    'padding',
    'none',
    'transparent',
    'current',
    'inherit',
    'auto',
    'hidden',
    'visible',
    'fixed',
    'absolute',
    'relative'
  ])
  if (nonTokens.has(name)) return false
  return true
}

/**
 * Extract spacing classes that match keys in SPACING_MAP.
 */
function extractSpacingClasses(classStrings: string[]): string[] {
  const classes = new Set<string>()
  const spacingPattern = /(?:^|\s)((?:gap|p|px|py)-[\w.]+)/g
  const fullText = classStrings.join(' ')

  let match: RegExpExecArray | null
  while ((match = spacingPattern.exec(fullText)) !== null) {
    const cls = match[1]
    if (cls in SPACING_MAP) {
      classes.add(cls)
    }
  }

  return Array.from(classes).sort()
}

/**
 * Extract radius classes that match keys in RADIUS_MAP.
 */
function extractRadiusClasses(classStrings: string[]): string[] {
  const classes = new Set<string>()
  const radiusPattern = /(?:^|\s)(rounded-[\w]+)/g
  const fullText = classStrings.join(' ')

  let match: RegExpExecArray | null
  while ((match = radiusPattern.exec(fullText)) !== null) {
    const cls = match[1]
    if (cls in RADIUS_MAP) {
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
