import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

/**
 * The variables loadConfig reads. Cleared between tests so one case cannot
 * inherit another's environment — and so the ambient .env, which exists on a
 * developer's machine and not in CI, cannot change the answer.
 */
const KEYS = [
  'NODE_ENV',
  'PORT',
  'PUBLIC_URL',
  'MCP_URL',
  'WEB_URL',
  'WEB_ORIGINS',
] as const

const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

function env(values: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const key of KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(values)) process.env[key] = value
}

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

/**
 * This is the shape of a real outage: deployed with neither PUBLIC_URL nor
 * MCP_URL, the service advertised http://localhost:8080/mcp as its issuer. Every
 * OAuth endpoint in the discovery documents pointed at the container's own
 * loopback, so Claude's registration POST went nowhere — and the authorize
 * endpoint rejected the service's real address as the wrong audience.
 *
 * Health stayed green and the web app kept working the whole time, which is why
 * this is a boot failure rather than a warning.
 */
describe('a production identity', () => {
  it('refuses to boot when nothing says where the service actually is', () => {
    env({ NODE_ENV: 'production', PORT: '8080' })
    expect(() => loadConfig()).toThrow(/MCP_URL/)
  })

  it('names the public URL as the fix, not the symptom', () => {
    env({ NODE_ENV: 'production', PORT: '8080' })
    expect(() => loadConfig()).toThrow(/Set MCP_URL to the public URL/)
  })

  it('refuses a consent redirect pointed at the deployer’s laptop', () => {
    // MCP_URL is right and WEB_URL is unset, so it falls back to the first
    // default web origin — which is localhost. The failure is separate from the
    // one above and has its own way of being missed.
    env({ NODE_ENV: 'production', MCP_URL: 'https://mcp.ottopus.xyz/mcp' })
    expect(() => loadConfig()).toThrow(/WEB_URL/)
  })

  it('accepts a fully addressed deployment', () => {
    env({
      NODE_ENV: 'production',
      MCP_URL: 'https://mcp.ottopus.xyz/mcp',
      WEB_URL: 'https://ottopus.xyz',
    })
    const config = loadConfig()
    expect(config.mcpUrl).toBe('https://mcp.ottopus.xyz/mcp')
    expect(config.webUrl).toBe('https://ottopus.xyz')
  })

  it('derives both endpoints from PUBLIC_URL alone', () => {
    env({
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://mcp.ottopus.xyz',
      WEB_URL: 'https://ottopus.xyz',
    })
    expect(loadConfig().mcpUrl).toBe('https://mcp.ottopus.xyz/mcp')
  })

  it('leaves a laptop alone, where loopback is the correct answer', () => {
    env({ PORT: '8787' })
    const config = loadConfig()
    expect(config.mcpUrl).toBe('http://localhost:8787/mcp')
    expect(config.webUrl).toBe('http://localhost:3000')
  })

  it('leaves the test environment alone, which has no public address at all', () => {
    env({ NODE_ENV: 'test' })
    expect(() => loadConfig()).not.toThrow()
  })
})
