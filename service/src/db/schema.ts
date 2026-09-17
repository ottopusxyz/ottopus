import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

/**
 * A person, not a wallet. Identity comes from Privy, so the external DID is the
 * join key — a user may sign in with Google, email or any linked wallet and
 * must land on the same row.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  privyDid: text('privy_did').notNull().unique(),
  email: text('email'),
  createdAt,
})

/**
 * An arm. Stored per account rather than per CAIP-10 identifier: one EOA is the
 * same account on every EVM chain, so storing eip155:<chainId>:<address> would
 * mean a row per chain for a wallet the user linked once. CAIP-10 is built on
 * read, when a specific chain is in play.
 */
export const linkedWallets = pgTable(
  'linked_wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    namespace: text('namespace').notNull().default('eip155'),
    /** Lowercased. Checksum is a display concern, never a lookup key. */
    address: text('address').notNull(),
    label: text('label'),
    /** metamask, rabby, walletconnect, safe, watch_only — names the arm. */
    walletType: text('wallet_type').notNull(),
    isWatchOnly: boolean('is_watch_only').notNull().default(false),
    /** Signed challenge proving control. Null only for watch-only. */
    ownershipProof: jsonb('ownership_proof'),
    provedAt: timestamp('proved_at', { withTimezone: true }),
    /**
     * Unlinking is a soft delete. Plans reference the wallet they were bound to
     * and plans are append-only, so a hard delete would try to update an
     * immutable row and fail. It would also erase the audit trail behind a
     * review decision. Filter on this being null to get active arms.
     */
    unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    // Unique only among active wallets, so an unlinked arm can be linked again.
    uniqueIndex('linked_wallets_user_account_idx')
      .on(t.userId, t.namespace, t.address)
      .where(sql`${t.unlinkedAt} is null`),
    index('linked_wallets_user_idx').on(t.userId),
    check('linked_wallets_address_lowercase', sql`${t.address} = lower(${t.address})`),
    // Watch-only wallets cannot sign, so they are the only ones without proof.
    check(
      'linked_wallets_proof_required',
      sql`${t.isWatchOnly} or ${t.ownershipProof} is not null`,
    ),
  ],
)

/** An agent that registered against the MCP server. */
export const oauthClients = pgTable('oauth_clients', {
  clientId: text('client_id').primaryKey(),
  clientName: text('client_name').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  createdAt,
})

/**
 * Short-lived authorization codes. Stored hashed — a leaked table must not be
 * exchangeable for a token. The consent page and the token endpoint sit on
 * different origins, so this table is what carries state between them; a cookie
 * could not.
 */
export const oauthAuthCodes = pgTable(
  'oauth_auth_codes',
  {
    codeHash: text('code_hash').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
    redirectUri: text('redirect_uri').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index('oauth_auth_codes_expires_idx').on(t.expiresAt),
    check('oauth_auth_codes_pkce_s256', sql`${t.codeChallengeMethod} = 'S256'`),
  ],
)

/** Access and refresh tokens, hashed. Revocable, which Settings exposes. */
export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    kind: text('kind').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index('oauth_tokens_user_idx').on(t.userId),
    check('oauth_tokens_kind', sql`${t.kind} in ('access', 'refresh')`),
  ],
)

/**
 * The heart of the system, and the reason this schema is append-only.
 *
 * A plan is immutable once written: planHash binds the review page to exactly
 * what was shown, so a row that can be edited would break invariant 3. Changing
 * anything means inserting a new version, never updating a row — the primary
 * key is (id, version) for that reason.
 *
 * RLS cannot enforce this, because the service connects as service_role and
 * service_role bypasses RLS. The guarantee comes from a trigger instead; see
 * the immutability migration.
 */
export const plans = pgTable(
  'plans',
  {
    id: uuid('id').notNull().defaultRandom(),
    version: integer('version').notNull().default(1),
    /** Hex digest over the canonical payload. Computed in core, never in web. */
    planHash: text('plan_hash').notNull(),
    /**
     * Restrict, not cascade: plans are append-only, so a cascading delete would
     * either destroy the audit trail or collide with the immutability trigger.
     * Removing a user has to deal with their plans deliberately.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** The wallet this plan is bound to. Signing is gated on it. */
    /**
     * Restrict, not set null: nulling this would be an UPDATE on an append-only
     * row and the trigger would reject it, so a wallet delete would deadlock
     * against plan immutability. Wallets are unlinked, never deleted.
     */
    walletId: uuid('wallet_id').references(() => linkedWallets.id, { onDelete: 'restrict' }),
    /** Typed intent as the agent expressed it. */
    intent: jsonb('intent').notNull(),
    /** The calls, and everything the review page renders. */
    payload: jsonb('payload').notNull(),
    /** Why this wallet won, in plain language. Shown, so it is stored. */
    reason: text('reason'),
    /** Quote expiry. Past this, the plan forces a re-plan rather than signing. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.id, t.version] }),
    uniqueIndex('plans_hash_idx').on(t.planHash),
    index('plans_user_idx').on(t.userId),
  ],
)

/**
 * State transitions, append-only. Status is deliberately not a column on plans:
 * a mutable status would mean updating an immutable row. Current status is the
 * latest event.
 */
export const planEvents = pgTable(
  'plan_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id').notNull(),
    planVersion: integer('plan_version').notNull(),
    status: text('status').notNull(),
    /** Tx hash, error, which re-plan trigger fired. */
    detail: jsonb('detail'),
    createdAt,
  },
  (t) => [
    foreignKey({
      columns: [t.planId, t.planVersion],
      foreignColumns: [plans.id, plans.version],
      name: 'plan_events_plan_fk',
    }),
    index('plan_events_plan_idx').on(t.planId, t.planVersion),
    check(
      'plan_events_status',
      // Frozen vocabulary — must match the canonical plan doc exactly.
      // 'simulated' is deliberately absent: simulation is evidence in the
      // simulations table, not a state. 'inked' is mascot copy for 'cancelled'
      // and never reaches the database.
      sql`${t.status} in (
        'draft', 'awaiting_review', 'awaiting_signature', 'submitted',
        'confirmed', 'failed', 'expired', 'blocked', 'superseded', 'cancelled'
      )`,
    ),
  ],
)

/**
 * Simulation results, append-only. Re-simulating on page open and before
 * submission writes new rows rather than overwriting — the history is what
 * shows a plan went stale.
 *
 * The provider here must never be the one that built the route (invariant 4).
 */
export const simulations = pgTable(
  'simulations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id').notNull(),
    planVersion: integer('plan_version').notNull(),
    provider: text('provider').notNull(),
    ok: boolean('ok').notNull(),
    /** Balance deltas the review page renders as the outcome. */
    assetDiff: jsonb('asset_diff'),
    raw: jsonb('raw'),
    createdAt,
  },
  (t) => [
    foreignKey({
      columns: [t.planId, t.planVersion],
      foreignColumns: [plans.id, plans.version],
      name: 'simulations_plan_fk',
    }),
    index('simulations_plan_idx').on(t.planId, t.planVersion),
  ],
)
