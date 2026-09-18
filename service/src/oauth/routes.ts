import { Hono } from 'hono'
import { z } from 'zod'
import { config } from '../config.js'
import type { Db } from '../db/client.js'
import { verifyPkce } from './crypto.js'
import { authorizationServerMetadata, resourceUrl } from './metadata.js'
import { defaultScopes, parseScopes, SCOPES } from './scopes.js'
import {
  consumeAuthCode,
  consumeRefreshToken,
  createAuthRequest,
  findAuthCode,
  findClient,
  grantFor,
  issueTokens,
  registerClient,
  revokeToken,
} from './store.js'

/**
 * The agent-facing half of OAuth 2.1: register, authorize, token, revoke.
 *
 * The browser-facing half — reading a parked request and answering it — lives
 * on the API surface instead, behind the Privy session, because that half is
 * the web app talking about a person and this half is an agent talking about
 * itself.
 *
 * Ottopus is its own authorization server. The endpoints sit under the MCP
 * origin so the issuer and the resource identifier share it, which is what lets
 * a client holding only our MCP URL discover everything else.
 */

/** OAuth error responses are a fixed shape; this keeps them from drifting. */
const fail = (error: string, description: string) => ({
  error,
  error_description: description,
})

/**
 * RFC 7591 dynamic client registration.
 *
 * The current draft spec deprecates this in favour of Client ID Metadata
 * Documents, but every shipping MCP client registers this way today, and a
 * server that only spoke the newer mechanism could not be connected from Claude
 * or Codex at all. Both is the eventual answer; this is the half that works now.
 *
 * Open registration, deliberately. Anyone may take a client id; that alone
 * grants nothing, because a grant needs a signed-in person to approve it.
 */
const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(z.string()).min(1).max(10),
  client_uri: z.string().optional(),
  // Accepted and ignored: clients send their full metadata, and refusing a
  // registration over a field we do not store would fail the whole connection.
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().optional(),
})

/**
 * A redirect URI we are willing to send a browser to.
 *
 * https, or a loopback http URL — which is how a desktop agent receives its
 * callback, and is explicitly allowed for native clients. No fragment, since
 * the response is appended as a query. Refused at registration rather than at
 * redirect time, so a bad URI never reaches a browser at all.
 */
function isUsableRedirect(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.hash) return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

