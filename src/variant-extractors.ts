// Variant extraction adapters — pluggable strategies for pulling
// variant / defaultVariant data out of a component source file.
//
// The original tool only understood class-variance-authority's `cva()`.
// Non-shadcn stacks (tailwind-variants, styled-components, CSS Modules, …)
// produced empty variants. Each adapter below recognises one source style
// and returns the same shape so downstream code is unchanged.

import { Node, SyntaxKind } from 'ts-morph'
import type {
  CallExpression,
  ObjectLiteralExpression,
  SourceFile
} from 'ts-morph'

export type VariantExtractionResult = {
  variants: Record<string, string[]>
  defaultVariants: Record<string, string>
}

/**
 * A pluggable strategy that recognises one variant-source convention and
 * extracts variant options + defaults from a source file.
 */
export interface VariantExtractor {
  /** Stable identifier, also used for explicit config override. */
  readonly name: string
  /** Whether this extractor recognises the given source file. */
  detect(sourceFile: SourceFile): boolean
  /** Extract variants. Only called when detect() returned true. */
  extract(sourceFile: SourceFile): VariantExtractionResult
}

function emptyResult(): VariantExtractionResult {
  return { variants: {}, defaultVariants: {} }
}

/**
 * Pull variants/defaultVariants out of a config object literal shaped like
 * `{ variants: { name: { option: ... } }, defaultVariants: { name: value } }`.
 * Shared by the cva() and tailwind-variants (`tv()`) adapters since both use
 * the same config shape.
 */
function extractFromConfigObject(
  configObj: ObjectLiteralExpression
): VariantExtractionResult {
  const variants: Record<string, string[]> = {}
  const defaultVariants: Record<string, string> = {}

  const variantsProp = configObj.getProperty('variants')
  if (variantsProp && Node.isPropertyAssignment(variantsProp)) {
    const variantsObj = variantsProp.getInitializer()
    if (variantsObj && Node.isObjectLiteralExpression(variantsObj)) {
      for (const prop of variantsObj.getProperties()) {
        if (!Node.isPropertyAssignment(prop)) continue
        const variantName = unquote(prop.getName())
        const optionsObj = prop.getInitializer()
        if (optionsObj && Node.isObjectLiteralExpression(optionsObj)) {
          const optionKeys: string[] = []
          for (const optionProp of optionsObj.getProperties()) {
            if (Node.isPropertyAssignment(optionProp)) {
              optionKeys.push(unquote(optionProp.getName()))
            }
          }
          variants[variantName] = optionKeys
        }
      }
    }
  }

  const defaultVariantsProp = configObj.getProperty('defaultVariants')
  if (defaultVariantsProp && Node.isPropertyAssignment(defaultVariantsProp)) {
    const defaultObj = defaultVariantsProp.getInitializer()
    if (defaultObj && Node.isObjectLiteralExpression(defaultObj)) {
      for (const prop of defaultObj.getProperties()) {
        if (Node.isPropertyAssignment(prop)) {
          const key = unquote(prop.getName())
          const init = prop.getInitializer()
          if (init) {
            defaultVariants[key] = unquote(init.getText())
          }
        }
      }
    }
  }

  return { variants, defaultVariants }
}

