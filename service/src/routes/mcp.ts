import { Hono } from 'hono'

/**
 * Agent-facing surface. Mounted at the root of mcp.ottopus.xyz in production,
 * and at /mcp everywhere — local development has no subdomains.
 *
 * The OAuth authorize and token endpoints belong here too, so the issuer origin
 * matches the MCP endpoint and discovery needs no special casing.
 */
export const mcpApp = new Hono()

mcpApp.get('/health', (c) => c.json({ ok: true, surface: 'mcp' }))
