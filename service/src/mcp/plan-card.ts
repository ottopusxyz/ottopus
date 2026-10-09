import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { MASCOT_CSS, MASCOT_HTML } from './plan-card-mascot.js'

/**
 * The plan card: what a host that speaks MCP Apps draws under a prepare_*
 * or get_plan call, in place of reading the reply as a block of text.
 *
 * It shows the plan and nothing it could act on. No calldata — get_plan's
 * handoff calls are in the same structured reply and are deliberately never
 * drawn — and no approve, sign or cancel. The one thing it does is ask the
 * host to open the review link, which is where approval still happens, bound
 * to the plan hash. A host without MCP Apps ignores `_meta` and reads the
 * text reply, which is unchanged.
 *
 * Once drawn, it follows the plan to its end by polling plan_status, the
 * one tool it calls. Not get_plan: on an approved agentic plan that hands
 * out the calls and closes cancel, which a card refreshing in the
 * background must never do.
 *
 * One self-contained page: the sandbox it runs in loads nothing from the
 * network, so the ext-apps client is inlined rather than fetched.
 */

export const PLAN_CARD_URI = 'ui://ottopus/plan'

/** What a tool carries to have the card drawn under it. The flat key is the older spelling some hosts still read. */
export const PLAN_CARD_META = { ui: { resourceUri: PLAN_CARD_URI }, 'ui/resourceUri': PLAN_CARD_URI } as const

/** The card's own status reader: callable by the card, not offered to the model. */
export const PLAN_STATUS_META = { ui: { visibility: ['app'] } } as const

/**
 * The ext-apps browser client, made usable from an inline script.
 *
 * Its self-contained build is one ES module ending in a single `export{…}`.
 * An inline module cannot be imported from, so that statement becomes an
 * assignment to a global the card reads. Read once, at first use.
 */
export function inlineAppClient(bundle: string): string {
  const at = bundle.lastIndexOf('export{')
  if (at === -1 || bundle.indexOf('export{') !== at) throw new Error('ext-apps bundle: expected exactly one export statement')
  const end = bundle.indexOf('}', at)
  const names = bundle
    .slice(at + 'export{'.length, end)
    .split(',')
    .map((pair) => {
      const [local, exported] = pair.split(' as ').map((part) => part.trim())
      return `${exported ?? local}:${local}`
    })
  return `${bundle.slice(0, at)}globalThis.OttopusExtApps={${names.join(',')}};${bundle.slice(end + 1)}`
}

let client: string | undefined
function appClient(): string {
  client ??= inlineAppClient(
    readFileSync(createRequire(import.meta.url).resolve('@modelcontextprotocol/ext-apps/app-with-deps'), 'utf8'),
  )
  return client
}

const CSS = `
:root { --ink: #0b1b3f; --muted: #5b6478; --line: #e3e6ee; --bg: #ffffff; --plan: #4f8df7; --ok: #3cc98a; --warn: #f5b843; --block: #c62a2f; --block-text: #c62a2f; --navy: #0b1b3f; }
@media (prefers-color-scheme: dark) { :root { --ink: #eef1f8; --muted: #a3abbe; --line: #2a3350; --bg: #121a2e; --block-text: #ff8a8d; } }
[data-theme="dark"] { --ink: #eef1f8; --muted: #a3abbe; --line: #2a3350; --bg: #121a2e; --block-text: #ff8a8d; }
[data-theme="light"] { --ink: #0b1b3f; --muted: #5b6478; --line: #e3e6ee; --bg: #ffffff; --block-text: #c62a2f; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: transparent; }
.frame { display: flex; align-items: flex-start; gap: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); padding: 14px 16px; max-width: 520px; }
#card { flex: 1; min-width: 0; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.brand { font-weight: 600; font-size: 12px; letter-spacing: .02em; color: var(--muted); }
.badge { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; color: var(--ink); background: var(--line); }
.badge.plan, .badge.ok, .badge.warn { color: var(--navy); }
.badge.plan { background: var(--plan); } .badge.ok { background: var(--ok); } .badge.warn { background: var(--warn); }
.badge.block { background: var(--block); color: #ffffff; }
.summary { font-size: 16px; font-weight: 600; margin: 4px 0 10px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0 0 10px; }
dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
ul { margin: 0 0 10px; padding-left: 18px; } li.block { color: var(--block-text); }
.outcome { color: var(--muted); margin: 0 0 10px; }
.stale { color: var(--muted); font-size: 12px; margin: 8px 0 0; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
button { font: inherit; font-weight: 600; border: 0; border-radius: 8px; padding: 7px 12px; cursor: pointer; background: var(--plan); color: var(--navy); }
button.quiet { background: transparent; color: var(--ink); border: 1px solid var(--line); }
`