export function oauthRoutes(db: Db): Hono {
  const app = new Hono()

  app.get('/.well-known/oauth-authorization-server', (c) => c.json(authorizationServerMetadata()))

  app.post('/register', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = registrationSchema.safeParse(body)
    if (!parsed.success) {
      return c.json(fail('invalid_client_metadata', 'redirect_uris is required.'), 400)
    }
    const redirectUris = parsed.data.redirect_uris.filter(isUsableRedirect)
    if (redirectUris.length === 0) {
      return c.json(
        fail(
          'invalid_redirect_uri',
          'Redirect URIs must be https, or http on localhost, and carry no fragment.',
        ),
        400,
      )
    }

    const client = await registerClient(db, {
      clientName: parsed.data.client_name ?? 'An agent',
      redirectUris,
      clientUri: parsed.data.client_uri ?? null,
    })

    return c.json(
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        // Public client: PKCE stands in for a secret, so there is none to send.
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      201,
    )
  })

  /**
   * The authorization endpoint.
   *
   * Order is load-bearing. The client and the redirect URI are validated first
   * and those failures render here; only once the URI is known to be registered
   * may an error be sent back to it. Redirecting an error to an unvalidated URI
   * is the open redirect this ordering exists to prevent.
   */
  app.get('/authorize', async (c) => {
    const q = c.req.query()

    const client = q.client_id ? await findClient(db, q.client_id) : null
    if (!client) {
      return c.json(fail('invalid_client', 'Unknown client_id. Register first.'), 400)
    }
    if (!q.redirect_uri || !client.redirectUris.includes(q.redirect_uri)) {
      return c.json(
        fail('invalid_request', 'redirect_uri does not match a registered URI for this client.'),
        400,
      )
    }

    const redirect = new URL(q.redirect_uri)
    // RFC 9207. Sent on errors too, so a client can tell which server refused.
    redirect.searchParams.set('iss', resourceUrl())
    if (q.state) redirect.searchParams.set('state', q.state)

    const refuse = (error: string, description: string) => {
      redirect.searchParams.set('error', error)
      redirect.searchParams.set('error_description', description)
      return c.redirect(redirect.toString(), 302)
    }

    if (q.response_type !== 'code') {
      return refuse('unsupported_response_type', 'Only response_type=code is supported.')
    }
    if (!q.code_challenge) {
      return refuse('invalid_request', 'PKCE is required: send code_challenge.')
    }
    if ((q.code_challenge_method ?? 'plain') !== 'S256') {
      return refuse('invalid_request', 'code_challenge_method must be S256.')
    }
    // RFC 8707. Clients must send it, but one that does not still gets a token
    // bound to us — the audience is ours either way, and refusing would break a
    // client over a parameter that changes nothing about the outcome. A
    // resource naming somebody else is a different matter, and is refused.
    if (q.resource && q.resource.replace(/\/$/, '') !== resourceUrl()) {
      return refuse('invalid_target', `This server only issues tokens for ${resourceUrl()}.`)
    }

    const scopes = q.scope ? parseScopes(q.scope) : defaultScopes()
    if (scopes.length === 0) {
      return refuse('invalid_scope', `Known scopes are: ${SCOPES.join(', ')}.`)
    }

    const request = await createAuthRequest(db, {
      clientId: client.clientId,
      scopes,
      resource: resourceUrl(),
      redirectUri: q.redirect_uri,
      state: q.state ?? null,
      codeChallenge: q.code_challenge,
    })

    // Nothing but the id travels. The consent page reads the rest back from the
    // service, so what it shows is what was stored rather than what the browser
    // was handed on the way through.
    const consent = new URL('/oauth/consent', config.webUrl)
    consent.searchParams.set('request', request.id)
    return c.redirect(consent.toString(), 302)
  })

  /**
   * The token endpoint.
   *
   * Public clients only, so there is no client authentication to perform —
   * possession of the code plus the PKCE verifier is the proof, which is what
   * PKCE exists to provide.
   */
  app.post('/token', async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>)
    const field = (name: string): string | undefined => {
      const value = form[name]
      return typeof value === 'string' && value !== '' ? value : undefined
    }

    const grantType = field('grant_type')
    if (grantType === 'authorization_code') {
      const code = field('code')
      const verifier = field('code_verifier')
      if (!code || !verifier) {
        return c.json(fail('invalid_request', 'code and code_verifier are required.'), 400)
      }

      // Read first, spend last. A wrong verifier must not burn the code:
      // consuming before validating let anyone holding a stolen code deny the
      // legitimate client its one exchange, without ever being able to redeem
      // it themselves.
      const pending = await findAuthCode(db, code)
      if (!pending) {
        return c.json(fail('invalid_grant', 'That code is expired, unknown or already used.'), 400)
      }
      // The bindings from RFC 6749 and RFC 7636. A code minted for one client,
      // or against one redirect URI, is not redeemable by another.
      const presentedClient = field('client_id')
      if (presentedClient && presentedClient !== pending.clientId) {
        return c.json(fail('invalid_grant', 'That code was issued to another client.'), 400)
      }
      const presentedRedirect = field('redirect_uri')
      if (presentedRedirect && presentedRedirect !== pending.redirectUri) {
        return c.json(fail('invalid_grant', 'redirect_uri does not match the authorization.'), 400)
      }
      if (!verifyPkce(verifier, pending.codeChallenge)) {
        return c.json(fail('invalid_grant', 'code_verifier does not match the challenge.'), 400)
      }

      // Now spend it. Still the single conditional update, so two requests that
      // both pass validation cannot both succeed.
      const consumed = await consumeAuthCode(db, code)
      if (!consumed) {
        return c.json(fail('invalid_grant', 'That code is expired, unknown or already used.'), 400)
      }

      // The standing grant, created on the first exchange and reused after —
      // it is what Settings lists and what a person revokes.
      const grantId = await grantFor(db, consumed)
      const tokens = await issueTokens(db, {
        clientId: consumed.clientId,
        userId: consumed.userId,
        scopes: consumed.scopes,
        resource: consumed.resource ?? resourceUrl(),
        grantId,
      })
      return c.json(tokenResponse(tokens))
    }

    if (grantType === 'refresh_token') {
      const presented = field('refresh_token')
      if (!presented) {
        return c.json(fail('invalid_request', 'refresh_token is required.'), 400)
      }
      // Spent in one statement rather than read-then-revoke: two refreshes
      // arriving together must not both mint a pair, or rotation is a
      // description rather than a guarantee.
      const grant = await consumeRefreshToken(db, presented)
      if (!grant) {
        return c.json(fail('invalid_grant', 'That refresh token is expired or revoked.'), 400)
      }
      // A token minted before grants existed has none to refresh into. Rather
      // than invent one, refuse: the agent reconnects and gets a real grant.
      if (!grant.grantId) {
        return c.json(fail('invalid_grant', 'That grant predates this server. Reconnect.'), 400)
      }
      const tokens = await issueTokens(db, {
        clientId: grant.clientId,
        userId: grant.userId,
        scopes: grant.scopes,
        resource: grant.resource ?? resourceUrl(),
        grantId: grant.grantId,
      })
      return c.json(tokenResponse(tokens))
    }

    return c.json(fail('unsupported_grant_type', 'Supported: authorization_code, refresh_token.'), 400)
  })

  /**
   * RFC 7009. Answers 200 whether or not the token existed — a caller must not
   * be able to use this to learn which strings are real tokens.
   */
  app.post('/revoke', async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>)
    const token = form.token
    if (typeof token === 'string' && token) await revokeToken(db, token)
    return c.body(null, 200)
  })

  return app
}

function tokenResponse(tokens: Awaited<ReturnType<typeof issueTokens>>) {
  return {
    access_token: tokens.accessToken,
    token_type: 'Bearer',
    expires_in: tokens.expiresInSeconds,
    refresh_token: tokens.refreshToken,
    scope: tokens.scopes.join(' '),
  }
}
