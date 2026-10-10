import type { AgentIconKey } from './agent-brand'

/**
 * How each client is actually told about a server.
 *
 * The design (D3) draws one URL and three numbered steps for every client. That
 * is right for the ones with a settings screen and wrong for the ones with a
 * CLI, where a single command does the whole thing — so the steps stay only
 * where there is no command to replace them. The commands themselves come from
 * logr's share dialog, which has been connecting real clients for a while.
 *
 * `claude mcp add --transport http <name> <url>` is checked against
 * `claude mcp add --help` rather than remembered. The others are logr's, in use
 * and unverified here; a wrong flag is a bad first five minutes, so they are
 * worth re-checking whenever a client ships a new major version.
 */
export interface ConnectClient {
  key: string
  label: string
  icon: AgentIconKey
  /** One command that does the whole job, where the client has one. */
  command?: (url: string) => string
  /** Shown under the payload. Sentence case, no trailing period on a fragment. */
  note: string
  /** Only where there is no command — a settings screen has to be walked. */
  steps?: string[]
}

/**
 * The server name a client will file this under. Short, lowercase, and the same
 * everywhere: it is what someone types afterwards to sign in.
 */
export const SERVER_NAME = 'ottopus'

export const CONNECT_CLIENTS: readonly ConnectClient[] = [
  {
    key: 'claude-code',
    label: 'Claude Code',
    icon: 'claude-ai',
    command: (url) => `claude mcp add --transport http ${SERVER_NAME} ${url}`,
    note: `One command adds it. Run /mcp in Claude Code afterwards to sign in and approve the grant.`,
  },
  {
    key: 'claude-desktop',
    label: 'Claude',
    icon: 'claude-ai',
    note: 'For Claude Desktop and claude.ai, which add servers from settings rather than a terminal.',
    steps: [
      'Settings → Connectors → Add custom connector.',
      'Paste the URL above and save.',
      'Approve the grant when Ottopus opens in your browser.',
    ],
  },
  {
    key: 'codex',
    label: 'Codex',
    icon: 'codex',
    command: (url) => `codex mcp add ${SERVER_NAME} --url ${url}`,
    note: `Then codex mcp login ${SERVER_NAME} runs the OAuth flow.`,
  },
  {
    key: 'cursor',
    label: 'Cursor',
    icon: 'grok',
    note: 'Cursor adds remote servers from its MCP settings rather than a command.',
    steps: [
      'Cursor Settings → MCP & Integrations → New MCP Server.',
      `Under mcpServers, add "${SERVER_NAME}": { "url": "<the URL above>" } and save.`,
      'Approve the grant when Ottopus opens in your browser.',
    ],
  },
  {
    key: 'grok',
    label: 'Grok',
    icon: 'grok',
    note: 'Grok adds servers as connectors on grok.com.',
    steps: [
      'Open grok.com/connectors → New Connector → Custom.',
      'Paste the URL above and save.',
      'Approve the grant when Ottopus opens in your browser.',
    ],
  },
  {
    key: 'openclaw',
    label: 'OpenClaw',
    icon: 'openclaw',
    command: (url) =>
      `openclaw mcp set ${SERVER_NAME} '{"url":"${url}","transport":"streamable-http","auth":"oauth"}'`,
    note: `Then openclaw mcp login ${SERVER_NAME} runs the OAuth flow.`,
  },
  {
    key: 'hermes',
    label: 'Hermes',
    icon: 'hermes',
    command: (url) => `hermes mcp add ${SERVER_NAME} --url ${url}`,
    note: `Add it with --auth oauth, then hermes mcp login ${SERVER_NAME}.`,
  },
  {
    key: 'other',
    label: 'Any client',
    icon: 'other',
    note: 'A Streamable HTTP MCP endpoint with OAuth 2.1. Point any client at it — discovery does the rest.',
  },
]

/** What a client copies: its command, or the bare URL when it has none. */
export function payloadFor(client: ConnectClient, url: string): string {
  return client.command ? client.command(url) : url
}
