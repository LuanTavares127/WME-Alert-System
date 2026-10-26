@AGENTS.md

## Claude Code notes

- `AGENTS.md` (imported above) is the single source of project context; update it there whenever an architectural fact changes (API contract, bell strategies, WME facts, storage keys).
- The public API (`register()` and the client) is a contract with other scripts: a breaking change needs the user's OK, a note in `readme.md` and in `AGENTS.md` §3.
- A PostToolUse hook runs `scripts/check.mjs --quiet` after edits to `wmeAlertSystem.js`; fix what it reports before moving on.
- Anything about WME internals not in `AGENTS.md` §4 is unknown: ask the user for a console/DevTools capture instead of guessing (selectors, request URLs, cache shapes).
- Nothing runs locally: verification = `node scripts/check.mjs` + the manual checklist (skill `test-in-wme`). Say so instead of claiming something was tested.
- Work follows `ROADMAP.md`: run the phase with the model/effort it names, and update its Status column when the phase ends.
- The user writes in Portuguese (pt-BR): reply in pt-BR. Commit only when asked; commit messages in pt-BR.

| Kind | Name | Use for |
|---|---|---|
| Skill | `i18n` | Any add/change/remove of UI text |
| Skill | `test-in-wme` | Loading the working copy in WME + checklist |
| Agent | `i18n-translator` | Writing translations for all locales via `scripts/i18n.mjs` |
| Agent | `wme-reviewer` | Reviewing a change against conventions, API contract and native-UI risks |
| Agent | `wme-sdk-researcher` | Checking the SDK typings/docs before using `W.*` or a new SDK call |
