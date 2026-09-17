import { Hono, type MiddlewareHandler } from 'hono'
import {
  readPortfolio,
  type ArmRef,
  type PortfolioConnector,
} from '../connectors/portfolio/index.js'
import { listWallets, type WalletDb } from '../wallets/index.js'

/**
 * What the portfolio page reads.
 *
 * Aggregate on top, per-arm and per-chain preserved below — the same shape the
 * `get_portfolio` MCP tool will return, because the two surfaces are adapters
 * over one core and neither is allowed logic of its own.
 *
 * Watch-only arms are read like any other. They cannot sign, which is a fact
 * about signing; seeing what is in them is the entire reason someone pastes an
 * address.
 */
export function portfolioRoutes(
  db: WalletDb,
  session: MiddlewareHandler,
  connector: PortfolioConnector,
): Hono {
  const app = new Hono()
  app.use('*', session)

  app.get('/', async (c) => {
    const wallets = await listWallets(db, c.get('userId'))

    const arms: ArmRef[] = wallets.map((wallet) => ({
      walletId: wallet.id,
      namespace: wallet.namespace,
      address: wallet.address,
    }))

    // No arms is not an error and not an empty provider call — it is a new
    // account, and the page has an empty state for exactly this.
    const portfolio = await readPortfolio(connector, arms)
    return c.json(portfolio)
  })

  return app
}
