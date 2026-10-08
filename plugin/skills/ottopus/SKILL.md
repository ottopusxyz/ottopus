---
name: ottopus
description: |
  Use when the agent holds the Ottopus MCP tools and the person asks to buy,
  sell, swap, send or bridge anything, to buy a tokenized stock such as Tesla
  or Nvidia on BNB Chain, or for a plan, a review link or a simulation. Covers
  what "buy", "sell", "swap" and "send" each mean, the stablecoin default when
  one side of a trade is unnamed, what to read before spending, how a wallet
  is chosen, the stock defaults (chain, provider, quote asset, amounts, market
  state, premium), and what the plan statuses mean. For a wallet the agent operates itself, see the
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

Everything below is a default, not a gate. Nothing here adds a refusal the
tools do not already make: a plan the person can read and decline on the
review page beats a question, and a plan verification refuses comes back
`blocked` with its reason, which is itself an answer. Where this skill says
ask, the words left a real choice open; a plain instruction from the person
settles it.

## Routing

| The person says | Tools, in order |
|---|---|
| "what do I hold", "how much USDT do I have" | `get_portfolio` |
| "which wallets are linked" | `list_wallets` |
| "buy 10 USD of Tesla", "sell half my Nvidia" | `find_stock` → `prepare_trade` |
| "buy 0.1 BNB", "swap 50 USDT for BNB", "bridge to Base" | `get_portfolio` or `find_asset` → `prepare_trade` |
| "send 20 USDT to koshik.eth" | `get_portfolio` → `prepare_transfer` |
| "claim", "stake", "revoke", anything the two above cannot say | `prepare_custom`, last |
| "did it go through?", "is it signed?" | `get_plan` |
| "cancel that", "never mind" | `cancel_plan` |

Use `whoami` once to confirm the connection and read what the grant
permits. A tool refused for a missing scope names it; the person changes
scopes in Ottopus settings, not the agent.

## 1. What the words mean

A trade has a side that is spent, a side that is received, and an amount on
one of them. Read all three from the person's words before picking an asset.

| The person says | Spend | Receive | Amount is on |
|---|---|---|---|
| "buy 50 USDT of BNB", "put 50 USDT into BNB", "get BNB with 50 USDT" | USDT | BNB | the spend side |
| "buy 0.1 BNB", "buy 2 Tesla", "pick up some NVDA" | open | that asset | the receive side |
| "sell 0.1 BNB", "cash out my Tesla", "take profit on NVDA", "dump it" | that asset | open | the spend side |
| "swap A for B", "convert A to B", "trade A into B", "exchange A for B" | A | B | whichever is named |
| "move 100 USDT to Base", "bridge my USDT" | the asset | the same asset on the other chain | the spend side |
| "send", "pay", "transfer 20 USDT to koshik.eth" | that asset | the recipient, not the wallet: `prepare_transfer`, never a trade | the spend side |

**An open side is a stablecoin.** When the person says what to buy but not
what to pay with, pay with a stablecoin held on that chain: USDT when a
wallet holds enough of it for the amount, else the stablecoin with the
largest holding that covers it (USDC, USD1, FDUSD, whatever `get_portfolio`
lists), compared by the dollar `value` shown, not by raw balance. When they
say what to sell but not what to receive, receive USDT on that chain; it need
not be held already. BNB or another volatile asset goes on an open side only
when the person names it, or when no stablecoin on that chain can pay: then
spend the largest holding there that can, so the person gets a plan rather
than a dead end. Either way, say which asset was chosen in the same sentence
as the link, and the person declines on the review page if that is not what
they meant. One exception to that last step: a plan on an agent-operated
wallet under the auto-execute rule skips the review page. When such a plan
spends a volatile asset the person did not name, tell them which one before
fetching its calls with `get_plan`; their next word decides between sending
and `cancel_plan`. A plan the person signs or approves themselves needs no
such pause.

