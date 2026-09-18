# Agent brand marks

Ported from the logr repo, which is where they were first assembled.

- `claude-ai`, `codex`, `vscode` — [Simple Icons](https://simpleicons.org),
  CC0. The marks themselves stay the trademarks of their owners; they are used
  here only to identify which agent holds a grant, which is what trademark law
  calls nominative use.
- `other` — the Lucide `bot` glyph, ISC, kept for anything unrecognised. It is
  the fallback on purpose: an agent's name is self-asserted at registration, and
  drawing a company's mark beside a name nothing verified would be worse than
  drawing nothing.

`hermes` is the odd one: a 64px PNG wrapped in an SVG, so it does not scale as
cleanly as the vector marks. Kept anyway — a slightly soft real mark beats a
crisp generic bot.

The rest carry `viewBox="-2.5 -2.5 29 29"` — a 24px mark with its own padding — so
they can share one tile size without per-file nudging.

`claude-ai` covers Claude Code and Claude Desktop alike: they are one product on
two surfaces, and the chip beside the name already says which. The Anthropic
wordmark that came with the original set is not here — it names the company, not
the thing holding a grant.

Every mark is designed for a light ground, which is why `AgentIcon` sets a cream
tile in both themes rather than following the surface. the Lucide bot is a mid grey
that would sit poorly on the dark palette, and a light tile keeps every mark
legible without per-theme variants.
