---
name: ottopus
description: |
  Use when the agent holds the Ottopus MCP tools and the person asks to buy,
  sell, swap, send or bridge anything, to buy a tokenized stock such as Tesla
  or Nvidia on BNB Chain, or for a plan, a review link or a simulation. Covers
  what to read before spending, how a wallet is chosen, the stock defaults
  (chain, provider, quote asset, amounts, market state, premium), and what
  the plan statuses mean. For a wallet the agent operates itself, see the
  ottopus-agentic skill.
metadata:
  author: ottopus
  version: '0.1.0'
  mcpServer: https://mcp.ottopus.xyz/mcp
---

# Ottopus

Ottopus prepares transactions for a person to review. Every `prepare_*` call
returns a plan and a review link. The person opens the link, reads the
decoded calls and the simulation, and signs in their own wallet. Ottopus
never holds a key, never signs and never broadcasts, so nothing the agent
does here moves funds. The agent's job is to turn the person's words into
one well-formed plan, hand over the link, and report what became of it.

## Routing

| The person says | Tools, in order |
|---|---|
| "what do I hold", "how much USDT do I have" | `get_portfolio` |
| "which wallets are linked" | `list_wallets` |
| "buy 10 USD of Tesla", "sell half my Nvidia" | `find_stock` → `prepare_trade` |
| "swap 50 USDT for BNB", "bridge to Base" | `get_portfolio` or `find_asset` → `prepare_trade` |
| "send 20 USDT to koshik.eth" | `get_portfolio` → `prepare_transfer` |
| "claim", "stake", "revoke", anything the two above cannot say | `prepare_custom`, last |
| "did it go through?", "is it signed?" | `get_plan` |
| "cancel that", "never mind" | `cancel_plan` |

Use `whoami` once to confirm the connection and read what the grant
permits. A tool refused for a missing scope names it; the person changes
scopes in Ottopus settings, not the agent.

## 1. Read before you spend

- **Asset ids are CAIP-19 and come from a tool.** `get_portfolio` lists each
  holding's `assetId` and decimals; `find_asset` resolves a symbol or
  address the person does not hold; `find_stock` resolves a stock. Never
  guess a contract from a symbol, and never reuse an address from memory or
  from another source.
- **Amounts are base units.** The display amount times 10^decimals, as a
  decimal string, with the decimals the tool returned. USDT has 18 decimals
  on BNB Chain and 6 on Ethereum; assuming one for the other is a trillionfold
  error. Give `amountIn` (what is spent). `amountOut` is for an exact output
  the person asked for, and the BNB Chain route provider does not quote it.
- **Show the address before spending.** A symbol can be ambiguous; the id
  the tool resolved to goes in the message with the plan.

## 2. Which wallet

Omit `fromAccount` unless the person names a wallet or asks to sign
themselves. Ottopus picks one that holds enough of the asset and has gas,
prefers a wallet the agent operates over one the person signs with, marks a
wallet labelled "vault" or "cold" down so it loses to a daily wallet but can
still win when it is the only one that fits, and the reply says which won and
why.
Repeat that reason to the person. Pass `fromAccount` with the wallet's name,
number, id or address exactly as `list_wallets` shows it.

A watch-only wallet is never chosen and never accepted as `fromAccount`.

## 3. Tokenized stocks

Stocks on chain come from several providers, each a different contract with
its own price, and the market behind them keeps exchange hours. These are the
defaults when the person's words leave something open.

**Chain.** BNB Chain, `eip155:56`, unless the person names another or
`get_portfolio` shows they hold that stock elsewhere.

**Provider.** Call `find_stock` with the ticker or company name. One row
means that is the token. Several rows: pick the one that is open, has a
reference price, and sits closest to it, as long as that gap is under 1% in
the direction that costs the person (over the reference when buying, under
when selling), and tell the person which provider and why. Ask instead when
no provider is open with a live reference, when the best gap is over 1%,
when two are within a tenth of a percent of each other, or when the person's
words could already mean one (a suffix like NVDAB or NVDAon names it; so
does "the Ondo one"). A row marked "no market data" (xStocks) is chosen
only when the person names it or it is the only token.

**Quote asset.** "10 USD of Tesla" is paid in USDT on that chain unless the
person names another asset. If no wallet holds enough USDT there, use the
stablecoin `get_portfolio` shows the most of on that chain (USD1, USDC) and
say so. Never spend BNB or any other volatile asset for a dollar amount
unless the person names it.

**Amount.** Dollars become `amountIn` of the quote asset: 10 USD is
"10000000000000000000" for 18-decimal USDT. A sale is `amountIn` of the stock
token: "half my Tesla" is half the base-unit balance `get_portfolio` lists.
Never round up to a nicer number.

