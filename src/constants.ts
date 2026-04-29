// Constants for @forgekitdev/figma-drift
// Note: FIGMA_FILE_KEY is no longer hardcoded here.
// Use loadConfig() from ./config.ts to resolve the file key.

/**
 * Tailwind spacing class → pixel value mapping.
 * Covers gap-*, p-*, px-*, py-* utilities used in component libraries.
 */
export const SPACING_MAP: Record<string, number> = {
  'gap-1': 4,
  'gap-1.5': 6,
  'gap-2': 8,
  'gap-3': 12,
  'gap-4': 16,
  'gap-5': 20,
  'gap-6': 24,
  'gap-8': 32,
  'p-1': 4,
  'p-2': 8,
  'p-3': 12,
  'p-4': 16,
  'p-6': 24,
  'px-1': 4,
  'px-2': 8,
  'px-2.5': 10,
  'px-3': 12,
  'px-4': 16,
  'px-6': 24,
  'py-1': 4,
  'py-2': 8,
  'py-3': 12,
  'py-4': 16
}

/**
 * Tailwind rounded class → pixel value mapping.
 * Values are based on Tailwind v4 default configuration.
 */
export const RADIUS_MAP: Record<string, number> = {
  'rounded-sm': 5,
  'rounded-md': 8,
  'rounded-lg': 10,
  'rounded-xl': 14,
  'rounded-full': 9999,
  'rounded-4xl': 26
}

/**
 * Regex pattern for extracting design token references from Tailwind classes.
 * Matches utilities like bg-primary, text-muted-foreground, border-input, ring-ring/50.
 */
export const TOKEN_PATTERN =
  /(?:bg|text|border|ring|fill|stroke)-(\w[\w-]*(?:\/\d+)?)/g
