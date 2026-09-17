/**
 * The scope vocabulary.
 *
 * Deliberately three, and deliberately none of them able to move anything. The
 * MCP surface exposes no tool that signs or broadcasts, so there is no scope
 * that could authorise one — the absence is the design, not an omission to be
 * filled in later.
 *
 * Wording matches the consent screen, because a scope a person cannot read is
 * a scope they cannot refuse.
 */
export const SCOPES = ['wallets:read', 'plans:read', 'plans:write'] as const

export type Scope = (typeof SCOPES)[number]

export interface ScopeCopy {
  scope: Scope
  title: string
  detail: string
}

/** What the consent page shows, in the order the design lists it. */
export const SCOPE_COPY: readonly ScopeCopy[] = [
  {
    scope: 'wallets:read',
    title: 'Read your linked wallets',
    detail: 'Addresses, balances and chains. Not private keys — there are none here.',
  },
  {
    scope: 'plans:write',
    title: 'Build and simulate requests',
    detail: 'Pick a wallet, route a swap, decode and dry-run the calls.',
  },
  {
    scope: 'plans:read',
    title: 'Send you review links',
    detail: 'Each one opens on the review page, on any device.',
  },
]

/**
 * What is never granted, shown on the consent screen as its own row.
 *
 * Not a scope. It has no name in the vocabulary above precisely because no
 * grant can ever contain it, and giving it a string would be the first step
 * toward something requesting it.
 */
export const NEVER_GRANTED = {
  title: 'Sign, submit or move anything',
  detail: 'Never granted. Ottopus holds no key and cannot sign for you.',
} as const

const KNOWN = new Set<string>(SCOPES)

export function isScope(value: string): value is Scope {
  return KNOWN.has(value)
}

/**
 * Parse a space-delimited scope string, keeping only what we recognise.
 *
 * Unknown scopes are dropped rather than rejected: OAuth 2.1 lets a server
 * issue a narrower grant than was asked for, and a client that requests one
 * scope we have never heard of should still get a working token for the rest.
 * The token response says what was actually granted.
 */
export function parseScopes(raw: string | undefined | null): Scope[] {
  if (!raw) return []
  const seen = new Set<Scope>()
  for (const value of raw.split(/\s+/)) {
    if (isScope(value)) seen.add(value)
  }
  return [...seen]
}

/** Every scope, for a client that asked for none. */
export function defaultScopes(): Scope[] {
  return [...SCOPES]
}

export function hasScope(granted: readonly string[], required: Scope): boolean {
  return granted.includes(required)
}
