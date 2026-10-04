/**
 * The wallets that are not installed here, from WalletConnect's own registry.
 *
 * Read from the browser with the public project id: the registry is built to
 * be called that way, and the relay the same id opens is browser-side too.
 * Nothing here connects anything. A row is a name, a logo and, on a phone,
 * the link that hands the pairing code to that wallet's app.
 */

const API = 'https://explorer-api.walletconnect.com/v3'

export const DIRECTORY_PAGE_SIZE = 40

export interface DirectoryWallet {
  id: string
  name: string
  /** The registry's logo for it. Always on the registry's host, never a URL a listing chose. */
  icon: string | null
  /** The rdns its browser extension announces, when it has one. */
  rdns: string | null
  /** The app's own scheme, "metamask://". */
  native: string | null
  /** Its https link, which also works when the app is not installed. */
  universal: string | null
}

export interface DirectoryPage {
  wallets: DirectoryWallet[]
  /** How many the registry holds for this search, before the EVM filter. */
  total: number
}

export interface DirectoryQuery {
  projectId: string
  search?: string | undefined
  /** 1-based. */
  page?: number | undefined
  signal?: AbortSignal | undefined
  /** Replaced in tests. */
  fetch?: typeof fetch | undefined
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

// A listing's links end up in an href, so only shapes that can open an app
// are kept: https, or a custom scheme with "//" (which rules out javascript:
// and data:).
const universalOf = (v: unknown) => {
  const s = text(v)
  return s && /^https:\/\/[^\s]+$/i.test(s) ? s : null
}
const nativeOf = (v: unknown) => {
  const s = text(v)
  return s && /^[a-z][a-z0-9+.-]*:\/\/[^\s]*$/i.test(s) && !/^(https?|file|ftp|blob):/i.test(s) ? s : null
}

function walletOf(raw: unknown, projectId: string): DirectoryWallet | null {
  const r = raw as {
    id?: unknown
    name?: unknown
    image_id?: unknown
    rdns?: unknown
    chains?: unknown
    mobile?: { native?: unknown; universal?: unknown } | null
  } | null
  const id = text(r?.id)
  const name = text(r?.name)
  if (!r || !id || !name) return null
  // The page signs EVM calls only. A listing that names its chains and has
  // no EVM one among them cannot hold the plan's account.
  if (Array.isArray(r.chains) && r.chains.length > 0 && !r.chains.some((c) => typeof c === 'string' && c.startsWith('eip155:'))) {
    return null
  }
  const image = text(r.image_id)
  return {
    id,
    name,
    icon: image && /^[\w-]+$/.test(image) ? `${API}/logo/md/${image}?projectId=${encodeURIComponent(projectId)}` : null,
    rdns: text(r.rdns),
    native: nativeOf(r.mobile?.native),
    universal: universalOf(r.mobile?.universal),
  }
}

export async function fetchDirectory(query: DirectoryQuery): Promise<DirectoryPage> {
  const params = new URLSearchParams({
    projectId: query.projectId,
    entries: String(DIRECTORY_PAGE_SIZE),
    page: String(query.page ?? 1),
    sdks: 'sign_v2',
  })
  const search = query.search?.trim()
  if (search) params.set('search', search)
  const res = await (query.fetch ?? fetch)(`${API}/wallets?${params}`, query.signal ? { signal: query.signal } : undefined)
  if (!res.ok) throw new Error(`The wallet list did not load (${res.status}).`)
  const body = (await res.json()) as { listings?: unknown; total?: unknown } | null
  const listings = body?.listings && typeof body.listings === 'object' ? Object.values(body.listings) : []
  const wallets = listings.map((l) => walletOf(l, query.projectId)).filter((w): w is DirectoryWallet => w !== null)
  return { wallets, total: typeof body?.total === 'number' ? body.total : wallets.length }
}

/**
 * The link that opens a wallet app on this phone with the pairing code in
 * hand, in WalletConnect's published form: the wallet's base link, then
 * `wc?uri=`. The https link leads when there is one, since it still lands
 * somewhere useful with the app missing.
 */
export function pairingLink(wallet: Pick<DirectoryWallet, 'native' | 'universal'>, uri: string): string | null {
  const base = wallet.universal ?? wallet.native
  if (!base) return null
  return `${base.endsWith('/') ? base : `${base}/`}wc?uri=${encodeURIComponent(uri)}`
}
