---
name: ottopus-agentic
description: |
  Use when the agent holds the Ottopus MCP tools and also operates a wallet
  through a vendor CLI such as Binance Agentic Wallet (baw): linking that
  wallet to the person's Ottopus account, waiting for a plan to be approved,
  and sending an approved plan's calls from the agent's own wallet. Also use
  when the person asks for a plan, a review link, a simulated trade, a
  tokenized stock, or any Ottopus prepare_* tool, and the agent is tempted to
  trade with the wallet CLI directly instead. Also use when the person wants a
  recurring buy, a DCA, or any trade on a schedule.
metadata:
  author: ottopus
  version: '0.1.0'
  mcpServer: https://mcp.ottopus.xyz/mcp
  providers: binance
---

# Ottopus with an agent-operated wallet

Ottopus prepares transactions for a person to review. It never holds a key,
never signs and never broadcasts. An agent that also operates a wallet through
a vendor CLI meets Ottopus at three moments: it **links** that wallet by
signing a challenge, it **waits** for the person (or a rule the person set) to
approve a plan, and it **executes** the approved plan's calls from its own
wallet, then reports the transaction hash back.

The rule that holds through all three: the plan is the trade. When the person
asks for a plan, a review link, or any Ottopus `prepare_*` tool, do not build
the same trade with the wallet CLI's own swap, send or order commands. Those
skip the review, the decoder and the simulation the person asked for.

## Routing

| Moment | What the person says | Ottopus tool | Then, with the wallet CLI |
|---|---|---|---|
| Link | "link my agent wallet", "connect the wallet you operate to Ottopus" | `link_agent_wallet_start` → `link_agent_wallet_finish` | sign the EIP-712 challenge |
| Prepare | "buy 10 USD of Tesla", "swap", "send", "bridge" | `find_stock` / `find_asset` → `prepare_trade` / `prepare_transfer` / `prepare_custom` | nothing: hand over the review link |
| Wait | "did it go through?", "is it approved?" | `get_plan` | nothing until the status is `approved` |
| Execute | status `approved` on a wallet this agent operates | `get_plan` (returns the calls) → `report_execution` | preview, show, execute each call in order |
| Withdraw | "cancel that", "never mind" | `cancel_plan` | nothing |

