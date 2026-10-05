import { addChainParams, evmIdOf } from '@/lib/chains'
import type { Eip1193 } from '../send-calls'

/**
 * Talking to a wallet's own provider: who it is, where it is, and asking it
 * to move. Nothing here signs or sends, and nothing here decides whether a
 * wallet may — that is the gate's.
 */

export interface Held {
  /** Every account the wallet lets this page see, the selected one first. */
  accounts: readonly string[]
  /** CAIP-2 the wallet is on. */
  chainId: string
}

export function caip2OfHex(hex: unknown): string {
  return `eip155:${Number(hex)}`
}

async function read(provider: Eip1193, method: 'eth_requestAccounts' | 'eth_accounts'): Promise<Held> {
  const accounts = (await provider.request({ method })) as string[] | undefined
  const chainId = await provider.request({ method: 'eth_chainId' })
  return { accounts: Array.isArray(accounts) ? accounts : [], chainId: caip2OfHex(chainId) }
}

/** Opens the wallet. Only ever called from a click. */
export function requestConnection(provider: Eip1193): Promise<Held> {
  return read(provider, 'eth_requestAccounts')
}

/** What the wallet already allows, without prompting. Null when nothing. */
export async function readConnection(provider: Eip1193): Promise<Held | null> {
  const held = await read(provider, 'eth_accounts')
  return held.accounts.length > 0 ? held : null
}

/**
 * Ask the wallet to forget this page. Best effort: wallets without
 * `wallet_revokePermissions` refuse, and the page lets go of them regardless.
 */
export async function revokeConnection(provider: Eip1193): Promise<void> {
  try {
    await provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
  } catch {}
}

/**
 * Why a connection did not happen, in words for the person. The two answers
 * every wallet gives by code get a plain sentence; anything else is the
 * wallet's own message.
 */
export function describeConnectError(err: unknown, name: string): string {
  const e = err as { code?: number; message?: string } | null
  if (e?.code === 4001) return `The request was declined in ${name}.`
  if (e?.code === -32002) return `${name} already has a request open. Open ${name} and answer it there.`
  return (e?.message ?? '').trim() || `${name} did not answer.`
}

/**
 * Ask the wallet to move to the plan's chain. On 4902 the wallet has never
 * heard of the chain: teach it from the registry, then ask again. Anything
 * else is the wallet's answer and is thrown as it came.
 */
export async function switchTo(provider: Eip1193, chain: string): Promise<void> {
  const evmId = evmIdOf(chain)
  if (evmId === null) throw new Error(`${chain} is not a chain a wallet can switch to`)
  const hex = `0x${evmId.toString(16)}`
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] })
  } catch (err) {
    const code = (err as { code?: number }).code
    if (code !== 4902 && !/unrecognized|not added|4902/i.test(String((err as Error).message))) throw err
    const params = addChainParams(chain)
    if (!params) throw err
    await provider.request({ method: 'wallet_addEthereumChain', params: [params] })
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] })
  }
}

/** Whether the wallet holds the plan's account but sits on another chain. */
export function needsSwitch(held: Held, wanted: string, chain: string): boolean {
  const has = held.accounts.some((a) => a.toLowerCase() === wanted.toLowerCase())
  return has && held.chainId.toLowerCase() !== chain.toLowerCase()
}

/**
 * Re-read whichever wallet is held now. Null when there is none, when it
 * shares nothing, or when another wallet took its place while it answered:
 * a slow answer from the last wallet must not be written over the new one.
 */
export async function rereadHeld<W extends { provider: Eip1193 }>(current: () => W | null): Promise<{ wallet: W; held: Held } | null> {
  const wallet = current()
  if (!wallet) return null
  const held = await readConnection(wallet.provider)
  return held && current() === wallet ? { wallet, held } : null
}
