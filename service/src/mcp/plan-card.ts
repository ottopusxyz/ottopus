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

/** The review page's tokens (web/app/globals.css), light and dark, and the web app's Button pills. */
const CSS = `
:root {
  --card: #FFFFFF; --surface-2: #F7F2EA; --surface-3: #EFE8DD; --border: #E3DBCF; --border-strong: #C4B9A8;
  --text: #16213E; --text-2: #4B556E; --text-3: #66708A; --text-4: #9AA2B8; --navy-soft: #DDE2F0;
  --coral: #F58A6A; --coral-hover: #E8724F; --coral-soft: #FFE6DC; --coral-text: #B3421F; --on-state: #16213E;
  --plan-bg: #E8F0FF; --plan-text: #1D4FB0; --warn-bg: #FFF3D6; --warn-text: #7A4E00;
  --ok-bg: #E1F6EC; --ok-text: #0E6642; --block-bg: #FDE8E8; --block-text: #A0262A; --water: #F4F7FB;
  --shadow: 0 1px 2px rgba(22,33,62,.06), 0 6px 20px rgba(22,33,62,.06);
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --card: #141D33; --surface-2: #16213E; --surface-3: #1F2D52; --border: #2B3B69; --border-strong: #41538A;
  --text: #F5F0E6; --text-2: #BFC7DB; --text-3: #8F9BBD; --text-4: #6B7796; --navy-soft: #2B3B69;
  --coral: #FF9A7A; --coral-hover: #FFAE93; --coral-soft: #4A2A22; --coral-text: #FFB9A2;
  --plan-bg: #172A4A; --plan-text: #9EC2FF; --warn-bg: #3A2B0D; --warn-text: #FFCB6B;
  --ok-bg: #10352A; --ok-text: #7BE3B8; --block-bg: #3D1A1C; --block-text: #FF9FA1; --water: #111B30;
  --shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 20px rgba(0,0,0,.25);
} }
[data-theme="dark"] {
  --card: #141D33; --surface-2: #16213E; --surface-3: #1F2D52; --border: #2B3B69; --border-strong: #41538A;
  --text: #F5F0E6; --text-2: #BFC7DB; --text-3: #8F9BBD; --text-4: #6B7796; --navy-soft: #2B3B69;
  --coral: #FF9A7A; --coral-hover: #FFAE93; --coral-soft: #4A2A22; --coral-text: #FFB9A2;
  --plan-bg: #172A4A; --plan-text: #9EC2FF; --warn-bg: #3A2B0D; --warn-text: #FFCB6B;
  --ok-bg: #10352A; --ok-text: #7BE3B8; --block-bg: #3D1A1C; --block-text: #FF9FA1; --water: #111B30;
  --shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 20px rgba(0,0,0,.25);
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2px 2px 8px; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text); background: transparent; }
.mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-variant-numeric: tabular-nums; }
.pc { background: var(--card); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow); overflow: hidden; max-width: 520px; }
.pc-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px 6px; }
.pc-head .otto { width: 48px; height: 48px; }
.pc-id { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pc-brand { font-size: 12px; font-weight: 600; color: var(--text-3); display: flex; gap: 8px; align-items: baseline; }
.pc-ref { font-size: 11px; font-weight: 400; color: var(--text-3); }
.pc-title { font: 700 17px/1.28 ui-rounded, "SF Pro Rounded", system-ui, sans-serif; letter-spacing: -.01em; margin: 0; overflow-wrap: anywhere; }
.pc-side { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; }
.chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; white-space: nowrap; background: var(--surface-3); color: var(--text-2); }
.chip.plan { background: var(--plan-bg); color: var(--plan-text); }
.chip.ok { background: var(--ok-bg); color: var(--ok-text); }
.chip.warn { background: var(--warn-bg); color: var(--warn-text); }
.chip.block { background: var(--block-bg); color: var(--block-text); }
.chip.agent { background: var(--coral-soft); color: var(--coral-text); }
.chip .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.chip.live .dot { animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .25; } }
.clock { font-size: 12px; font-weight: 600; color: var(--text-2); }
.why { margin: 0; padding: 0 16px 12px; font-size: 12.5px; color: var(--text-2); }
.water { background: var(--water); padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
.amt { display: flex; align-items: center; gap: 10px; }
.tok { width: 32px; height: 32px; border-radius: 50%; flex: none; display: grid; place-items: center; font-size: 11px; font-weight: 700; background: var(--navy-soft); color: var(--text); }
.tok.in { border-radius: 9px; background: var(--coral-soft); color: var(--coral-text); }
.amt-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.amt-num { font-size: 17px; font-weight: 600; letter-spacing: -.01em; overflow-wrap: anywhere; }
.amt-num.in { color: var(--ok-text); }
.about { font: 500 11px system-ui, sans-serif; color: var(--text-3); margin-right: 4px; }
.amt-sub { font-size: 11.5px; color: var(--text-3); }
.line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 12px; color: var(--text-2); }
.tile { width: 20px; height: 20px; border-radius: 6px; display: inline-grid; place-items: center; font-size: 10px; font-weight: 700; background: var(--navy-soft); color: var(--text); margin-right: 5px; vertical-align: middle; }
.tile.bnb { background: #F3BA2F; color: #16213E; }
.sep { color: var(--text-3); }
.verdict { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--surface-3); color: var(--text-2); }
.verdict.ok { background: var(--ok-bg); color: var(--ok-text); }
.facts { padding: 0 16px; }
.fact { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.fact:last-child { border-bottom: 0; }
.fact span { color: var(--text-2); }
.fact b { font-weight: 600; text-align: right; overflow-wrap: anywhere; }
.heads { margin: 10px 16px 0; border-radius: 10px; padding: 8px 12px; font-size: 12.5px; background: var(--warn-bg); }
.heads.block { background: var(--block-bg); }
.heads b { font-weight: 600; color: var(--warn-text); }
.heads.block b { color: var(--block-text); }
.heads span { color: var(--text-2); }
.heads ul { margin: 4px 0 0; padding-left: 18px; color: var(--text-2); }
.foot { margin-top: 12px; border-top: 1px solid var(--border); background: var(--water); padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 10px; }
.acts { display: flex; gap: 8px; flex-wrap: wrap; }
.trust { margin: 0; font-size: 11px; color: var(--text-3); text-align: center; }
.stale { margin: 0; font-size: 11.5px; color: var(--text-3); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; border-radius: 999px; font: 500 13px/1 system-ui, sans-serif; padding: 7px 14px; cursor: pointer; transition: background-color 160ms cubic-bezier(.2,.8,.2,1); }
.btn:focus-visible { outline: 2px solid var(--plan-text); outline-offset: 2px; }
.btn.primary { border: 1px solid var(--coral); background: var(--coral); color: var(--on-state); }
.btn.primary:hover { background: var(--coral-hover); border-color: var(--coral-hover); }
.btn.secondary { border: 1px solid var(--border-strong); background: var(--card); color: var(--text); }
.btn.secondary:hover { background: var(--surface-2); }
.btn.grow { flex: 1; }
.btn.out::after { content: "↗"; }
.sk { height: 10px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-3) 0%, var(--surface-2) 50%, var(--surface-3) 100%); background-size: 200% 100%; animation: sweep 1.6s linear infinite; }
@keyframes sweep { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .sk, .chip.live .dot { animation: none; } }
`

