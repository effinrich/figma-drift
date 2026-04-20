import { describe, it, expect } from 'vitest'

describe('test infrastructure', () => {
  it('vitest runs successfully', () => {
    expect(1 + 1).toBe(2)
  })

  it('can import package modules', async () => {
    const { SPACING_MAP } = await import('../constants')
    expect(SPACING_MAP).toBeDefined()
    expect(SPACING_MAP['gap-4']).toBe(16)
  })
})
