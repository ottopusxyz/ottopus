import { describe, expect, it } from 'vitest'
import { inlineAppClient, PLAN_CARD_HELPERS, planCardHtml } from './plan-card.js'

// The card's own helper code, run as the card runs it.
const helpers = new Function(`${PLAN_CARD_HELPERS}; return { walletOf, mergeStatus }`)() as {
  walletOf(sc: object): string | null
  mergeStatus(plan: object, view: object): Record<string, unknown>
}

describe('the plan card', () => {
  it('turns the client bundle’s one export into a global the card can read', () => {
    const out = inlineAppClient('var a=1;class B{}export{a as one,B as App}')
    expect(out).toBe('var a=1;class B{}globalThis.OttopusExtApps={one:a,App:B};')
  })

  it('refuses a bundle whose shape it does not know', () => {
    expect(() => inlineAppClient('var a=1;')).toThrow(/exactly one export/)
    expect(() => inlineAppClient('export{a};export{b};')).toThrow(/exactly one export/)
  })

  it('inlines the real client, with App reachable and no export left behind', () => {
    const page = planCardHtml()
    expect(page).toMatch(/globalThis\.OttopusExtApps=\{[^}]*\bApp:/)
    expect(page.match(/export\{/g)).toBeNull()
    // The client's script and the card's; nothing in either ends one early.
    expect(page.match(/<\/script/g)).toHaveLength(2)
  })

  /**
   * The summary and warnings are an agent's words. The card builds its DOM
   * with textContent, so none of them can become markup.
   */
  it('never parses plan text as markup', () => {
    const script = planCardHtml('/* client */')
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
  })

  /** Get_plan's handoff carries calldata. The card must not show it. */
  it('draws no calls, calldata or plan hash', () => {
    const script = planCardHtml('/* client */')
    expect(script).not.toMatch(/sc\.calls|sc\.planHash|\.data\b/)
  })

  /**
   * The card calls one tool, plan_status, which only reads. Never get_plan:
   * its first read of an approved agentic plan hands out the calls.
   */
  it('calls no tool but plan_status', () => {
    const script = planCardHtml('/* client */')
    expect(script.match(/callServerTool/g)).toHaveLength(1)
    expect([...script.matchAll(/callServerTool\(\{ name: '([^']+)'/g)].map((m) => m[1])).toEqual(['plan_status'])
    expect(script).not.toMatch(/'(get_plan|cancel_plan|report_execution|prepare_\w+)'/)
  })

  it('stops where the server says the plan is over, keeping no list of its own', () => {
    const script = planCardHtml('/* client */')
    expect(script).toContain('plan.terminal')
    expect(script).not.toMatch(/TERMINAL|isTerminal/)
  })

  it('keeps Otto outside the part of the card that is redrawn', () => {
    const page = planCardHtml('/* client */')
    expect(page).toMatch(/<div class="pc-head"><div class="otto" id="otto" hidden[^>]*>/)
    expect(page).toMatch(/<div id="card"><\/div><\/div>/)
    expect(page.indexOf('id="otto"')).toBeLessThan(page.indexOf('id="card"'))
    for (const pose of ['ready', 'busy', 'done', 'alert', 'rest']) expect(page).toContain(`<svg class="p-${pose}"`)
    expect(page).toContain('prefers-reduced-motion: reduce')
  })

  it('offers no way to approve, sign or cancel', () => {
    const script = planCardHtml('/* client */')
    // Its only buttons open a link.
    expect(script.match(/el\('button'/g)).toHaveLength(1)
    expect([...script.matchAll(/link\('([^']+)'/g)].map((m) => m[1])).toEqual(['View transaction', 'Open review'])
  })

  /** Base units read as nonsense, and the card has no decimals to convert them with. */
  it('prints amounts only from the readable copy, never base units', () => {
    const script = planCardHtml('/* client */')
    expect(script).toContain('sc.amounts')
    expect(script).not.toMatch(/expectedOut|minOut|amountIn|amountOut|\.diff\b|a\.amount\b/)
  })

  it('shows a planning state from the tool input, and lets a result replace it', () => {
    const script = planCardHtml('/* client */')
    expect(script).toContain('app.ontoolinput')
    expect(script).toContain('app.ontoolcancelled')
    expect(script).toMatch(/if \(!poll\.plan\) planning\(/)
  })

  it('shortens a CAIP-10 wallet and leaves a reply’s own label alone', () => {
    expect(helpers.walletOf({ account: 'eip155:56:0x51e0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa51e0' })).toBe('0x51e0…51e0')
    expect(helpers.walletOf({ account: 'Treasury (0x1234…5678)' })).toBe('Treasury (0x1234…5678)')
    expect(helpers.walletOf({ account: '0x1234…5678' })).toBe('0x1234…5678')
  })

  it('keeps a bridge’s destination when a plan_status read lands', () => {
    const plan = { planId: 'p', status: 'awaiting_review', chain: { id: 'eip155:56', name: 'BNB Chain', to: 'Base' } }
    const merged = helpers.mergeStatus(plan, { planId: 'p', status: 'submitted', chain: { id: 'eip155:56', name: 'BNB Chain' } })
    expect(merged.status).toBe('submitted')
    expect(merged.chain).toEqual({ id: 'eip155:56', name: 'BNB Chain', to: 'Base' })
    expect(plan.status).toBe('awaiting_review')
  })
})
