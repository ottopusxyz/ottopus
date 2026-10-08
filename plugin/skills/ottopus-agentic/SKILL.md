---
name: ottopus-agentic
description: |
  Use when the agent holds the Ottopus MCP tools and also operates a wallet
  through a vendor CLI such as Binance Agentic Wallet (baw): linking that
  wallet to the person's Ottopus account, waiting for a plan to be approved,
  and sending an approved plan's calls from the agent's own wallet. Also use
  when the person asks for a plan, a review link, a simulated trade, a
  tokenized stock, or any Ottopus prepare_* tool, and the agent is tempted to
  trade with the wallet CLI directly instead.
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

For a plan bound to a wallet the agent operates, the review page shows
**Approve** instead of a wallet signature. If the person has turned on
auto-execute for that wallet in settings, Ottopus approves the plan itself
after verification and a passing simulation, and `get_plan` says
"approved by your rule".

Poll `get_plan` with the `planId`. Read the `status`:

- `awaiting_review`, `awaiting_signature`: wait. Do not ask for the calls; they
  are not released, and asking does not hurry the person.
- `approved`: the reply now carries the calls. Go to executing.
- `cancelled`, `expired`, `blocked`, `superseded`: over. Nothing was sent. Tell
  the person; prepare again only if they still want it.

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
  reason. Then poll `get_plan` for `confirmed` or `failed`.

The first `get_plan` that returns calls is recorded, and the plan can no longer
be cancelled after it. Reading again returns the same calls with
`alreadyHandedOff: true`; that is for a lost run, not a reason to send twice.

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
6. A preview's request id expires. If execute reports an expired preview, run
   the same preview again, show it again, then execute the new request id.

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
