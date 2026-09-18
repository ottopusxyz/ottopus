import { describe, expect, it } from 'vitest'
import {
  authorizationServerMetadata,
  authorizationServerMetadataUrl,
  challenge,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  resourceUrl,
  wellKnownPaths,
} from './metadata.js'

/**
 * Discovery, which is the part of OAuth that fails silently.
 *
 * A client that cannot find the authorization server document never learns the
 * registration endpoint. It falls back to guessing one off the issuer, gets a
 * 404, and reports "Dynamic Client Registration rejected" — an error that names
 * the wrong thing entirely. That happened, and these tests are why it cannot
 * happen again without something going red first.
 */

describe('what we advertise is what we serve', () => {
  /**
   * Both RFCs anchor the well-known path to the origin and insert the
   * resource's path after the well-known segment. So the URL we hand a client
   * in the 401 has to be a path the app actually routes.
   */
  it('serves the protected-resource document at the URL the challenge points to', () => {
    const advertised = new URL(protectedResourceMetadataUrl())
    expect(wellKnownPaths().protectedResource).toContain(advertised.pathname)
    expect(advertised.origin).toBe(new URL(resourceUrl()).origin)
  })

  it('serves the authorization-server document at its RFC 8414 path', () => {
    const advertised = new URL(authorizationServerMetadataUrl())
    expect(wellKnownPaths().authorizationServer).toContain(advertised.pathname)
    expect(advertised.origin).toBe(new URL(resourceUrl()).origin)
  })

  it('names the metadata URL in the challenge, since that is the whole way out of a 401', () => {
    expect(challenge()).toContain(`resource_metadata="${protectedResourceMetadataUrl()}"`)
  })
})

describe('the path-insertion rule', () => {
  const paths = (resource: string) => {
    const url = new URL(resource)
    const path = url.pathname.replace(/\/$/, '')
    return path ? [path] : []
  }

  it('covers both the bare and the path-inserted form when the resource has a path', () => {
    // Whatever MCP_URL is in this environment, the rule is the same: a resource
    // with a path answers on two spellings, one without answers on one.
    const hasPath = paths(resourceUrl()).length > 0
    expect(wellKnownPaths().authorizationServer).toHaveLength(hasPath ? 2 : 1)
    expect(wellKnownPaths().protectedResource).toHaveLength(hasPath ? 2 : 1)
  })

  it('always answers on the bare well-known path', () => {
    expect(wellKnownPaths().protectedResource).toContain('/.well-known/oauth-protected-resource')
    expect(wellKnownPaths().authorizationServer).toContain(
      '/.well-known/oauth-authorization-server',
    )
  })
})

describe('the authorization server document', () => {
  const metadata = authorizationServerMetadata()

  it('points its endpoints at the issuer, so one config value moves them all', () => {
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.registration_endpoint,
      metadata.revocation_endpoint,
    ]) {
      expect(endpoint.startsWith(`${resourceUrl()}/`)).toBe(true)
    }
  })

  /** OAuth 2.1 forbids `plain` for a public client, and every client here is one. */
  it('offers S256 and nothing else', () => {
    expect(metadata.code_challenge_methods_supported).toEqual(['S256'])
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(['none'])
  })

  /**
   * RFC 9207 requires a client to reject a response with no `iss` once the
   * server claims this. The claim and the behaviour have to move together, so
   * if the authorize endpoint ever stops sending `iss`, this has to change too.
   */
  it('claims the iss parameter it actually sends', () => {
    expect(metadata.authorization_response_iss_parameter_supported).toBe(true)
  })

  it('advertises the same scopes as the protected resource', () => {
    expect(metadata.scopes_supported).toEqual(protectedResourceMetadata().scopes_supported)
  })

  it('names itself as its own authorization server', () => {
    expect(protectedResourceMetadata().authorization_servers).toEqual([metadata.issuer])
  })
})