/**
 * The card's own script. Plain JS in a raw string, so no template
 * substitutions: every `+` below is deliberate. It builds the DOM with
 * textContent only — the summary and warnings come from an agent's input
 * and are never parsed as markup.
 */
const SCRIPT = String.raw`
const { App, applyDocumentTheme, applyHostStyleVariables } = globalThis.OttopusExtApps
const app = new App({ name: 'Ottopus plan card', version: '1' }, {}, { autoResize: true })
const root = document.getElementById('card')
const otto = document.getElementById('otto')

// The label for a reply that carries none (a prepare_* reply); plan_status sends its own.
const STATUS = {
  draft: ['Planning', ''],
  awaiting_review: ['Ready for review', 'plan'],
  awaiting_signature: ['Waiting for signature', 'plan'],
  approved: ['Approved', 'plan'],
  submitted: ['Sent', 'plan'],
  confirmed: ['Confirmed', 'ok'],
  failed: ['Failed', 'block'],
  expired: ['Expired', 'warn'],
  blocked: ['Blocked', 'block'],
  superseded: ['Replaced', ''],
  cancelled: ['Cancelled', ''],
}

const POSE = {
  awaiting_review: 'ready', awaiting_signature: 'ready', approved: 'ready', submitted: 'busy',
  confirmed: 'done', failed: 'alert', blocked: 'alert', expired: 'alert',
}

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text != null) node.textContent = String(text)
  return node
}

function walletOf(sc) {
  if (typeof sc.recommendedAccount === 'string') return sc.recommendedAccount
  if (typeof sc.account === 'string') return sc.account
  if (sc.account && typeof sc.account === 'object') return sc.account.label || sc.account.caip10
  return null
}

function simulationOf(sc) {
  if (Array.isArray(sc.observed)) {
    return sc.observed.length
      ? 'Simulated: ' + sc.observed.map((o) => o.diff + ' ' + (o.symbol || o.asset)).join(', ')
      : 'Simulated: no balance changes'
  }
  if (sc.rule && sc.rule.reason) return sc.rule.reason
  return null
}

function link(label, url, quiet) {
  const button = el('button', quiet ? 'quiet' : '', label)
  button.addEventListener('click', () => { app.openLink({ url }) })
  return button
}

// Written only on a change of status, so a poll that brings the same one does not replay the motion.
function pose(status) {
  otto.hidden = false
  if (otto.dataset.status === status) return
  otto.dataset.pose = POSE[status] || 'rest'
  otto.dataset.status = status
}

function render(sc) {
  root.replaceChildren()
  pose(String(sc.status))
  const card = el('div', 'card')
  const status = STATUS[sc.status] || [String(sc.status || 'Unknown'), '']
  const top = el('div', 'top')
  top.append(el('span', 'brand', 'OTTOPUS PLAN'), el('span', 'badge ' + status[1], sc.statusLabel || status[0]))
  card.append(top, el('div', 'summary', sc.summary || 'A plan'))

  const rows = el('dl')
  const add = (term, value) => { if (value) rows.append(el('dt', '', term), el('dd', '', value)) }
  add('Wallet', walletOf(sc))
  add('Why', sc.reason)
  add('Route', sc.route)
  if (sc.feesUsd && sc.feesUsd !== 'unknown') add('Fees', '$' + sc.feesUsd)
  add('Simulation', simulationOf(sc) || (sc.reviewUrl ? 'Runs on the review page before you sign' : null))
  if (sc.expiresAt && !sc.txHash && !sc.terminal) add('Expires', new Date(sc.expiresAt).toLocaleString())
  add('Transaction', sc.txHash)
  if (rows.childElementCount) card.append(rows)

  if (sc.outcome) card.append(el('p', 'outcome', sc.outcome))

  const notes = []
  for (const reason of sc.reasons || []) notes.push(['block', reason])
  for (const w of sc.warnings || []) if (!(sc.reasons || []).includes(w.message)) notes.push([w.severity === 'block' ? 'block' : '', w.message])
  if (notes.length) {
    const list = el('ul')
    for (const [cls, message] of notes) list.append(el('li', cls, message))
    card.append(list)
  }

  const actions = el('div', 'actions')
  if (sc.reviewUrl && sc.status !== 'blocked') actions.append(link('Open review', sc.reviewUrl, false))
  if (sc.explorerUrl) actions.append(link('View transaction', sc.explorerUrl, !!sc.reviewUrl))
  if (actions.childElementCount) card.append(actions)
  if (poll.stale) {
    card.append(el('p', 'stale', poll.okAt
      ? 'Last updated ' + new Date(poll.okAt).toLocaleTimeString() + '. Still trying.'
      : 'Could not check for updates. Still trying.'))
  }
  root.append(card)
}

/**
 * Follow the plan until plan_status says it is over. Quick at first, when a
 * signature is likeliest, then backing off to every 30s; a change of status
 * starts the quick steps again. The server says when to stop (terminal), so
 * the card keeps no list of its own. A refusal from the server is final; a
 * host or network failure only marks the card stale and tries again.
 */
const DELAYS = [2000, 3000, 5000, 8000, 13000, 20000, 30000]
const MAX_POLLS = 240
const poll = { plan: null, timer: 0, step: 0, count: 0, okAt: 0, stale: false }

function follow(sc) {
  clearTimeout(poll.timer)
  Object.assign(poll, { plan: sc, step: 0, count: 0, okAt: Date.now(), stale: false })
  render(sc)
  next()
}

function next() {
  const plan = poll.plan
  const caps = app.getHostCapabilities()
  if (!plan || !plan.planId || plan.terminal || !(caps && caps.serverTools) || poll.count >= MAX_POLLS) return
  poll.timer = setTimeout(check, DELAYS[Math.min(poll.step, DELAYS.length - 1)])
}

async function check() {
  const plan = poll.plan
  poll.count += 1
  let result
  try {
    result = await app.callServerTool({ name: 'plan_status', arguments: { planId: plan.planId } })
  } catch {
    if (poll.plan !== plan) return
    poll.stale = true
    poll.step += 1
    render(plan)
    return next()
  }
  // A newer tool result took over while this one was out.
  if (poll.plan !== plan) return
  const view = result && result.structuredContent
  if (result.isError || !view || view.planId !== plan.planId) return
  poll.step = view.status === plan.status ? poll.step + 1 : 0
  poll.plan = Object.assign({}, plan, view)
  poll.okAt = Date.now()
  poll.stale = false
  render(poll.plan)
  next()
}

function theme(ctx) {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles && ctx.styles.variables) applyHostStyleVariables(ctx.styles.variables)
}

app.ontoolresult = (result) => {
  const sc = result.structuredContent
  if (sc && typeof sc === 'object') return follow(sc)
  clearTimeout(poll.timer)
  poll.plan = null
  const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  root.replaceChildren(el('div', 'card', text || 'No plan in this reply.'))
}
app.onhostcontextchanged = theme
app.connect().then(() => theme(app.getHostContext()))
`

export function planCardHtml(client: string = appClient()): string {
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Ottopus plan</title>',
    `<style>${CSS}${MASCOT_CSS}</style>`,
    // Otto sits outside #card: render() rebuilds the card, and rebuilding him would restart his motion.
    `</head><body><div class="frame">${MASCOT_HTML}<div id="card"></div></div>`,
    // Two scripts, not one: the minified client's top-level names would collide with the card's.
    `<script type="module">${client}</script>`,
    `<script type="module">${SCRIPT}</script>`,
    '</body></html>',
  ].join('\n')
}

export function registerPlanCard(server: McpServer): void {
  registerAppResource(
    server,
    'Ottopus plan card',
    PLAN_CARD_URI,
    { description: 'A prepared plan: what it does, the wallet and why, and where it stands.' },
    async () => ({ contents: [{ uri: PLAN_CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: planCardHtml() }] }),
  )
}
