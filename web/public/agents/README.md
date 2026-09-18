# Agent brand marks

Ported from the logr repo, which is where they were first assembled.

- `claude-code`, `claude-ai`, `codex`, `vscode` — [Simple Icons](https://simpleicons.org),
  CC0. The marks themselves stay the trademarks of their owners; they are used
  here only to identify which agent holds a grant, which is what trademark law
  calls nominative use.
- `other` — the Lucide `bot` glyph, ISC, kept for anything unrecognised. It is
  the fallback on purpose: an agent's name is self-asserted at registration, and
  drawing a company's mark beside a name nothing verified would be worse than
  drawing nothing.

All carry `viewBox="-2.5 -2.5 29 29"` — a 24px mark with its own padding — so
they can share one tile size without per-file nudging.

Every mark is designed for a light ground, which is why `AgentIcon` sets a cream
tile in both themes rather than following the surface. `claude-code` is `#191919`
and would all but vanish on the dark palette.
