import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Where the address someone pastes into their agent comes from.
 *
 * This was derived in the browser: the API base with /api swapped for /mcp.
 * Right on a laptop, where both are paths on one origin. Wrong in production,
 * where they are separate subdomains — it produced https://api.ottopus.xyz/mcp,
 * which answers 404, and the copy button handed it out for anyone to paste.
 *
 * Reimported per test because both the API base and the override are read once
 * at module load, which is also how Next inlines them.
 */
async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, '')
    else vi.stubEnv(key, value)
  }
  return import('./api.js')
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('the MCP address', () => {
  it('comes from the service, not from the API base', async () => {
    fetchMock.mockResolvedValue(json({ mcpUrl: 'https://mcp.ottopus.xyz/mcp' }))
    const { fetchMcpUrl } = await load({ NEXT_PUBLIC_API_URL: 'https://api.ottopus.xyz/api' })

    expect(await fetchMcpUrl()).toBe('https://mcp.ottopus.xyz/mcp')
  })

  it('never invents one by rewriting the API host', async () => {
    // The exact string the old derivation produced, and a 404 in production.
    fetchMock.mockResolvedValue(json({ mcpUrl: 'https://mcp.ottopus.xyz/mcp' }))
    const { fetchMcpUrl } = await load({ NEXT_PUBLIC_API_URL: 'https://api.ottopus.xyz/api' })

    expect(await fetchMcpUrl()).not.toBe('https://api.ottopus.xyz/mcp')
  })

  it('asks the API surface it already talks to', async () => {
    fetchMock.mockResolvedValue(json({ mcpUrl: 'https://mcp.ottopus.xyz/mcp' }))
    const { fetchMcpUrl } = await load({ NEXT_PUBLIC_API_URL: 'https://api.ottopus.xyz/api' })
    await fetchMcpUrl()

    expect(fetchMock).toHaveBeenCalledWith('https://api.ottopus.xyz/api/meta')
  })

  it('fails rather than guessing when the service cannot be reached', async () => {
    // A wrong address is worse than none: it is pasted, copied and pasted again
    // long before anyone works out the address was the problem.
    fetchMock.mockResolvedValue(json({ error: 'nope' }, 502))
    const { fetchMcpUrl } = await load({ NEXT_PUBLIC_API_URL: 'https://api.ottopus.xyz/api' })

    await expect(fetchMcpUrl()).rejects.toThrow()
  })

  it('fails rather than handing back an empty address', async () => {
    fetchMock.mockResolvedValue(json({}))
    const { fetchMcpUrl } = await load({ NEXT_PUBLIC_API_URL: 'https://api.ottopus.xyz/api' })

    await expect(fetchMcpUrl()).rejects.toThrow()
  })

  it('takes the override without a round trip, for a deployment that pins it', async () => {
    const { fetchMcpUrl } = await load({
      NEXT_PUBLIC_API_URL: 'https://api.ottopus.xyz/api',
      NEXT_PUBLIC_MCP_URL: 'https://mcp.ottopus.xyz/mcp/',
    })

    expect(await fetchMcpUrl()).toBe('https://mcp.ottopus.xyz/mcp')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('works on a laptop with nothing configured at all', async () => {
    fetchMock.mockResolvedValue(json({ mcpUrl: 'http://localhost:8787/mcp' }))
    const { fetchMcpUrl } = await load()

    expect(await fetchMcpUrl()).toBe('http://localhost:8787/mcp')
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8787/api/meta')
  })
})
