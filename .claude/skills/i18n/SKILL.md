---
name: i18n
description: Add, change, rename or remove user-visible strings of wmeAlertSystem.js across all locale blocks, or audit translation coverage. Use whenever a change introduces or edits text shown in the UI (dialog buttons, snackbars, bell texts, settings tab).
argument-hint: "[add|change|remove|audit] [key.path] [English text]"
---

# i18n workflow

UI text lives in `getTranslationsFor(localeCode)` at the end of `wmeAlertSystem.js`: 44 locale `case`s + `default` (US English, canonical keys). Code reads it with `this.getTranslation('section.key', { var })` (English fallback per key); placeholders are `%{var}`.

**Never edit the blocks by hand.** Use `scripts/i18n.mjs`:

```bash
node scripts/i18n.mjs check [--untranslated]
node scripts/i18n.mjs get buttons.close
node scripts/i18n.mjs set <key.path> <file.json>   # { "default": "...", "<locale>": "..." }
node scripts/i18n.mjs remove <key.path>
node scripts/i18n.mjs slim
```

Only `default` holds every key; a locale value identical to English is never written.

Sections: `buttons` (labels), `changelog` (changelog dialog/notification), `dialog` (dialog chrome), `notification` (bell details).

## Add or change a string

1. Name the key in camelCase by meaning, in the right section.
2. Translations: delegate to the `i18n-translator` agent (key, English text, where it appears).
3. `node scripts/check.mjs` — no missing keys, no placeholder mismatch.

## Remove

`node scripts/i18n.mjs remove <key>` after removing the last `getTranslation('<key>')`.