**The amount goes in `amountIn`.** Both route providers quote by what goes
in and refuse `amountOut`, so when the amount is on the receive side ("buy
0.1 BNB", "buy 2 Tesla") turn it into a spend with the price the tool
returned: `find_stock` gives each row's `tokenPriceUsd`, `find_asset` gives
`priceUsd`, and `get_portfolio` gives each holding's dollar `value` beside
its `amount`, so a unit price is value over amount. Turning a receive-side
quantity into a spend takes both assets' prices. Say the plan spends about
that much for about that many; the quote's minimum received is the floor the
person signs. "Half", "a third" and "all" are fractions of the `amount`
`get_portfolio` shows, which is a display amount with thousands separators,
cut (not rounded) at four decimals: take the fraction of that, then multiply
by 10^decimals for `amountIn`. Because it is cut, "all" never overshoots the
real balance. "All" of the chain's own coin still leaves gas behind, since a
wallet spending its whole native balance is not eligible; say how much
stayed. "Some" and "take profit" name no amount, and the table supplies
none; a plan needs a number, so ask for one.

## 2. Read before you spend

- **Asset ids are CAIP-19 and come from a tool.** `get_portfolio` lists each
  holding's `assetId` and decimals; `find_asset` resolves a symbol or
  address the person does not hold; `find_stock` resolves a stock. Never
  guess a contract from a symbol, and never reuse an address from memory or
  from another source.
- **Amounts are base units.** The display amount times 10^decimals, as a
  decimal string, with the decimals the tool returned. USDT has 18 decimals
  on BNB Chain and 6 on Ethereum; assuming one for the other is a trillionfold
  error. Always give `amountIn`, what is spent; neither route provider quotes
  by `amountOut` today, and a plan asked for that way is refused.
- **Show the address before spending.** A symbol can be ambiguous; the id
  the tool resolved to goes in the message with the plan.

## 3. Which wallet

Omit `fromAccount` unless the person names a wallet or asks to sign
themselves. Ottopus picks one that holds enough of the asset and has gas,
prefers a wallet the agent operates over one the person signs with, marks a
wallet labelled "vault" or "cold" down so it loses to a daily wallet but can
still win when it is the only one that fits, and the reply says which won and
why.
Repeat that reason to the person. Pass `fromAccount` with the wallet's name,
number, id or address exactly as `list_wallets` shows it.

A watch-only wallet is never chosen and never accepted as `fromAccount`.

## 4. Tokenized stocks

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
person names another asset, and a sale is paid out in USDT. The stablecoin
rule in section 1 covers the rest: the stablecoin with the largest
sufficient holding when USDT is short, BNB for a dollar amount only when
named or when nothing else can pay, and say which was used.

**Amount.** Dollars become `amountIn` of the quote asset: 10 USD is
"10000000000000000000" for 18-decimal USDT. A sale is `amountIn` of the stock
token: "half my Tesla" is half the `amount` `get_portfolio` shows for it,
turned into base units with its decimals. Never round up to a nicer number.

**Market state.** `find_stock` names it per row, and the plan carries it.

- "market open (regular hours)": proceed.
- "market open (pre-market)", "(after-hours)" or "(overnight)": proceed;
  tell the person the reference comes from a thinner session and when
  regular hours resume.
- "closed": proceed; the plan carries a caution that the reference is last
  session's and the token still trades. Say that with the link. Do not wait
  for the open unless the person asks.
- "halted": `prepare_trade` returns the plan `blocked`, naming the halt.
  Pass that on with the next open if `find_stock` gave one; do not try
  another provider to get around it unless the person asks.
- "stale": the registry has not refreshed in five minutes and `prepare_trade`
  blocks on it. Wait a minute and call `find_stock` again; if it is still
  stale, say so rather than looking the contract up elsewhere. "Could not
  look up right now" means the same.

**Premium.** The signed gap in `find_stock` is the token's price against
its par, which is the share's reference price times the shares one token
represents, so a token worth a tenth of a share is not 90% under. Compare
providers on the `premiumPercent` the tool returns, not on raw prices. Past
1% in the costly direction the plan still prepares and carries a caution
naming it; say the figure beside the link, and the person can sign, pick a
smaller amount, or wait. Picking the provider with the smaller gap is the
right use of it. Pretending the gap is not there is not.

**Ondo tokens** carry a jurisdiction note: Ondo restricts who may hold them
and the chain does not check. Mention it once; eligibility is the person's
fact.

## 5. Transfers

`prepare_transfer` takes the asset, base units, the recipient and an optional
wallet. A recipient can be an ENS name, resolved on Ethereum and used on the
asset's chain; show the resolved address with the link. The chain is the
asset's own. A transfer to an address the person has never sent to is still
their call, but say so.

## 6. After a prepare

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

## 7. Calls you wrote yourself

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
