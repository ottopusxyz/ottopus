# Ottopus

**Stop juggling wallets to get one thing done.**

Tell your agent what you want, not where to find it. Ottopus works out which wallet,
which chain and which app — then shows you exactly what will happen before anything
moves.

Link your wallets once and point any MCP-capable agent at Ottopus. Say something like
*"swap 500 USDC for ETH"*, and Ottopus picks a wallet and tells you why, builds the
route, decodes and simulates it, then hands you a review link. You open the link,
connect that wallet, and sign it yourself.

**One intent. Every wallet. You still sign.**

## What it is not

Not a wallet, and not an agent with keys. Ottopus sits between your agent and your
wallets: it plans, explains and simulates. Your existing wallet stays the final
authority.

## The four invariants

1. **No private key ever reaches the backend or the agent.** Not the MCP client, not
   Ottopus, not the logs.
2. **Tool calls create plans, not transactions.** Prepare, never surprise.
3. **The review page is a hard security boundary**, bound to an immutable `planHash`.
4. **Simulation is independent of whoever built the route.**

## How it works

1. **Link your wallets** — hardware, hot, or a Safe. Up to eight, because Otto only
   has eight arms.
2. **Point your agent at Ottopus** — one URL, works with any agent that speaks MCP.
   Nothing to install.
3. **Say what you want** — you get back plain language describing exactly what will
   happen, and you sign it in your own wallet.

## Using it with your agent

*Coming as the MCP server lands.*

## Running locally

*Coming as the app lands.*

