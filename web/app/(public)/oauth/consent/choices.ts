import type { ConsentGrant } from '@/lib/api'

type Offered = ConsentGrant['offered'][number]

/**
 * The optional switches the person has moved, and where they left each one.
 *
 * Only what the person did is kept. Where a switch starts is read off the
 * request each time, so reading the request again — a credential refreshed
 * while the page was open — has nothing of theirs to overwrite.
 */
export type Moves = Readonly<Record<string, boolean>>

/** Where a switch stands: where the person left it, else where the request starts it. */
export function isOn(entry: Offered, moves: Moves): boolean {
  return moves[entry.scope] ?? entry.requested
}

export function move(moves: Moves, scope: string, on: boolean): Moves {
  return { ...moves, [scope]: on }
}

/** The offered scopes whose switches are on — what the decision sends back. */
export function chosenScopes(offered: readonly Offered[], moves: Moves): string[] {
  return offered.filter((entry) => isOn(entry, moves)).map((entry) => entry.scope)
}
