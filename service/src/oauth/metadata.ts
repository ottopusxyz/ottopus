import { config } from '../config.js'
import { SCOPES } from './scopes.js'

/**
 * Discovery documents.
 *
 * Ottopus is both the resource server and the authorization server, which is
 * the simple case the MCP spec allows and the one the endpoints were placed for
 * — the issuer origin is the MCP endpoint's origin, so a client that has our
 * URL can find everything else without special casing.
 *
 * Both documents are derived from one config value. Two hand-written copies of
 * the same origin is how discovery starts pointing somewhere the server is not.
 */

/** RFC 8707's canonical resource identifier, and our OAuth issuer. */
export const resourceUrl = (): string => config.mcpUrl

/**
 * Where RFC 9728 says our metadata lives: the origin's well-known path with the
 * resource's own path inserted after it. For https://mcp.ottopus.xyz that is
 * /.well-known/oauth-protected-resource; for http://localhost:8787/mcp it is
 * /.well-known/oauth-protected-resource/mcp.
 *
 * Computed rather than written down, because the two deployments spell the
 * resource differently and a hardcoded path would be right in one of them.
 */
export function protectedResourceMetadataUrl(): string {
  const url = new URL(resourceUrl())
  const path = url.pathname.replace(/\/$/, '')
  return `${url.origin}/.well-known/oauth-protected-resource${path}`
}

/** Same insertion rule, for the authorization server document. */
export function authorizationServerMetadataUrl(): string {
  const url = new URL(resourceUrl())
  const path = url.pathname.replace(/\/$/, '')
  return `${url.origin}/.well-known/oauth-authorization-server${path}`
}

export const endpoints = () => ({
  authorization: `${resourceUrl()}/oauth/authorize`,
  token: `${resourceUrl()}/oauth/token`,
  registration: `${resourceUrl()}/oauth/register`,
  revocation: `${resourceUrl()}/oauth/revoke`,
})

/**
 * RFC 9728. The MCP spec makes this mandatory for the resource server, and it
 * is the first thing a client fetches after a 401.
 */
export function protectedResourceMetadata() {
  return {
    resource: resourceUrl(),
    authorization_servers: [resourceUrl()],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Ottopus',
    resource_documentation: 'https://ottopus.xyz',
  }
}

/**
 * RFC 8414.
 *
 * `token_endpoint_auth_methods_supported: ['none']` because every client here
 * is public — a desktop agent or a browser extension, neither of which can keep
 * a secret. PKCE is what replaces the secret, and S256 is the only method
 * offered: OAuth 2.1 forbids `plain` for public clients, and the auth-code
 * table has a check constraint saying so independently.
 *
 * `authorization_response_iss_parameter_supported` is true because we do send
 * `iss` on authorization responses. RFC 9207 requires the client to reject a
 * response with no `iss` once we claim this, so the claim and the behaviour
 * have to move together.
 */
export function authorizationServerMetadata() {
  const e = endpoints()
  return {
    issuer: resourceUrl(),
    authorization_endpoint: e.authorization,
    token_endpoint: e.token,
    registration_endpoint: e.registration,
    revocation_endpoint: e.revocation,
    scopes_supported: [...SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    revocation_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
    service_documentation: 'https://ottopus.xyz',
  }
}

/**
 * The challenge on an unauthenticated request.
 *
 * `resource_metadata` is what turns a 401 into a discoverable flow — without it
 * a client has a rejection and nowhere to go. `scope` follows the spec's advice
 * to state what the operation needs, so a client asks for the right grant the
 * first time instead of guessing and coming back.
 */
export function challenge(scope: readonly string[] = SCOPES, error?: string): string {
  const parts = [`Bearer resource_metadata="${protectedResourceMetadataUrl()}"`]
  if (error) parts.push(`error="${error}"`)
  if (scope.length) parts.push(`scope="${scope.join(' ')}"`)
  return parts.join(', ')
}
