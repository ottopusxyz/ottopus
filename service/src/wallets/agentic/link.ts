import { randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { type Hex, recoverTypedDataAddress } from 'viem'
import { EVM_ADDRESS_RE } from '../../core/caip.js'
import { walletLinkChallenges } from '../../db/schema.js'
import { type Arm, type WalletDb, WalletError, addAgenticWallet, assertAgenticLinkable } from '../store.js'
import { type AgentProviderProfile, agentProvider } from './index.js'

/**
 * Linking an agentic arm: a challenge out, a signature back.
 *
 * Only the agent can reach the wallet, so the agent carries the proof — but
 * the proof is the wallet's, not the agent's. The challenge names the person,
 * the address and the vendor, and what comes back has to recover to that
 * address. An agent that does not operate the wallet cannot link it, whatever
 * its grant says.
 *
 * Nothing here signs. The typed data is handed out; the vendor's CLI signs it
 * on the person's machine.
 */

/** Long enough to run a CLI preview and confirm it, short enough to go stale. */
export const CHALLENGE_TTL_MS = 10 * 60_000

export class LinkError extends Error {
  constructor(
    readonly code: 'not_found' | 'expired' | 'replayed' | 'bad_signature',
    message: string,
  ) {
    super(message)
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * No chain id and no verifying contract: an arm is one account on every EVM
 * chain, and nothing on chain ever checks this signature.
 */
const DOMAIN = { name: 'Ottopus', version: '1' } as const

const TYPES = {
  LinkAgentWallet: [
    { name: 'statement', type: 'string' },
    { name: 'user', type: 'string' },
    { name: 'wallet', type: 'address' },
    { name: 'provider', type: 'string' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'expiresAt', type: 'string' },
  ],
} as const

const STATEMENT =
  'Link this wallet to my Ottopus account as an agent-operated wallet. ' +
  'This signature moves nothing and approves nothing.'

interface ChallengeFacts {
  userId: string
  address: string
  provider: string
  nonce: string
  expiresAt: Date
}

/** The message, built from the stored row and from nothing the agent sent back. */
function messageOf(facts: ChallengeFacts) {
  return {
    statement: STATEMENT,
    user: facts.userId,
    wallet: facts.address as Hex,
    provider: facts.provider,
    nonce: facts.nonce as Hex,
    expiresAt: facts.expiresAt.toISOString(),
  }
}

/** As `eth_signTypedData_v4` takes it, domain type included, so any signer can be handed it whole. */
export function linkTypedData(facts: ChallengeFacts) {
  return {
    domain: DOMAIN,
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
      ],
      ...TYPES,
    },
    primaryType: 'LinkAgentWallet' as const,
    message: messageOf(facts),
  }
}

export interface AgentLinkChallenge {
  challengeId: string
  typedData: ReturnType<typeof linkTypedData>
  expiresAt: string
  provider: AgentProviderProfile
}

export interface StartLinkInput {
  provider: string
  address: string
}

/**
 * Refuses up front what finish would refuse anyway — an unknown vendor, an
 * address already linked, no free arm — so nobody signs for a link that
 * cannot land.
 */
export async function startAgentLink(
  db: WalletDb,
  userId: string,
  input: StartLinkInput,
  now: Date = new Date(),
): Promise<AgentLinkChallenge> {
  const profile = agentProvider(input.provider)
  if (!profile) throw new WalletError('invalid_provider', `${input.provider} is not an agent wallet provider`)
  const address = input.address.trim().toLowerCase()
  if (!EVM_ADDRESS_RE.test(address)) throw new WalletError('invalid_address', 'Not a 20-byte hex address')
  await assertAgenticLinkable(db, userId, address)

  const facts: ChallengeFacts = {
    userId,
    address,
    provider: profile.id,
    nonce: `0x${randomBytes(32).toString('hex')}`,
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
  }
  const [row] = await db
    .insert(walletLinkChallenges)
    .values(facts)
    .returning({ id: walletLinkChallenges.id })
  if (!row) throw new LinkError('not_found', 'The challenge could not be stored')

  return {
    challengeId: row.id,
    typedData: linkTypedData(facts),
    expiresAt: facts.expiresAt.toISOString(),
    provider: profile,
  }
}

export interface FinishLinkInput {
  challengeId: string
  signature: string
  /** The agent that carried the signature, recorded beside it. */
  clientId: string
}

/**
 * Verify, then consume and store in one transaction.
 *
 * A signature that does not verify leaves the challenge usable: the agent may
 * have signed with the wrong account and can try again inside the expiry. A
 * link that is refused after verifying (the address got linked meanwhile, the
 * arms filled up) rolls the consumption back for the same reason.
 */
export async function finishAgentLink(
  db: WalletDb,
  userId: string,
  input: FinishLinkInput,
  now: Date = new Date(),
): Promise<Arm> {
  const unknown = new LinkError('not_found', 'No such challenge for this account; start again')
  // Postgres raises on a malformed uuid, and that is the same answer.
  if (!UUID_RE.test(input.challengeId)) throw unknown

  // Scoped by user: a challenge is bound to the person it was issued for, and
  // somebody else's reads the same as one that never existed.
  const [challenge] = await db
    .select()
    .from(walletLinkChallenges)
    .where(and(eq(walletLinkChallenges.id, input.challengeId), eq(walletLinkChallenges.userId, userId)))
  if (!challenge) throw unknown
  if (challenge.consumedAt) {
    throw new LinkError('replayed', 'That challenge has already been used; start again for a new one')
  }
  if (challenge.expiresAt.getTime() <= now.getTime()) {
    throw new LinkError('expired', `That challenge expired at ${challenge.expiresAt.toISOString()}; start again`)
  }

  // A CLI may print the signature bare and the recovery byte beside it, so
  // the 0x is optional here; the 65 bytes are not. The profile knows which
  // of its CLI's fields make them up.
  const bare = input.signature.trim().replace(/^0x/i, '')
  if (!/^[0-9a-f]{130}$/i.test(bare)) {
    const profile = agentProvider(challenge.provider)
    throw new LinkError(
      'bad_signature',
      'A signature is 65 bytes of hex: r, s, then the recovery byte' +
        (profile ? ` (from ${profile.cli}: ${profile.sign.handBack})` : ''),
    )
  }
  const signature: Hex = `0x${bare}`

  const typedData = linkTypedData(challenge)
  let signer: string
  try {
    signer = await recoverTypedDataAddress({
      domain: DOMAIN,
      types: TYPES,
      primaryType: 'LinkAgentWallet',
      message: typedData.message,
      signature,
    })
  } catch {
    throw new LinkError('bad_signature', 'That is not a signature over the challenge')
  }
  if (signer.toLowerCase() !== challenge.address) {
    throw new LinkError(
      'bad_signature',
      `The signature is from ${signer.toLowerCase()}, not ${challenge.address}; sign with the wallet being linked`,
    )
  }

  return db.transaction(async (tx) => {
    // Conditional, so of two finishes racing on one challenge exactly one
    // gets a row back.
    const consumed = await tx
      .update(walletLinkChallenges)
      .set({ consumedAt: now })
      .where(and(eq(walletLinkChallenges.id, challenge.id), isNull(walletLinkChallenges.consumedAt)))
      .returning({ id: walletLinkChallenges.id })
    if (consumed.length === 0) {
      throw new LinkError('replayed', 'That challenge has already been used; start again for a new one')
    }

    return addAgenticWallet(tx as WalletDb, userId, {
      provider: challenge.provider,
      address: challenge.address,
      proof: {
        via: 'agent_signed_challenge',
        challengeId: challenge.id,
        typedData,
        signature,
        clientId: input.clientId,
        verifiedAt: now.toISOString(),
      },
    })
  })
}