/**
 * The card's pure helpers: no DOM, no host. Inlined ahead of SCRIPT, and
 * exported so the tests can run the code the card runs.
 */
export const PLAN_CARD_HELPERS = String.raw`
// A CAIP-10 reads as its address, shortened the way the replies shorten one.
function addressOf(caip10) {
  const address = String(caip10).split(':').pop()
  return address.length > 12 ? address.slice(0, 6) + '…' + address.slice(-4) : address
}

// prepare_custom's account is already a label, "Treasury (0x1234…5678)"; only a CAIP-10 gets shortened.
function walletOf(sc) {
  if (typeof sc.recommendedAccount === 'string') return sc.recommendedAccount
  if (sc.account && typeof sc.account === 'object') return sc.account.label || addressOf(sc.account.caip10)
  if (typeof sc.account === 'string') return /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:\S+$/.test(sc.account) ? addressOf(sc.account) : sc.account
  return null
}

// A plan_status read on top of the plan so far. Its chain is {id, name}; a bridge's destination stays.
function mergeStatus(plan, view) {
  const merged = Object.assign({}, plan, view)
  if (plan.chain && view.chain) merged.chain = Object.assign({}, plan.chain, view.chain)
  return merged
}
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
const shell = document.getElementById('pc')
const otto = document.getElementById('otto')
const ref = document.getElementById('ref')
const title = document.getElementById('title')
const side = document.getElementById('side')
const root = document.getElementById('card')

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
  planning: 'busy', awaiting_review: 'ready', awaiting_signature: 'ready', approved: 'ready', submitted: 'busy',
  confirmed: 'done', failed: 'alert', blocked: 'alert', expired: 'alert',
}

// Still waiting on a person or a chain: the dot pulses and the clock runs.
const OPEN = ['awaiting_review', 'awaiting_signature', 'approved']

const TRUST = 'Ottopus never holds a key and never sends anything.'

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text != null) node.textContent = String(text)
  return node
}

// A short handle for the plan, the way the review page's header shows one.
function shortId(id) {
  return typeof id === 'string' ? '#' + id.replace(/-/g, '').slice(0, 6) : ''
}

function initial(text) {
  const match = String(text || '').match(/[A-Za-z0-9]/)
  return match ? match[0].toUpperCase() : '?'
}

function shortHash(hash) {
  return hash.length > 14 ? hash.slice(0, 6) + '…' + hash.slice(-4) : hash
}

function link(label, url, cls) {
  const button = el('button', 'btn out ' + cls, label + ' ')
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

/**
 * The head stays in the page and only its words change, so Otto, who lives
 * in it, is never rebuilt and his motion never restarts.
 */
function head(status, label, cls, live) {
  shell.hidden = false
  pose(status)
  const chip = el('span', 'chip ' + cls + (live ? ' live' : ''))
  if (live) chip.append(el('span', 'dot'))
  chip.append((cls === 'ok' ? '✓ ' : '') + label)
  side.replaceChildren(chip)
}

const clock = { timer: 0, until: 0, node: null }

function tick() {
  const left = Math.max(0, Math.round((clock.until - Date.now()) / 1000))
  const h = Math.floor(left / 3600)
  const m = Math.floor((left % 3600) / 60)
  const sec = String(left % 60).padStart(2, '0')
  clock.node.textContent = h ? h + ':' + String(m).padStart(2, '0') + ':' + sec : m + ':' + sec
  if (!left) clearInterval(clock.timer)
}

// One timer, updating one node's text: the countdown never redraws the card.
function countdown(expiresAt) {
  clearInterval(clock.timer)
  const until = Date.parse(expiresAt)
  if (!Number.isFinite(until)) return
  clock.until = until
  clock.node = el('span', 'clock mono')
  clock.node.title = 'Expires at ' + new Date(until).toLocaleTimeString()
  clock.node.setAttribute('aria-label', 'Time left to review')
  side.append(clock.node)
  tick()
  clock.timer = setInterval(tick, 1000)
}

function amount(cls, letter, num, sub, about) {
  const row = el('div', 'amt')
  const main = el('div', 'amt-main')
  const figure = el('span', 'amt-num mono' + (cls ? ' ' + cls : ''))
  if (about) figure.append(el('span', 'about', 'about'))
  figure.append(num)
  main.append(figure)
  if (sub) main.append(el('span', 'amt-sub', sub))
  row.append(el('span', 'tok' + (cls ? ' ' + cls : ''), letter), main)
  return row
}

function water(sc, wallet) {
  const box = el('div', 'water')
  const a = sc.amounts
  if (a && a.toSymbol) {
    // A trade. Never an amount the reply did not give: exact-out has no input figure.
    box.append(amount('', initial(a.fromSymbol), '−' + (a.in ? a.in + ' ' : '') + a.fromSymbol, wallet ? 'from ' + wallet : null, false))
    const floor = sc.trade === 'bridge'
      ? 'at least ' + a.atLeast + (sc.chain && sc.chain.to ? ' arriving on ' + sc.chain.to : ' on arrival')
      : 'at least ' + a.atLeast + ', or it reverts'
    box.append(amount('in', initial(a.toSymbol), '+' + a.out + ' ' + a.toSymbol, floor, true))
  } else if (a && a.symbol) {
    box.append(amount('', initial(a.symbol), '−' + a.out + ' ' + a.symbol, 'to ' + a.to, false))
  }

  const line = el('div', 'line')
  const part = (letter, text, tile, strong) => {
    const span = el('span')
    span.append(el('span', 'tile' + (tile ? ' ' + tile : ''), letter))
    span.append(strong ? el('b', '', text) : text)
    if (line.childElementCount) line.append(el('span', 'sep', '·'))
    line.append(span)
  }
  if (wallet) part(initial(wallet), wallet, '', true)
  if (sc.chain && sc.chain.name) part(initial(sc.chain.name), sc.chain.name, sc.chain.id === 'eip155:56' ? 'bnb' : '', false)
  const simulated = Array.isArray(sc.observed) || (sc.rule && sc.rule.applied)
  const verdict = simulated ? ['verdict ok', '✓ Simulated'] : OPEN.includes(sc.status) && sc.reviewUrl ? ['verdict', 'Simulates on review'] : null
  if (verdict) {
    if (line.childElementCount) line.append(el('span', 'sep', '·'))
    line.append(el('span', verdict[0], verdict[1]))
  }
  if (sc.txHash) {
    const tx = el('div', 'line')
    tx.append(el('span', '', 'Transaction'), el('span', 'mono', shortHash(sc.txHash)))
    tx.title = sc.txHash
    box.append(tx)
  }
  if (line.childElementCount) box.append(line)
  return box.childElementCount ? box : null
}

function facts(sc) {
  const list = el('div', 'facts')
  const add = (term, value, mono) => {
    if (!value) return
    const row = el('div', 'fact')
    row.append(el('span', '', term), el('b', mono ? 'mono' : '', value))
    list.append(row)
  }
  const eta = typeof sc.etaSeconds === 'number' ? ' · ~' + (sc.etaSeconds < 90 ? sc.etaSeconds + 's' : Math.round(sc.etaSeconds / 60) + ' min') : ''
  add('Route', sc.route ? sc.route + eta : null)
  if (sc.feesUsd && sc.feesUsd !== 'unknown') add('Fees', '$' + sc.feesUsd, true)
  if (typeof sc.slippageBps === 'number') add('Slippage', sc.slippageBps / 100 + '%', true)
  return list.childElementCount ? list : null
}

// The heads-up: on a live plan the count and the worst one, the full list
// being the review page's job. A refusal has no page, so every reason shows.
function headsUp(sc) {
  const reasons = sc.reasons || []
  const warnings = (sc.warnings || []).filter((w) => !reasons.includes(w.message))
  if (sc.status === 'blocked') {
    if (!reasons.length) return null
    const box = el('div', 'heads block')
    box.append(el('b', '', reasons[0]))
    if (reasons.length > 1) {
      const rest = el('ul')
      for (const reason of reasons.slice(1)) rest.append(el('li', '', reason))
      box.append(rest)
    }
    return box
  }
  if (!warnings.length) return null
  const rank = { block: 0, caution: 1, info: 2 }
  const worst = warnings.slice().sort((x, y) => (rank[x.severity] ?? 3) - (rank[y.severity] ?? 3))[0]
  const box = el('div', 'heads' + (worst.severity === 'block' ? ' block' : ''))
  box.append(el('b', '', warnings.length > 1 ? warnings.length + ' things to read first' : 'Heads up'), el('span', '', ' · ' + worst.message))
  return box
}

function why(sc) {
  if (sc.status === 'blocked') return 'Ottopus refused to build this plan.'
  if (sc.status === 'submitted' && !sc.outcome) return 'Waiting for ' + ((sc.chain && sc.chain.name) || 'the chain') + ' to confirm it.'
  if (sc.terminal || sc.status === 'submitted') return sc.outcome || null
  return sc.reason || null
}

function render(sc) {
  const status = String(sc.status)
  const known = STATUS[status] || [String(sc.status || 'Unknown'), '']
  ref.textContent = shortId(sc.planId)
  title.textContent = sc.summary || 'A plan'
  head(status, sc.statusLabel || known[0], known[1], (OPEN.includes(status) || status === 'submitted') && !sc.terminal)
  if (Array.isArray(sc.observed)) side.prepend(el('span', 'chip agent', 'Agent-crafted'))
  clearInterval(clock.timer)
  if (OPEN.includes(status) && !sc.txHash && !sc.terminal && sc.expiresAt) countdown(sc.expiresAt)

  const body = []
  const reason = why(sc)
  if (reason) body.push(el('p', 'why', reason))
  const wallet = walletOf(sc)
  const box = water(sc, wallet)
  if (box) body.push(box)
  if (OPEN.includes(status)) { const list = facts(sc); if (list) body.push(list) }
  const heads = headsUp(sc)
  if (heads) body.push(heads)

  const foot = el('div', 'foot')
  if (poll.stale) {
    foot.append(el('p', 'stale', poll.okAt
      ? 'Last updated ' + new Date(poll.okAt).toLocaleTimeString() + '. Still trying.'
      : 'Could not check for updates. Still trying.'))
  }
  const acts = el('div', 'acts')
  const review = sc.reviewUrl && status !== 'blocked'
  if (sc.explorerUrl) acts.append(link('View transaction', sc.explorerUrl, 'secondary' + (review ? '' : ' grow')))
  if (review) acts.append(link('Open review', sc.reviewUrl, sc.explorerUrl ? 'secondary' : 'primary grow'))
  if (acts.childElementCount) foot.append(acts)
  foot.append(el('p', 'trust', status === 'blocked' ? 'Nothing was prepared. There is nothing to sign.' : TRUST))
  body.push(foot)
  root.replaceChildren(...body)
}

/**
 * While a prepare_* call runs, the host may send its arguments. They are
 * the agent's raw input — asset ids and base units — so the card shows only
 * what reads as words and makes up no progress: the host sends none.
 */
function planning(args) {
  ref.textContent = ''
  const a = args || {}
  title.textContent = typeof a.summary === 'string' && a.summary
    ? a.summary
    : a.asset ? 'Preparing a transfer' : a.from ? 'Preparing a trade' : a.planId ? 'Looking up a plan' : 'Preparing a plan'
  head('planning', 'Planning', '', true)
  clearInterval(clock.timer)
  const list = el('div', 'facts')
  const add = (term, value) => {
    if (typeof value !== 'string' || !value) return
    const row = el('div', 'fact')
    row.append(el('span', '', term), el('b', '', value))
    list.append(row)
  }
  if (a.asset) add('To', a.to)
  add('Wallet', a.fromAccount || a.account)
  add('Note', a.note)
  const skeleton = el('div', 'water')
  skeleton.append(el('div', 'sk'), el('div', 'sk'))
  skeleton.firstChild.style.width = '62%'
  skeleton.lastChild.style.width = '40%'
  const foot = el('div', 'foot')
  foot.style.marginTop = '0'
  foot.append(el('p', 'trust', 'Nothing moves until it is approved on the review page.'))
  root.replaceChildren(...[el('p', 'why', 'Picking a wallet, finding a route and checking it.'), list.childElementCount ? list : null, skeleton, foot].filter(Boolean))
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
  poll.plan = mergeStatus(plan, view)
  poll.okAt = Date.now()
  poll.stale = false
  render(poll.plan)
  next()
}

function stop() {
  clearTimeout(poll.timer)
  clearInterval(clock.timer)
  poll.plan = null
}

function theme(ctx) {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles && ctx.styles.variables) applyHostStyleVariables(ctx.styles.variables)
}

app.ontoolinput = (params) => {
  // A result can beat its own input here; the plan wins.
  if (!poll.plan) planning(params && params.arguments)
}
app.ontoolcancelled = () => {
  if (poll.plan) return
  stop()
  head('cancelled', 'Stopped', '', false)
  root.replaceChildren(el('p', 'why', 'The request was stopped before a plan came back.'))
}
app.ontoolresult = (result) => {
  const sc = result.structuredContent
  if (sc && typeof sc === 'object') return follow(sc)
  stop()
  const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  ref.textContent = ''
  title.textContent = result.isError ? 'No plan was made' : 'Ottopus'
  head('failed', result.isError ? 'No plan' : 'Note', result.isError ? 'warn' : '', false)
  root.replaceChildren(el('p', 'why', text || 'No plan in this reply.'))
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
    // Otto sits in the head, outside #card: render() rebuilds the card, and rebuilding him would restart his motion.
    `</head><body><div class="pc" id="pc" hidden><div class="pc-head">${MASCOT_HTML}`,
    '<div class="pc-id"><span class="pc-brand">OTTOPUS PLAN <span class="pc-ref mono" id="ref"></span></span><h3 class="pc-title" id="title"></h3></div>',
    '<div class="pc-side" id="side"></div></div><div id="card"></div></div>',
    // Two scripts, not one: the minified client's top-level names would collide with the card's.
    `<script type="module">${client}</script>`,
    `<script type="module">${PLAN_CARD_HELPERS}${SCRIPT}</script>`,
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
