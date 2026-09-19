/**
 * The line above the total: who this is, and what the number counts.
 *
 * "gm" before noon, because that is how this crowd says good morning, and a
 * plain "Hello" the rest of the day. Only a first name — the header is not
 * the place for a surname — and none at all when the best name we have is an
 * address or a DID, which would read as a greeting to a hash.
 */
export function greeting(name: string | null | undefined, hour: number, mono = false): string {
  const word = hour >= 5 && hour < 12 ? 'gm' : 'Hello'
  const first = mono || !name ? null : name.trim().split(/\s+/)[0]
  return first ? `${word}, ${first}` : word
}

/** "Your balance across 4 wallets" — or what the number is when there are none. */
export function balanceLine(wallets: number): string {
  if (wallets === 0) return 'Total balance'
  return `Your balance across ${wallets} ${wallets === 1 ? 'wallet' : 'wallets'}`
}
