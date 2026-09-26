# Issuer marks

One SVG per tokenized-stock issuer, named by the id the service's stock
registry uses for it (`bstock`, `ondo`). Read by `issuerMark()` in
`lib/stocks.ts`, which lists the files here; `IssuerMark` draws one on a cream
tile beside the token's symbol on the token table, the review card and the
Stock panel. An issuer without a file keeps its name alone.

Each mark is its issuer's own trademark, used here only to say who issued a
token, which is what trademark law calls nominative use.

## Where they came from

- `bstock` — the bStocks site's own favicon,
  `https://bin.bnbstatic.com/static/bstocks-ui/favicon.svg`, fetched
  2026-09-26 and unmodified. The ring and diamond from the top of their
  wordmark, on a 96 grid, in Binance yellow.
- `ondo` — Ondo Finance's own favicon, `https://ondo.finance/favicon.svg`,
  fetched 2026-09-26 and unmodified. The concentric "O" from their wordmark,
  on a 480 grid, black. It is why the tile is cream in both themes.

xStocks has no file because the registry does not serve xStocks rows today.
Add a mark by dropping `<issuer>.svg` here and listing the id in
`ISSUER_MARKS`; the test in `lib/stocks.test.ts` fails until both agree.
