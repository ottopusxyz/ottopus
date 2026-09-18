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
 * may call itself whatever it likes, and nothing here verifies it. The tile is
 * decoration derived from a claim, never a badge that vouches for one — which
 * is why the surfaces that use it keep the raw name visible alongside.
 */

export const AGENT_SURFACES = ['cli', 'desktop', 'web', 'unknown'] as const

export type AgentSurface = (typeof AGENT_SURFACES)[number]

export interface AgentBrand {
  /** The vendor we think it is, or null when nothing matched. */
  vendor: string | null
  /** Tidied for display — "Claude Code (ottopus-local)" reads as "Claude Code". */
  label: string
  surface: AgentSurface
  /** Brand tint for the tile, with a foreground that clears AA on it. */
  bg: string
  fg: string
}

/**
 * Vendor tints, each the client's own brand colour, with the foreground stored
 * rather than derived — exactly as WALLET_AVATARS does it, and for the same
 * reason: no single foreground clears 4.5:1 on both a light and a dark tint.
 */
interface VendorRule {
  vendor: string
  /** Matched case-insensitively against the client's self-reported name. */
  match: RegExp
  bg: string
  fg: string
}

const VENDORS: readonly VendorRule[] = [
  { vendor: 'Claude Code', match: /claude\s*code/i, bg: '#D97757', fg: '#16213E' },
  { vendor: 'Claude', match: /claude/i, bg: '#D97757', fg: '#16213E' },
  { vendor: 'Codex', match: /codex|openai/i, bg: '#BFC3C7', fg: '#16213E' },
  { vendor: 'Cursor', match: /cursor/i, bg: '#9AA2B8', fg: '#16213E' },
  { vendor: 'VS Code', match: /visual\s*studio\s*code|vscode/i, bg: '#4FA3E3', fg: '#16213E' },
  { vendor: 'Windsurf', match: /windsurf/i, bg: '#3CCB8E', fg: '#16213E' },
  { vendor: 'Zed', match: /\bzed\b/i, bg: '#B3A0F5', fg: '#16213E' },
  { vendor: 'Cline', match: /\bcline\b/i, bg: '#88D5B0', fg: '#16213E' },
  { vendor: 'Continue', match: /\bcontinue\b/i, bg: '#F0C36A', fg: '#16213E' },
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
    bg: rule?.bg ?? 'var(--ot-surface-3)',
    fg: rule?.fg ?? 'var(--ot-text-2)',
  }
}

/** What the surface is called in a chip, or null where it tells us nothing. */
export function surfaceLabel(surface: AgentSurface): string | null {
  if (surface === 'cli') return 'Terminal'
  if (surface === 'desktop') return 'Desktop app'
  if (surface === 'web') return 'Web'
  return null
}
