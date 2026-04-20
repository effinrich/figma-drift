import { describe, it, expect, vi } from 'vitest'
import {
  FigmaMCPAdapter,
  FigmaConnectionError,
  FigmaMCPError,
  FigmaTruncationError
} from '../adapters/figma-mcp'
import type { MCPToolCaller } from '../adapters/figma-mcp'

const FILE_KEY = 'test-file-key'

function createAdapter(
  callTool: MCPToolCaller,
  overrides?: {
    connectionTimeoutMs?: number
    maxRetries?: number
    retryDelayMs?: number
    outputLimitBytes?: number
  }
) {
  return new FigmaMCPAdapter(callTool, {
    fileKey: FILE_KEY,
    connectionTimeoutMs: overrides?.connectionTimeoutMs ?? 500,
    maxRetries: overrides?.maxRetries ?? 2,
    retryDelayMs: overrides?.retryDelayMs ?? 10,
    outputLimitBytes: overrides?.outputLimitBytes ?? 20_480,
    ...overrides
  })
}

describe('FigmaMCPAdapter', () => {
  describe('getDesignContext', () => {
    it('returns design context for a node', async () => {
      const mockCaller = vi.fn().mockResolvedValue('{"layers": []}')
      const adapter = createAdapter(mockCaller)

      const result = await adapter.getDesignContext('1:23')

      expect(result.nodeId).toBe('1:23')
      expect(result.content).toBe('{"layers": []}')
      expect(result.truncated).toBe(false)
      expect(mockCaller).toHaveBeenCalledWith('get_design_context', {
        fileKey: FILE_KEY,
        nodeId: '1:23'
      })
    })

    it('detects truncation when response approaches 20KB', async () => {
      // Create a string that's ~19.5KB (above 95% of 20KB)
      const largeContent = 'x'.repeat(19_600)
      const mockCaller = vi.fn().mockResolvedValue(largeContent)
      const adapter = createAdapter(mockCaller)

      const result = await adapter.getDesignContext('1:23')

      expect(result.truncated).toBe(true)
    })

    it('does not flag small responses as truncated', async () => {
      const smallContent = 'x'.repeat(1000)
      const mockCaller = vi.fn().mockResolvedValue(smallContent)
      const adapter = createAdapter(mockCaller)

      const result = await adapter.getDesignContext('1:23')

      expect(result.truncated).toBe(false)
    })
  })

  describe('getMetadata', () => {
    it('returns metadata with parsed node map from JSON', async () => {
      const jsonContent = JSON.stringify({
        id: '0:1',
        name: 'Page',
        children: [
          { id: '1:2', name: 'Button' },
          { id: '1:3', name: 'Badge' }
        ]
      })
      const mockCaller = vi.fn().mockResolvedValue(jsonContent)
      const adapter = createAdapter(mockCaller)

      const result = await adapter.getMetadata('0:1')

      expect(result.nodeId).toBe('0:1')
      expect(result.nodeMap['0:1']).toBe('Page')
      expect(result.nodeMap['1:2']).toBe('Button')
      expect(result.nodeMap['1:3']).toBe('Badge')
    })

    it('parses node map from non-JSON content via regex', async () => {
      const textContent = '1:2 - Button Component\n1:3 – Badge Component'
      const mockCaller = vi.fn().mockResolvedValue(textContent)
      const adapter = createAdapter(mockCaller)

      const result = await adapter.getMetadata('0:1')

      expect(result.nodeMap['1:2']).toBe('Button Component')
      expect(result.nodeMap['1:3']).toBe('Badge Component')
    })
  })

  describe('getScreenshot', () => {
    it('returns screenshot data', async () => {
      const mockCaller = vi.fn().mockResolvedValue('data:image/png;base64,abc')
      const adapter = createAdapter(mockCaller)

      const result = await adapter.getScreenshot('1:23')

      expect(result).toBe('data:image/png;base64,abc')
      expect(mockCaller).toHaveBeenCalledWith('get_screenshot', {
        fileKey: FILE_KEY,
        nodeId: '1:23'
      })
    })
  })

  describe('getVariableDefs', () => {
    it('parses variable collections from JSON response', async () => {
      const jsonContent = JSON.stringify({
        name: 'Colors',
        modes: ['Light', 'Dark'],
        variables: [
          {
            name: 'primary',
            valuesByMode: { Light: '#000000', Dark: '#ffffff' }
          },
          {
            name: 'background',
            valuesByMode: { Light: '#ffffff', Dark: '#000000' }
          }
        ]
      })
      const mockCaller = vi.fn().mockResolvedValue(jsonContent)
      const adapter = createAdapter(mockCaller)

      const result = await adapter.getVariableDefs('1:23')

      expect(result.collections['Colors']).toBeDefined()
      expect(result.collections['Colors'].modes).toEqual(['Light', 'Dark'])
      expect(result.collections['Colors'].variables).toHaveLength(2)
      expect(result.collections['Colors'].variables[0].name).toBe('primary')
    })

    it('returns empty collections for non-JSON content', async () => {
      const mockCaller = vi.fn().mockResolvedValue('not json')
      const adapter = createAdapter(mockCaller)

      const result = await adapter.getVariableDefs('1:23')

      expect(result.content).toBe('not json')
      expect(Object.keys(result.collections)).toHaveLength(0)
    })
  })

  describe('searchDesignSystem', () => {
    it('parses search results from JSON array', async () => {
      const jsonContent = JSON.stringify([
        {
          nodeId: '1:2',
          name: 'Button',
          pageName: 'Components',
          description: 'Primary button'
        },
        {
          id: '1:3',
          name: 'Badge',
          page: 'Components',
          description: ''
        }
      ])
      const mockCaller = vi.fn().mockResolvedValue(jsonContent)
      const adapter = createAdapter(mockCaller)

      const results = await adapter.searchDesignSystem('Button')

      expect(results).toHaveLength(2)
      expect(results[0].nodeId).toBe('1:2')
      expect(results[0].name).toBe('Button')
      expect(results[1].nodeId).toBe('1:3')
      expect(results[1].pageName).toBe('Components')
    })

    it('returns empty array for non-JSON content', async () => {
      const mockCaller = vi.fn().mockResolvedValue('not json')
      const adapter = createAdapter(mockCaller)

      const results = await adapter.searchDesignSystem('Button')

      expect(results).toEqual([])
    })
  })

  describe('useFigma', () => {
    it('returns success result on successful execution', async () => {
      const mockCaller = vi.fn().mockResolvedValue('Script executed')
      const adapter = createAdapter(mockCaller)

      const result = await adapter.useFigma(
        'figma.currentPage.selection',
        'Get selection'
      )

      expect(result.success).toBe(true)
      expect(result.output).toBe('Script executed')
      expect(result.error).toBeUndefined()
      expect(mockCaller).toHaveBeenCalledWith('use_figma', {
        fileKey: FILE_KEY,
        script: 'figma.currentPage.selection',
        description: 'Get selection'
      })
    })

    it('returns failure result when MCP call throws', async () => {
      const mockCaller = vi.fn().mockRejectedValue(new Error('Script error'))
      const adapter = createAdapter(mockCaller, { maxRetries: 0 })

      const result = await adapter.useFigma('bad script', 'Test')

      expect(result.success).toBe(false)
      expect(result.output).toBe('')
      expect(result.error).toBeDefined()
    })
  })

  describe('connection timeout', () => {
    it('throws FigmaConnectionError when call exceeds timeout', async () => {
      const mockCaller = vi
        .fn()
        .mockImplementation(
          () => new Promise(resolve => setTimeout(resolve, 2000))
        )
      const adapter = createAdapter(mockCaller, {
        connectionTimeoutMs: 50,
        maxRetries: 0
      })

      await expect(adapter.getDesignContext('1:23')).rejects.toThrow(
        FigmaConnectionError
      )
    })

    it('includes timeout duration in error message', async () => {
      const mockCaller = vi
        .fn()
        .mockImplementation(
          () => new Promise(resolve => setTimeout(resolve, 2000))
        )
      const adapter = createAdapter(mockCaller, {
        connectionTimeoutMs: 50,
        maxRetries: 0
      })

      await expect(adapter.getDesignContext('1:23')).rejects.toThrow(
        /Timed out after 50ms/
      )
    })
  })

  describe('retry logic', () => {
    it('retries on transient failure and succeeds', async () => {
      const mockCaller = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce('{"ok": true}')
      const adapter = createAdapter(mockCaller, {
        maxRetries: 2,
        retryDelayMs: 10
      })

      const result = await adapter.getDesignContext('1:23')

      expect(result.content).toBe('{"ok": true}')
      expect(mockCaller).toHaveBeenCalledTimes(2)
    })

    it('exhausts retries and throws FigmaMCPError', async () => {
      const mockCaller = vi.fn().mockRejectedValue(new Error('persistent'))
      const adapter = createAdapter(mockCaller, {
        maxRetries: 2,
        retryDelayMs: 10
      })

      await expect(adapter.getDesignContext('1:23')).rejects.toThrow(
        FigmaMCPError
      )
      // 1 initial + 2 retries = 3 total calls
      expect(mockCaller).toHaveBeenCalledTimes(3)
    })

    it('does not retry connection errors', async () => {
      const mockCaller = vi
        .fn()
        .mockImplementation(
          () => new Promise(resolve => setTimeout(resolve, 2000))
        )
      const adapter = createAdapter(mockCaller, {
        connectionTimeoutMs: 50,
        maxRetries: 2,
        retryDelayMs: 10
      })

      await expect(adapter.getDesignContext('1:23')).rejects.toThrow(
        FigmaConnectionError
      )
      // Connection errors are not retried
      expect(mockCaller).toHaveBeenCalledTimes(1)
    })

    it('retries the correct number of times', async () => {
      const mockCaller = vi.fn().mockRejectedValue(new Error('fail'))
      const adapter = createAdapter(mockCaller, {
        maxRetries: 1,
        retryDelayMs: 10
      })

      await expect(adapter.getMetadata('1:23')).rejects.toThrow(FigmaMCPError)
      // 1 initial + 1 retry = 2 total calls
      expect(mockCaller).toHaveBeenCalledTimes(2)
    })
  })

  describe('truncation detection', () => {
    it('detects truncation at exactly 95% of limit', async () => {
      const adapter = createAdapter(vi.fn(), { outputLimitBytes: 1000 })
      // 950 bytes = exactly 95% of 1000
      expect(adapter.isLikelyTruncated('x'.repeat(950))).toBe(true)
    })

    it('does not flag content below 95% threshold', async () => {
      const adapter = createAdapter(vi.fn(), { outputLimitBytes: 1000 })
      expect(adapter.isLikelyTruncated('x'.repeat(949))).toBe(false)
    })

    it('flags content above the limit', async () => {
      const adapter = createAdapter(vi.fn(), { outputLimitBytes: 1000 })
      expect(adapter.isLikelyTruncated('x'.repeat(1100))).toBe(true)
    })
  })

  describe('error types', () => {
    it('FigmaMCPError includes tool name', () => {
      const error = new FigmaMCPError('test error', 'get_design_context')
      expect(error.toolName).toBe('get_design_context')
      expect(error.name).toBe('FigmaMCPError')
    })

    it('FigmaConnectionError includes timeout info', () => {
      const error = new FigmaConnectionError('get_metadata', 10000)
      expect(error.toolName).toBe('get_metadata')
      expect(error.message).toContain('10000ms')
      expect(error.message).toContain('Figma MCP server is not connected')
      expect(error.name).toBe('FigmaConnectionError')
    })

    it('FigmaTruncationError includes node ID', () => {
      const error = new FigmaTruncationError('get_design_context', '1:23')
      expect(error.message).toContain('1:23')
      expect(error.message).toContain('truncated')
      expect(error.name).toBe('FigmaTruncationError')
    })
  })
})
