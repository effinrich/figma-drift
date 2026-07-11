// Ambient type declarations for culori.
// culori ships runtime code but no bundled .d.ts via its export map, so
// TypeScript cannot resolve types under "bundler" module resolution. We
// declare the small surface used by this project.

declare module 'culori' {
  export type RgbColor = {
    mode: 'rgb'
    r: number
    g: number
    b: number
    alpha?: number
  }

  /** Any culori color object. Carries a `mode` discriminator plus channels. */
  export type Color = { mode: string; alpha?: number } & Record<
    string,
    number | string
  >

  /** Parse any CSS color string (hex, rgb, hsl, oklch, …). */
  export function parse(color: string): Color | undefined

  /** Format a color (object or string) as a 6-digit hex string. */
  export function formatHex(color: Color | string): string

  /** Format a color as an rgb()/rgba() string. */
  export function formatRgb(color: Color | string): string

  /** Build a converter into the given color mode (e.g. 'rgb'). */
  export function converter(mode: 'rgb'): (color: Color | string) => RgbColor
  export function converter(mode: string): (color: Color | string) => Color
}
