/**
 * Working out what an agent is, from the little it tells us.
 *
 * Dynamic client registration gives three things and no vendor field: a
 * `client_name` the client chose for itself, an optional `client_uri`, and the
 * redirect URIs it wants callbacks on. Our own live registration is
 * `"Claude Code (ottopus-local)"` with `http://localhost:50038/callback` and no
 * URI at all, which is representative — the name is the only real signal.
 *
 * So this is a guess, and the code says so everywhere it is used. The name is
 * self-asserted at registration by anyone who can POST to /register: an agent
 * may call itself whatever it likes, and nothing here verifies it. The mark is
 * decoration derived from a claim, never a badge that vouches for one — which
 * is why the surfaces that use it keep the raw name visible alongside, and why
 * anything unrecognised gets a generic bot rather than a nearest guess.
 */

export const AGENT_SURFACES = ['cli', 'desktop', 'web', 'unknown'] as const

export type AgentSurface = (typeof AGENT_SURFACES)[number]

export interface AgentBrand {
  /** The vendor we think it is, or null when nothing matched. */
  vendor: string | null
  /** Tidied for display — "Claude Code (ottopus-local)" reads as "Claude Code". */
  label: string
  surface: AgentSurface
  /** Which mark in public/agents to draw. `other` for anything unrecognised. */
  icon: AgentIconKey
}

/** The marks we actually have. Anything else falls back to `other`. */
export const AGENT_ICONS = ['claude-ai', 'codex', 'vscode', 'other'] as const

export type AgentIconKey = (typeof AGENT_ICONS)[number]

/**
 * Order is load-bearing: "Claude Code" contains "Claude", so the specific rule
 * has to come first or every Claude Code grant reads as Claude. They share a
 * mark but not a name, and the name is the half that differs.
 *
 * A vendor with no mark of its own still gets its name — that half is useful on
 * its own, and `other` is an honest answer to "which logo", not a failure.
 */
interface VendorRule {
  vendor: string
  /** Matched case-insensitively against the client's self-reported name. */
  match: RegExp
  icon: AgentIconKey
}

const VENDORS: readonly VendorRule[] = [
  // Both wear the Claude mark. Claude Code is Claude in a terminal, not a
  // different product, and the Anthropic wordmark names the company rather than
  // the thing holding the grant.
  { vendor: 'Claude Code', match: /claude\s*code/i, icon: 'claude-ai' },
  { vendor: 'Claude', match: /claude/i, icon: 'claude-ai' },
  { vendor: 'Codex', match: /codex|openai/i, icon: 'codex' },
  { vendor: 'VS Code', match: /visual\s*studio\s*code|vscode/i, icon: 'vscode' },
  { vendor: 'Cursor', match: /cursor/i, icon: 'other' },
  { vendor: 'Windsurf', match: /windsurf/i, icon: 'other' },
  { vendor: 'Zed', match: /\bzed\b/i, icon: 'other' },
  { vendor: 'Cline', match: /\bcline\b/i, icon: 'other' },
  { vendor: 'Continue', match: /\bcontinue\b/i, icon: 'other' },
]

/**
 * Where it runs, from the callback it asked for.
 *
 * A loopback redirect means something running on the machine — the only way a
 * CLI or a desktop app can receive one. An https callback means a hosted client.
 * A custom scheme (cursor://, vscode://) means a desktop app registering a
 * handler. None of this is claimed by the agent, which makes it the more
 * trustworthy half of what we show.
 */
export function surfaceOf(redirectUris: readonly string[], name: string): AgentSurface {
  const schemes = redirectUris.map((uri) => {
    try {
      return new URL(uri)
    } catch {
      return null
    }
  })

  if (schemes.some((url) => url && url.protocol === 'https:')) return 'web'
  if (schemes.some((url) => url && !['http:', 'https:'].includes(url.protocol))) return 'desktop'
  if (schemes.some((url) => url && url.protocol === 'http:')) {
    // Loopback covers both, so the name breaks the tie. "Code", "CLI" and
    // "terminal" are the words these clients actually use about themselves.
    return /code|cli|terminal|codex/i.test(name) ? 'cli' : 'desktop'
  }
  return 'unknown'
}

/**
 * Trim the qualifier a client appends to say which workspace it is.
 *
 * Claude Code registers as "Claude Code (ottopus-local)" — the project, not the
 * product. Useful to keep somewhere, but not as the heading of a row.
 */
function tidy(name: string): string {
  return name.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim() || name
}

export function agentBrand(name: string, redirectUris: readonly string[] = []): AgentBrand {
  const rule = VENDORS.find((candidate) => candidate.match.test(name))
  return {
    vendor: rule?.vendor ?? null,
    label: rule?.vendor ?? tidy(name),
    surface: surfaceOf(redirectUris, name),
    icon: rule?.icon ?? 'other',
  }
}

/** What the surface is called in a chip, or null where it tells us nothing. */
export function surfaceLabel(surface: AgentSurface): string | null {
  if (surface === 'cli') return 'Terminal'
  if (surface === 'desktop') return 'Desktop app'
  if (surface === 'web') return 'Web'
  return null
}
