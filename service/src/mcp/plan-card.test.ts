import { describe, expect, it } from 'vitest'
import { inlineAppClient, planCardHtml } from './plan-card.js'

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

  it('offers no way to approve, sign or cancel', () => {
    const script = planCardHtml('/* client */')
    expect(script).not.toMatch(/callServerTool/)
    // Its only buttons open a link.
    expect(script.match(/el\('button'/g)).toHaveLength(1)
    expect([...script.matchAll(/link\('([^']+)'/g)].map((m) => m[1])).toEqual(['Open review', 'View transaction'])
  })
})