function unquote(value: string): string {
  return value.replace(/^["'`]|["'`]$/g, '')
}

/** Find a call expression whose callee text exactly equals `name`. */
function findCallByName(
  sourceFile: SourceFile,
  name: string
): CallExpression | undefined {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find(call => call.getExpression().getText() === name)
}

/**
 * class-variance-authority: `cva(base, { variants, defaultVariants })`.
 * The config is the second argument. Preserved exactly for backward compat.
 */
export class CvaVariantExtractor implements VariantExtractor {
  readonly name = 'cva'

  detect(sourceFile: SourceFile): boolean {
    return findCallByName(sourceFile, 'cva') !== undefined
  }

  extract(sourceFile: SourceFile): VariantExtractionResult {
    const call = findCallByName(sourceFile, 'cva')
    if (!call) return emptyResult()
    const args = call.getArguments()
    if (args.length < 2) return emptyResult()
    const configArg = args[1]
    if (!Node.isObjectLiteralExpression(configArg)) return emptyResult()
    return extractFromConfigObject(configArg)
  }
}

/**
 * tailwind-variants: `tv({ base, variants, defaultVariants })`.
 * Same config shape as cva, but passed as the first (and only) object arg.
 */
export class TailwindVariantsExtractor implements VariantExtractor {
  readonly name = 'tailwind-variants'

  detect(sourceFile: SourceFile): boolean {
    return findCallByName(sourceFile, 'tv') !== undefined
  }

  extract(sourceFile: SourceFile): VariantExtractionResult {
    const call = findCallByName(sourceFile, 'tv')
    if (!call) return emptyResult()
    const configArg = call
      .getArguments()
      .find(arg => Node.isObjectLiteralExpression(arg))
    if (!configArg || !Node.isObjectLiteralExpression(configArg)) {
      return emptyResult()
    }
    return extractFromConfigObject(configArg)
  }
}

/**
 * styled-components (best-effort): detects prop-driven conditional
 * interpolation inside `styled.tag` / `styled(Comp)` template literals, e.g.
 *   styled.button`${props => props.variant === 'primary' ? a : b}`
 *   styled.button`${({ size }) => (size === 'lg' ? a : b)}`
 * Prop names become variant groups; the string literals they are compared
 * against become the options. No defaultVariants are inferable.
 */
export class StyledComponentsPropsExtractor implements VariantExtractor {
  readonly name = 'styled-components'

  detect(sourceFile: SourceFile): boolean {
    return this.getStyledTemplates(sourceFile).length > 0
  }

  extract(sourceFile: SourceFile): VariantExtractionResult {
    const variants: Record<string, Set<string>> = {}

    for (const template of this.getStyledTemplates(sourceFile)) {
      for (const arrow of template.getDescendantsOfKind(
        SyntaxKind.ArrowFunction
      )) {
        for (const binary of arrow.getDescendantsOfKind(
          SyntaxKind.BinaryExpression
        )) {
          const op = binary.getOperatorToken().getText()
          if (op !== '===' && op !== '==' && op !== '!==' && op !== '!=') {
            continue
          }
          const left = binary.getLeft()
          const right = binary.getRight()

          const propName = this.propNameFromOperand(left)
          const literal = this.stringLiteralValue(right)
          if (propName && literal !== undefined) {
            ;(variants[propName] ??= new Set()).add(literal)
            continue
          }
          // Also handle the reversed order: 'primary' === props.variant
          const propNameR = this.propNameFromOperand(right)
          const literalR = this.stringLiteralValue(left)
          if (propNameR && literalR !== undefined) {
            ;(variants[propNameR] ??= new Set()).add(literalR)
          }
        }
      }
    }

    const result: Record<string, string[]> = {}
    for (const [name, options] of Object.entries(variants)) {
      result[name] = Array.from(options)
    }
    return { variants: result, defaultVariants: {} }
  }

  /** Templates tagged with styled.* or styled(...). */
  private getStyledTemplates(sourceFile: SourceFile) {
    return sourceFile
      .getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)
      .filter(t => {
        const tag = t.getTag().getText()
        return tag.startsWith('styled.') || tag.startsWith('styled(')
      })
  }

  /** Extract the prop name from `props.variant`, `p.variant`, or `variant`. */
  private propNameFromOperand(node: Node): string | undefined {
    if (Node.isPropertyAccessExpression(node)) {
      return node.getName()
    }
    if (Node.isIdentifier(node)) {
      return node.getText()
    }
    return undefined
  }

  private stringLiteralValue(node: Node): string | undefined {
    if (Node.isStringLiteral(node)) {
      return node.getLiteralValue()
    }
    if (Node.isNoSubstitutionTemplateLiteral(node)) {
      return node.getLiteralText()
    }
    return undefined
  }
}

/**
 * CSS Modules (best-effort): detects `styles.x` member access from an
 * imported `*.module.css` / `*.module.scss` file (directly or wrapped in a
 * classnames/clsx call) and surfaces the accessed class-name keys as
 * variant-like options under a synthesized `variant` group.
 */
export class CssModulesExtractor implements VariantExtractor {
  readonly name = 'css-modules'

  detect(sourceFile: SourceFile): boolean {
    return (
      this.getStylesIdentifiers(sourceFile).length > 0 &&
      this.collectStyleKeys(sourceFile).length > 0
    )
  }

  extract(sourceFile: SourceFile): VariantExtractionResult {
    const keys = this.collectStyleKeys(sourceFile)
    if (keys.length === 0) return emptyResult()
    return { variants: { variant: keys }, defaultVariants: {} }
  }

  /** Local binding names of default imports from *.module.css/scss files. */
  private getStylesIdentifiers(sourceFile: SourceFile): string[] {
    const names: string[] = []
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const spec = importDecl.getModuleSpecifierValue()
      if (/\.module\.(css|scss|sass|less)$/.test(spec)) {
        const def = importDecl.getDefaultImport()
        if (def) names.push(def.getText())
      }
    }
    return names
  }

  /** All distinct keys accessed as `<styles>.key`, sorted. */
  private collectStyleKeys(sourceFile: SourceFile): string[] {
    const identifiers = new Set(this.getStylesIdentifiers(sourceFile))
    if (identifiers.size === 0) return []
    const keys = new Set<string>()
    for (const access of sourceFile.getDescendantsOfKind(
      SyntaxKind.PropertyAccessExpression
    )) {
      const objText = access.getExpression().getText()
      if (identifiers.has(objText)) {
        keys.add(access.getName())
      }
    }
    return Array.from(keys).sort()
  }
}

/**
 * Ordered registry of built-in extractors. cva is tried first so existing
 * shadcn projects behave exactly as before; the rest are fall-through.
 */
export const DEFAULT_VARIANT_EXTRACTORS: VariantExtractor[] = [
  new CvaVariantExtractor(),
  new TailwindVariantsExtractor(),
  new StyledComponentsPropsExtractor(),
  new CssModulesExtractor()
]

/**
 * Resolve variants for a source file.
 *
 * When `override` names a known extractor it is used unconditionally;
 * otherwise each extractor's detect() is tried in order and the first match
 * wins. Returns empty variants when nothing matches.
 */
export function extractVariants(
  sourceFile: SourceFile,
  options?: { override?: string; extractors?: VariantExtractor[] }
): VariantExtractionResult {
  const extractors = options?.extractors ?? DEFAULT_VARIANT_EXTRACTORS

  if (options?.override) {
    const chosen = extractors.find(e => e.name === options.override)
    if (chosen) {
      return chosen.extract(sourceFile)
    }
  }

  for (const extractor of extractors) {
    if (extractor.detect(sourceFile)) {
      return extractor.extract(sourceFile)
    }
  }

  return emptyResult()
}