Providers covered below: [Binance Agentic Wallet](#binance-agentic-wallet-baw).
A wallet from another vendor follows the same three moments; `get_plan` and
`link_agent_wallet_start` carry that vendor's exact commands in their replies.

## 1. Linking

Linking proves which address the agent operates. It moves nothing and
approves nothing. It needs the `wallets:write` scope, which is off unless the
person ticked it on the consent page; a refusal naming that scope means the
person has to reconnect the agent and allow it.

1. Get the wallet's address from its CLI.
2. Call `link_agent_wallet_start` with the provider id and the address. The
   reply carries a `challengeId`, an expiry (ten minutes), the EIP-712 typed
   data, and the exact steps for signing it with that provider's CLI.
3. Sign the typed data with the wallet itself, following those steps. Show the
   person what the CLI parsed before executing the signature.
4. Call `link_agent_wallet_finish` with the `challengeId` and the signature.
   If the signature recovers to the address, the wallet is linked and appears
   in `list_wallets` and in the person's settings.

A challenge works once. A wrong signer, a replay or an expired challenge is
refused with the reason; start again from step 2. An address already linked
as another kind of wallet is refused: the person unlinks it in settings first.

## 2. Preparing and waiting for approval

Prepare the plan as for any wallet: `find_stock` or `find_asset` to resolve
the asset, then `prepare_trade`, `prepare_transfer` or `prepare_custom`. The
reply carries a `planId` and a review link. Give the person the link.

When the person names no wallet, Ottopus picks one, and it prefers a wallet
the agent executes over one the person signs with, as long as it holds enough
of the asset and has gas. A plan on that wallet needs an approval, not a
signature, and none at all under the auto-execute rule. The reply's reason
says which wallet won and why the others lost; repeat it to the person. Pass
`fromAccount` only when the person names a wallet, or asks to sign it
themselves. A wallet that cannot pay the amount is never chosen for being
agent-operated, and a label like "vault" still keeps it out.

For a plan bound to a wallet the agent operates, the review page shows
**Approve** instead of a wallet signature. If the person has turned on
auto-execute for that wallet in settings, the `prepare_trade` or
`prepare_transfer` reply itself says the plan was approved by the rule, after
verification and a passing simulation, and that no review is needed. Still
give the person the link: they can withdraw the plan until its calls are
handed out. `prepare_custom` always needs a review, whatever the toggle says.

Poll `get_plan` with the `planId`. Read the `status`:

- `awaiting_review`, `awaiting_signature`: wait. Do not ask for the calls; they
  are not released, and asking does not hurry the person.
- `approved`: the reply now carries the calls. Go to executing.
- `cancelled`, `blocked`, `superseded`: over. Nothing was sent. Tell the
  person; prepare again only if they still want it.
- `expired`: over, but not always "nothing was sent". If the calls had already
  been handed out, `get_plan` says so, and Ottopus cannot know whether the
  wallet sent them. Check the wallet's transaction history before telling the
  person, and do not prepare the same trade again until that is settled.

Poll at a human pace, every ten to thirty seconds, and stop at the plan's
`expiresAt`. An expired plan never becomes approved.

## 3. Executing

Once `get_plan` returns `calls`, the agent's wallet sends them. The reply also
carries `planHash`, `from`, and `execute.steps`: the provider's exact commands,
one preview and one execute per call. Follow them as written.

- **In order, one at a time.** Do not start a call until the one before it has
  a transaction hash and, for a multi-call plan, has confirmed on chain. An
  approval before a swap is the usual two-call shape.
- **Exactly as given.** Do not change `to`, `value` or `data`, do not add gas
  options, do not merge or reorder calls. These are what the person approved.
- **Preview, show, then execute.** Every provider CLI covered here previews a
  call before sending it. Show the person the preview's parsed transaction,
  simulation result and risks before the execute step.
- **A refused preview ends the attempt.** If the preview is rejected or returns
  no request id, stop, keep the remaining calls unsent, and tell the person
  what the CLI said. Do not retry with different parameters and do not send
  the trade another way.
- **Report the hash.** When the last call has a transaction hash, call
  `report_execution` with the `planId` and that hash, before `expiresAt`.
  Ottopus checks that the transaction came from the plan's wallet, on the
  plan's chain, carrying the approved call; anything else is refused with the
  reason. `reported: true` means it is on record: poll `get_plan` for
  `confirmed` or `failed`. `reported: false` with "not recorded yet" means
  the chain has not seen the hash or could not be read: wait a few seconds
  and report the same hash again, before `expiresAt`. Never send again to get
  a hash Ottopus will take.

The first `get_plan` that returns calls is recorded, and the plan can no longer
be cancelled after it. Reading again returns the same calls with
`alreadyHandedOff: true`; that is for a lost run, not a reason to send twice.

## Recurring intents: DCA and other schedules

Ottopus never schedules anything. The clock is the agent's: a recurring buy
is the agent's own scheduler running the same intent on a cadence, and every
run is a fresh plan with its own `planHash`, review link and `expiresAt`.
There is no standing order on the Ottopus side to edit or cancel; stopping the
schedule is done in the host that runs it.

Setting one up:

1. Ask the person to turn on auto-execute for the agent-operated wallet in
   Ottopus settings. Without it every run stops at a review link, which is
   allowed, but then the schedule only produces links, and nothing is bought
   until the person approves each one.
2. Create a job in the host's scheduler with the intent in plain words and the
   rules below, for example: "Buy 25 USD of Tesla with USDT on BNB Chain
   through Ottopus from the wallet you operate. If the plan is approved,
   execute its calls and report the hash. If it needs a review, send me the
   link and stop."
3. Each run follows sections 2 and 3 as written: resolve the asset, prepare,
   read whether the reply says the rule approved it, then `get_plan`, execute
   and `report_execution`. The `get_plan` reply names the wallet; it should
   be the agent's own.

Rules that hold on every run:

- **One open plan per schedule.** Before preparing, check the previous run's
  plan with `get_plan`. If it is still `approved` with calls handed out, or
  `expired` with the wallet's history not yet checked, do not prepare again;
  tell the person instead.
- **A refused run ends that run, not the schedule.** A `blocked` plan, a
  failed simulation or a refused preview means skip today and report it.
  Never retry with a different amount, asset or wallet to make the run go
  through.
- **The person's words set the size.** Never raise the amount to catch up a
  missed run, and never add runs.
- **Say how to stop.** Turning off auto-execute in settings makes every later
  run wait for a review; removing the job in the host stops the runs.

Where to schedule, by host:

| Host | Scheduler |
|---|---|
| Claude Code | `/schedule` creates a routine on a cron schedule that runs this skill with the Ottopus MCP server connected; `/loop <interval> <prompt>` repeats inside a live session |
| Codex | an automation in the Codex app, with the intent as its prompt and the Ottopus MCP server configured for that workspace |
| Hermes Agent | `/cron add` in chat, or `hermes cron create` with a cron expression; the Hermes gateway must be running for jobs to fire |
| OpenClaw | `openclaw cron add` with a name, a cron expression and the intent as the message; runs in the Gateway and can deliver the result to a chat channel |

Whichever host, the job's prompt should name this skill and the Ottopus
tools, so a fresh session on the schedule does not fall back to the wallet
CLI's own order commands.

## What the agent must not do

- Never ask `get_plan` for calls before the status is `approved`, and never
  try to reconstruct them from the plan summary.
- Never send a call twice. If a run was lost, check the wallet's transaction
  history before touching an already-handed-off plan.
- Never substitute a different action when execution fails: no swap through
  the CLI's own order commands, no transfer to "make it right". Report through
  `report_execution` if a hash exists, otherwise tell the person and stop.
- Never report a hash that is not the plan's own transaction; Ottopus refuses
  it and the plan stays open.
- Never handle, print or store a private key, seed or API secret. The vendor
  CLI holds the key; Ottopus and the agent only ever see addresses,
  signatures and hashes.

## Binance Agentic Wallet (`baw`)

Provider id for `link_agent_wallet_start`: `binance`. Chains: BNB Chain
(`56`), Ethereum (`1`), Base (`8453`).

### Preconditions

Both signing and contract calls need Developer Mode, which is enabled only in
the Binance App. Check before starting either flow:

```bash
baw wallet settings --json
```

If `devMode.enabled` is `false`, ask the person to enable Developer Mode in the
Binance App and stop. Do not run the preview. Get the address with
`baw wallet address --json`.

### Linking: sign the challenge

`link_agent_wallet_start` returns the typed data. `baw` signs it as a whole
`eth_signTypedData_v4` request with the typed data as a JSON string inside.
The chain id only tells the CLI which network the wallet is on; do not add it
to the typed data.

```bash
# 1. Preview. <request> is {"method":"eth_signTypedData_v4","params":["<address>","<typed data as a JSON string>"]}
baw sign-message preview --binanceChainId 56 --signType EIP712 --message '<request>' --json

# 2. Show the person parsedMessage and risks from the preview, then execute with its requestId.
baw sign-message execute --requestId <requestId> --json

# 3. If the status is PENDING_CONFIRMATION the person confirms in the Binance App, then:
baw sign-message result --order-id <orderId> --json
```

The result has `signature` and `signatureRecovery`, both without `0x`. The
value to pass to `link_agent_wallet_finish` is `0x` + `signature` +
`signatureRecovery` as one hex string.

### Executing: one preview and one execute per call

`get_plan` returns the preview command for each call, already filled in. The
shape is:

```bash
baw contract-call preview --binanceChainId 56 --from <wallet> --to <to> --value <wei> --inputData <data> --json
```

`--value` is omitted when the call sends no native value and `--inputData` when
it has no calldata. Do not pass gas options; the backend estimates them.

For each call, in order:

1. Run the preview exactly as `get_plan` wrote it.
2. Show the person `parsedTx`, `simulationResult` and `risks`.
3. If the preview is refused (`AGENT_DEV_MODE_RISK_BLOCKED`, a simulation
   failure, or no `requestId`), stop and say so. Do not retry it another way.
4. Execute:

   ```bash
   baw contract-call execute --requestId <requestId> --json
   ```

5. `BROADCASTED` carries the `txHash`. `PENDING_CONFIRMATION` means the person
   confirms in the Binance App first; the hash is then in
   `baw wallet tx-history --json`.
6. A preview's request id expires. If execute reports an expired preview,
   check the plan's `expiresAt` first. If the plan still has time, run the
   same preview again, show it again, then execute the new request id. If the
   plan has expired, stop: an expired plan takes no report, and anything sent
   now would be outside what the person approved.

When the last call has its hash, call `report_execution` with the `planId` and
that hash.

### Never, with `baw`

- Never run `market-order swap`, `limit-order buy`, `limit-order sell` or
  `wallet send` to carry out something the person asked Ottopus to plan. The
  plan's calls are the trade.
- Never run `contract-call execute` with a request id from a preview the
  person has not seen.
- Never speed up, cancel or replace a plan's transaction through
  `wallet speed-up` or `wallet cancel` on your own; ask the person first, and
  tell Ottopus what happened through `get_plan` and `report_execution` either
  way.
