# Wallet marks

One SVG per wallet client, named by the `walletType` Privy reports at link
time (`walletClientType`) and we store on the arm. Read by `walletMark()` in
`components/wallets/naming.ts`, which also maps the aliases:
`walletconnect` → `wallet_connect`, and `coinbase_smart_wallet` and
`base_account` → `coinbase_wallet` (Coinbase products, one mark).

Bundled rather than read from the session on purpose. The browser used to show
whatever the connected extension announced about itself (EIP-6963), which made
a wallet's mark depend on which browser you were in and left nothing for a
wallet linked elsewhere, a pasted address, or the MCP surface. The client is
already known for every arm; the mark follows from that, everywhere.

## Where they came from

All fifteen are the connector icons from
[rainbow-me/rainbowkit](https://github.com/rainbow-me/rainbowkit)
(`packages/rainbowkit/src/wallets/walletConnectors/<wallet>/<wallet>.svg`),
fetched 2026-09-09 and unmodified. The repository is MIT-licensed; each mark is
its wallet's own trademark, used here to identify that wallet and nothing else.
Most are on a 28×28 grid; Rainbow, Backpack, Bitget and Brave carry their own.

A type without a file falls back to a lettered brand tile (`WALLET_AVATARS`),
and a watch-only address shows an eye — watched, not held — regardless of
label. Add a mark by dropping `<walletType>.svg` here and, if it has brand
colours, a row in `WALLET_AVATARS`.
