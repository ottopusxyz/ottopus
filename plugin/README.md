# Ottopus for Claude Code

Ask Claude Code to buy a tokenized stock, swap or send, and the plan Ottopus
prepares shows up as a card above your prompt. The card follows the plan on its
own, so you never have to ask the agent what happened.

- **Plan card** with the wallet, the amounts and a countdown to expiry.
- **Review and sign** link to the review page, where you check the decoded calls
  and the simulation and sign in your own wallet.
- **Live status**: signed, confirmed (with an explorer link), cancelled or expired.

Claude prepares it. You still sign.

## Install

```
/plugin marketplace add ottopusxyz/ottopus
/plugin install ottopus@ottopus
```

The plugin brings the Ottopus MCP server (`https://mcp.ottopus.xyz/mcp`) with it. Link
a wallet at [ottopus.xyz](https://ottopus.xyz) first; the first tool call opens a
consent page where you choose what the agent may do.

If you already added the server yourself (`claude mcp add`, or the Claude.ai
connector), the card works with that connection too.

## Skill: agent-operated wallets

The plugin also carries the `ottopus-agentic` skill, under
[`skills/ottopus-agentic/`](skills/ottopus-agentic/SKILL.md). It is for an agent
that operates a wallet through a vendor CLI (Binance Agentic Wallet today): how to
link that wallet to your Ottopus account, how to wait for you to approve a plan, and
how to send the approved calls from its own wallet and report the hash. Claude Code
loads it with the plugin as `ottopus:ottopus-agentic`.

Any other host that reads Agent Skills (Codex, Cursor, Gemini CLI and others)
installs the same file from the repo:

```
npx skills add ottopusxyz/ottopus
```

## Options

| Option | Default | What it does |
|---|---|---|
| `server` | empty | The name of the one Ottopus MCP server to listen to, as `/mcp` lists it. Empty accepts any server whose plans link to the review origin. |
| `reviewOrigin` | `https://ottopus.xyz` | Where review links must lead. Plans linking anywhere else are ignored. Change only for a self-hosted Ottopus. |

## What it can touch

The plugin draws the card, keeps a clock for the countdown, and calls `get_plan`
on the Ottopus server to follow a plan. It reads no files, starts no processes and
makes no network requests of its own.

No private key ever reaches Claude, the plugin or Ottopus. A plan is only a
proposal until you sign it in your own wallet.

## Develop

```sh
claude plugin validate plugin
claude plugin test plugin
claude --plugin-dir plugin
npx skills-ref validate plugin/skills/ottopus-agentic
```

The plugin pins its `version` in `.claude-plugin/plugin.json`, so Claude Code keeps
users on the cached copy until that string changes. Bump it in the same PR as any
change to the hooks or the skill, or nobody receives the change.
