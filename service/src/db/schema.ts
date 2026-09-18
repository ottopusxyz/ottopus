import { sql } from 'drizzle-orm'
import {
  bigserial,
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
  /**
   * Display name, when the sign-in method carries one. Google gives one; email
   * and wallet do not, so this is null for them and filled later if they link a
   * method that has one. Never a required field — a wallet is a legitimate way
   * to be a person here, and it has no name to give.
   */
  name: text('name'),
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
  /**
   * Public clients only, so there is no secret to store. Every MCP client we
   * expect is a desktop app or a browser extension that cannot keep one, and
   * PKCE is what replaces it — a column here would be a secret we did not need
   * and would then have to protect.
   */
  clientUri: text('client_uri'),
  createdAt,
})

/**
 * An authorize request parked while the user decides.
 *
 * The authorize endpoint validates the client, redirect URI, PKCE challenge and
 * resource, then hands the browser an opaque id and sends it to the consent
 * page. Everything the eventual code needs is frozen here first, so nothing the
 * consent page posts back can change what was asked for — approving is a yes to
 * a stored request, not a fresh set of parameters.
 *
 * Rows are never updated in place. `decidedAt` and `userId` land together when
 * the answer arrives, and a row with `decidedAt` set can never be decided again.
 */
export const oauthAuthRequests = pgTable(
  'oauth_auth_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    /** Null until the person on the consent page is known. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    /** RFC 8707. Validated against our own canonical URI before the row exists. */
    resource: text('resource').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    /** Opaque to us; handed back to the client untouched. */
    state: text('state'),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    approved: boolean('approved'),
    createdAt,
  },
  (t) => [
    index('oauth_auth_requests_expires_idx').on(t.expiresAt),
    check('oauth_auth_requests_pkce_s256', sql`${t.codeChallengeMethod} = 'S256'`),
    // A decision is a user saying yes or no. Neither half means anything alone,
    // and an approved request with no user behind it would mint a token for
    // nobody.
    check(
      'oauth_auth_requests_decision_complete',
      sql`(${t.decidedAt} is null and ${t.approved} is null)
          or (${t.decidedAt} is not null and ${t.approved} is not null
              and (${t.approved} = false or ${t.userId} is not null))`,
    ),
  ],
)

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
    /** RFC 8707. The audience the token minted from this code may carry. */
    resource: text('resource'),
    /** The approved request this code was minted from. One code per approval. */
    requestId: uuid('request_id').references(() => oauthAuthRequests.id, {
      onDelete: 'cascade',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index('oauth_auth_codes_expires_idx').on(t.expiresAt),
    check('oauth_auth_codes_pkce_s256', sql`${t.codeChallengeMethod} = 'S256'`),
  ],
)

/**
 * A standing grant: this agent, acting for this person, with these scopes.
 *
 * The thing Settings lists and the thing a person revokes. Tokens rotate — a
 * refresh mints a new pair every hour — so a token is the wrong unit for both:
 * "connected since" would drift as old rows aged out, and revoking would have
 * to chase every row rather than setting one flag.
 *
 * Kept after revocation rather than deleted, so Settings can say a grant was
 * revoked instead of quietly losing it, and so the audit trail behind a plan
 * an agent prepared still resolves to the grant that allowed it.
 */
export const oauthGrants = pgTable(
  'oauth_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    resource: text('resource'),
    /** The consent that created it, so "granted at" is the moment someone said yes. */
    requestId: uuid('request_id').references(() => oauthAuthRequests.id, {
      onDelete: 'set null',
    }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Last time a token from this grant reached a tool. Written at most once a
     * minute and never awaited — it is the difference between "connected" and
     * "connected and actually working", and it is not worth a round trip on
     * every call to keep it to the second.
     */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index('oauth_grants_user_idx').on(t.userId),
    // One live grant per agent per person. A second consent from the same
    // client reuses it rather than stacking a second row in Settings that says
    // the same thing.
    uniqueIndex('oauth_grants_live_idx')
      .on(t.userId, t.clientId)
      .where(sql`${t.revokedAt} is null`),
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
    /** The standing grant this pair belongs to. Revoking it revokes them all. */
    grantId: uuid('grant_id').references(() => oauthGrants.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    /**
     * RFC 8707 audience. The spec requires the resource server to reject a
     * token that was not issued for it, so this is checked on every MCP
     * request rather than trusted because the token verified.
     */
    resource: text('resource'),
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
    /**
     * The agent grant that created it, or null for a plan built on the web.
     * get_plan and cancel_plan are scoped to this: an agent sees only the
     * plans its own grant made. Restrict for the same reason as wallet_id.
     */
    grantId: uuid('grant_id').references(() => oauthGrants.id, { onDelete: 'restrict' }),
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
    index('plans_grant_idx').on(t.grantId),
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
    /**
     * Insertion order. "Latest event" must not depend on created_at alone:
     * two rows written in one transaction share a now(), and uuids do not
     * sort. A sequence is the one thing that always orders inserts.
     */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
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

/**
 * Review links. The URL segment is an opaque token; only its hash is stored, so
 * a leaked table cannot be turned into working links. A token names one plan
 * version, and a new version revokes the old token rather than reusing it —
 * the link a person got is the link to what they were shown.
 *
 * Not append-only: revocation is an update, and a token is not evidence.
 */
export const reviewTokens = pgTable(
  'review_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    planId: uuid('plan_id').notNull(),
    planVersion: integer('plan_version').notNull(),
    /** Its own clock, independent of the quote's. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    foreignKey({
      columns: [t.planId, t.planVersion],
      foreignColumns: [plans.id, plans.version],
      name: 'review_tokens_plan_fk',
    }),
    index('review_tokens_plan_idx').on(t.planId, t.planVersion),
  ],
)
