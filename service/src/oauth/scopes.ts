/**
 * The scope vocabulary.
 *
 * Deliberately few, and deliberately none of them able to move anything. The
 * MCP surface exposes no tool that signs or broadcasts, so there is no scope
 * that could authorise one — the absence is the design, not an omission to be
 * filled in later.
 *
 * `wallets:write` is the one nobody gets by default. A grant carries it only
 * when the agent asked for it by name or the person switched it on at the
 * consent screen. It allows linking a wallet the agent itself operates, proved
 * by that wallet's own signature, and nothing else: it cannot unlink, rename
 * or touch a wallet the person linked. See `defaultScopes` and `offeredScopes`.
 *
 * Wording matches the consent screen, because a scope a person cannot read is
 * a scope they cannot refuse.
 */
export const SCOPES = ['wallets:read', 'plans:read', 'plans:write', 'wallets:write'] as const

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
  {
    scope: 'wallets:write',
    title: 'Link a wallet this agent operates',
    detail:
      'Adds an agent-operated wallet to your account, proved by that wallet’s own signature. ' +
      'It cannot unlink, rename or change the wallets you linked.',
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
 * Unknown scopes are dropped rather than rejected, and that is a decision worth
 * defending because the alternative looks tidier. RFC 6749 §3.3 permits issuing
 * a narrower grant provided the response says so, which ours does — the token
 * response carries the granted `scope`, so a client is told exactly what it
 * got rather than left to assume.
 *
 * Rejecting instead would fail a whole connection over one unrecognised word.
 * Clients send scopes from cached metadata, from a newer version of a server,
 * and the MCP spec itself has clients optionally adding `offline_access`. On a
 * surface whose entire value is that an agent can connect, refusing outright
 * trades a real failure for a hygiene benefit we already get from the response.
 */
export function parseScopes(raw: string | undefined | null): Scope[] {
  if (!raw) return []
  const seen = new Set<Scope>()
  for (const value of raw.split(/\s+/)) {
    if (isScope(value)) seen.add(value)
  }
  return [...seen]
}

/**
 * Scopes a grant carries only when somebody chose them: the agent by naming
 * one in its request, or the person by switching it on at the consent screen.
 */
const OPT_IN: ReadonlySet<Scope> = new Set<Scope>(['wallets:write'])

/**
 * What a client that asked for nothing gets, and what a 401 tells it to ask
 * for. Never `wallets:write`: adding a wallet to someone's account is not
 * something an agent should hold because it forgot to say what it wanted.
 */
export function defaultScopes(): Scope[] {
  return SCOPES.filter((scope) => !OPT_IN.has(scope))
}

/**
 * What the consent screen offers as a switch: every opt-in scope the agent did
 * not ask for itself. Most hosts copy the scopes from our 401 and cannot be
 * told to ask for more, so without this the person has no way to say yes.
 */
export function offeredScopes(requested: readonly Scope[]): Scope[] {
  return SCOPES.filter((scope) => OPT_IN.has(scope) && !requested.includes(scope))
}

/**
 * The grant after the person's switches: what the agent asked for, plus the
 * opt-in scopes they turned on. Anything else in `added` is dropped, so the
 * consent screen can widen a grant by an opt-in scope and by nothing more.
 */
export function withOptIns(requested: readonly Scope[], added: readonly unknown[]): Scope[] {
  const chosen = offeredScopes(requested).filter((scope) => added.includes(scope))
  return [...requested, ...chosen]
}

/**
 * What the local stdio server runs with: the defaults, plus whatever its
 * launcher named. There is no consent screen there, so the environment is the
 * only place an opt-in scope can be asked for by name.
 */
export function localScopes(extra: string | undefined | null): Scope[] {
  return [...new Set([...defaultScopes(), ...parseScopes(extra)])]
}

export function hasScope(granted: readonly string[], required: Scope): boolean {
  return granted.includes(required)
}
