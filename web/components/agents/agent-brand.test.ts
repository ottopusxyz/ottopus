import { describe, expect, it } from 'vitest'
import { agentBrand, surfaceLabel, surfaceOf } from './agent-brand'

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

  it('says nothing rather than guessing for a name it does not know', () => {
    const brand = agentBrand('Totally Unknown Thing', ['https://example.test/cb'])
    expect(brand.vendor).toBeNull()
    expect(brand.label).toBe('Totally Unknown Thing')
    // A neutral surface token, not a borrowed brand colour.
    expect(brand.bg).toBe('var(--ot-surface-3)')
  })

  /** An empty name must not produce an empty heading. */
  it('never returns an empty label', () => {
    expect(agentBrand('(only a qualifier)').label).not.toBe('')
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