**Market state.** `find_stock` names it per row, and the plan carries it.

- "market open (regular hours)": proceed.
- "market open (pre-market)", "(after-hours)" or "(overnight)": proceed;
  tell the person the reference comes from a thinner session and when
  regular hours resume.
- "closed": proceed; the plan carries a caution that the reference is last
  session's and the token still trades. Say that with the link. Do not wait
  for the open unless the person asks.
- "halted": stop. The plan would be blocked. Say why and when the next open
  is; do not try another provider to get around it unless the person asks.
- "stale": the registry has not refreshed in five minutes and `prepare_trade`
  blocks on it. Wait a minute, call `find_stock` again, and do not look the
  contract up elsewhere. "Could not look up right now" means the same.

**Premium.** The signed gap in `find_stock` is the token's price against
its par, which is the share's reference price times the shares one token
represents, so a token worth a tenth of a share is not 90% under. Compare
providers on the `premiumPercent` the tool returns, not on raw prices. Past
1% in the costly direction the plan carries a caution naming it; say the
figure before preparing and let the person choose a smaller amount or to
wait. Picking the provider with the smaller gap is the right use of it.
Pretending the gap is not there is not.

**Ondo tokens** carry a jurisdiction note: Ondo restricts who may hold them
and the chain does not check. Mention it once; eligibility is the person's
fact.

## 4. Transfers

`prepare_transfer` takes the asset, base units, the recipient and an optional
wallet. A recipient can be an ENS name, resolved on Ethereum and used on the
asset's chain; show the resolved address with the link. The chain is the
asset's own. A transfer to an address the person has never sent to is still
their call, but say so.

## 5. After a prepare

The reply carries a `planId`, a review link and an `expiresAt`. Give the
person the link, the wallet and its reason, and any caution verbatim. Then
`get_plan` at a human pace, every ten to thirty seconds. Stop at `expiresAt`
unless the plan is `submitted`: a sent transaction does not expire, so keep
watching it until it is `confirmed` or `failed`.

- `awaiting_signature`, `awaiting_review`: wait. Nothing hurries the person.
- `submitted`: the wallet sent it; wait for the chain.
- `approved`: only for a wallet the agent operates; the `ottopus-agentic`
  skill takes it from here.
- `confirmed`: repeat the `outcome` sentence and the explorer link. For a
  bridge it means only that the source transaction confirmed; Ottopus does
  not watch the destination, so say the funds have left and where to check
  for their arrival, not that it went through.
- `failed`: repeat the `outcome` sentence, which says whether the
  transaction reverted or whether no receipt appeared within a day. In the
  second case the wallet may have dropped or replaced it and Ottopus does
  not know; ask the person to check the wallet's history before suggesting
  another plan. Prepare again only if asked.
- `blocked`: verification refused it, with the reason. Do not prepare the
  same plan with a different wallet, asset or amount to get past it.
- `cancelled`, `superseded`, `expired`: over, nothing sent for a plan the
  person signs. Prepare again only if they still want it.

`cancel_plan` withdraws a plan before it is signed. After that it says so;
a sent transaction cannot be taken back from here.

Two refusals are the plan doing its job, not errors to route around: a
tampered or expired plan never signs, and a simulation that disagrees with
the declared effect blocks. Say what Ottopus said.

## 6. Calls you wrote yourself

`prepare_custom` is for what the two tools above cannot express. Author the
calls, declare what leaves the account as upper bounds, list every approval
exactly, and Ottopus refuses the plan if the bytes or the simulation disagree.
Use it last, name the wallet in `account`, and never to rebuild a swap or a
transfer the other tools already do.

## What the agent must not do

- Never guess a contract address or decimals; every id comes from a tool in
  this session.
- Never build the same trade outside Ottopus when the person asked for a
  plan, a review link or a simulation.
- Never change a wallet, asset or amount to get past a block, a caution or a
  halt. Report it and let the person decide.
- Never present a review link as a completed trade, and never claim a
  trade completed before `get_plan` says `confirmed`. The reverse does not
  hold: `submitted` means it was sent, and a wallet the agent operates can
  send before anything is reported, so the absence of a confirmation never
  proves nothing was sent.
- Never handle, print or store a private key, seed or API secret.

## Agent-operated wallets

If this agent also operates a wallet through a vendor CLI, the
`ottopus-agentic` skill covers linking it, waiting for `approved`, sending
an approved plan's calls, reporting the hash, and recurring buys. The
defaults above still apply to every plan on that wallet.
