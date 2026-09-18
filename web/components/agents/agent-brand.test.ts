import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AGENT_ICONS, agentBrand, surfaceLabel, surfaceOf } from './agent-brand'
import { CONNECT_CLIENTS } from './connect-clients'

/**
 * Identification is a guess, and these tests are about keeping the guess
 * honest — that it reads what an agent said, tidies it, and never claims more
 * than the evidence supports.
 */

/** What Claude Code actually registered against this server. */
const CLAUDE_CODE = { name: 'Claude Code (ottopus-local)', uris: ['http://localhost:50038/callback'] }

describe('what we can tell from a registration', () => {
  it('recognises the client we have really seen', () => {
    const brand = agentBrand(CLAUDE_CODE.name, CLAUDE_CODE.uris)
    expect(brand.vendor).toBe('Claude Code')
    expect(brand.surface).toBe('cli')
  })

  /**
   * "Claude Code (ottopus-local)" names the workspace, not the product. The
   * heading should read as the product; the raw string stays reachable in the
   * markup, because nothing verified it and replacing it outright would hide
   * what was actually claimed.
   */
  it('drops the workspace qualifier from the label', () => {
    expect(agentBrand(CLAUDE_CODE.name, CLAUDE_CODE.uris).label).toBe('Claude Code')
    expect(agentBrand('Some Agent [work]').label).toBe('Some Agent')
  })

  it('prefers the more specific vendor when two would match', () => {
    // "Claude Code" contains "Claude", so order in the rule list is load-bearing.
    expect(agentBrand('Claude Code').vendor).toBe('Claude Code')
    expect(agentBrand('Claude Desktop').vendor).toBe('Claude')
  })

  /** Same product, two surfaces. The name carries the difference, not the mark. */
  it('gives every Claude surface the Claude mark', () => {
    expect(agentBrand('Claude Code').icon).toBe('claude-ai')
    expect(agentBrand('Claude Desktop').icon).toBe('claude-ai')
    expect(agentBrand('Claude').icon).toBe('claude-ai')
  })

  it('says nothing rather than guessing for a name it does not know', () => {
    const brand = agentBrand('Totally Unknown Thing', ['https://example.test/cb'])
    expect(brand.vendor).toBeNull()
    expect(brand.label).toBe('Totally Unknown Thing')
    // A generic bot, never a nearest-guess logo. Drawing a company's mark
    // beside a name nothing verified would be worse than drawing nothing.
    expect(brand.icon).toBe('other')
  })

  /** An empty name must not produce an empty heading. */
  it('never returns an empty label', () => {
    expect(agentBrand('(only a qualifier)').label).not.toBe('')
  })
})

describe('every mark a rule names is a file we actually ship', () => {
  it('has an svg on disk for each icon key', () => {
    for (const key of AGENT_ICONS) {
      const file = new URL(`../../public/agents/${key}.svg`, import.meta.url)
      expect(existsSync(file), `public/agents/${key}.svg is missing`).toBe(true)
    }
  })

  /**
   * A vendor rule pointing at a key we do not ship would render a broken image
   * until the onError fallback caught it. Cheaper to fail here.
   */
  it('never points a vendor at a key outside that set', () => {
    for (const name of ['Claude Code', 'Claude', 'Codex', 'VS Code', 'Cursor', 'Zed']) {
      expect(AGENT_ICONS, name).toContain(agentBrand(name).icon)
    }
  })

  /**
   * The connect dialog labels its own pills, and those labels are the exact
   * strings a person reads. "VS Code" did not match a pattern written for
   * "vscode", so the pill quietly drew the fallback bot — this is that bug.
   *
   * The dialog now passes its icon key directly, so this no longer decides what
   * renders there. It still has to hold: the same label arriving from a real
   * registration must resolve to the same mark.
   */
  it('resolves every label the connect dialog shows to that client own mark', () => {
    for (const client of CONNECT_CLIENTS) {
      expect(agentBrand(client.label).icon, client.label).toBe(client.icon)
    }
  })
})

describe('the surface is read from the callback, not from the name', () => {
  it('calls an https callback a hosted client', () => {
    expect(surfaceOf(['https://claude.ai/api/mcp/auth_callback'], 'Claude')).toBe('web')
  })

  it('calls a custom scheme a desktop app', () => {
    expect(surfaceOf(['cursor://anysphere.cursor-retrieval/oauth'], 'Cursor')).toBe('desktop')
  })

  it('splits loopback by what the client calls itself, since both use it', () => {
    expect(surfaceOf(['http://localhost:50038/callback'], 'Claude Code')).toBe('cli')
    expect(surfaceOf(['http://127.0.0.1:8000/cb'], 'Claude Desktop')).toBe('desktop')
  })

  it('admits it does not know when there is nothing to read', () => {
    expect(surfaceOf([], 'Whatever')).toBe('unknown')
    expect(surfaceLabel('unknown')).toBeNull()
  })

  /**
   * The one thing here an agent cannot simply assert. A client claiming to be
   * Claude Code while registering an https callback is a hosted client, and the
   * chip should say so even though the name says otherwise.
   */
  it('lets the callback contradict the name', () => {
    expect(agentBrand('Claude Code', ['https://not-anthropic.test/cb']).surface).toBe('web')
  })
})
