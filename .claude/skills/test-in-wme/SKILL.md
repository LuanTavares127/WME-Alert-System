---
name: test-in-wme
description: How to load and manually test WME Alert System in the real WME (logged in), with a checklist per area (dialog queue, snackbar queue, bell strategies, changelog, map balloon, inline alert, settings tab, i18n). Use when asked to run, test, verify or QA the library, or after a change scripts/check.mjs can't verify.
---

# Testing in the WME

No automated tests; nothing runs locally. Static check here: `node scripts/check.mjs`.

## Loading the working copy (user does this)

- Tampermonkey → allow access to file URLs. Install `examples/consumer.user.js` (it `@require`s `file:///C:/Users/luan_/OneDrive/Área de Trabalho/Particular/Waze/WME-Alert-System/wmeAlertSystem.js`).
- For the singleton/grouping tests, install a second copy of the consumer with another `scriptId`/`scriptName` and `changelog.mode: 'notification'`.
- Keep `this.devVersion = true`: console lines `[WME Alert System v…]`. The library has no tab: use the consumer's "AS Test" tab (a form and a button per API call).
- Pages: https://www.waze.com/editor · https://beta.waze.com/editor.

## Checklist — pick the sections the change touches (light and dark theme)

**Startup**: one "Started." line even with two consumers (`__wmeAlertSystem.candidates` has both; `WmeAlertSystem.version` = the newest); no console errors. Load the older consumer first and the newer one second, and the reverse: the newest version always starts (a newer copy that arrives after the start only warns).

**Dialogs**: three dialogs from different scripts show one after the other, in order; `confirm` → true/false; Esc/overlay/× → null and the next one opens; a dialog requested while a WME dialog is open waits for it; "Sent by <script>" line. `let { id } = alerts.dialog.show({ … }); alerts.dialog.close(id);` → nothing appears and the next dialog opens.

**Snackbars**: three in a row show one at a time; copying the permalink (WME snackbar) in the middle pauses the queue and the interrupted one comes back (once, not three times).

**Bell** (strategy: `WmeAlertSystem` handle → in a dev build `window.__wmeAlertSystem.core.bell.strategy`): the notification appears in the native list (title, text, time) and counter; details show sender and button; the button runs the script action (`#was-action:` never opens a tab); delete removes it with no real request to the server (Network: our DELETE is answered locally); native notifications still work; reload → still there; another tab → synced. `add({ title: '<b>x</b>', message: 'a < b' })` must show the literal text (bold = the WME renders HTML: report it). Two scripts adding the same local id don't replace each other. Force the fallback (`__wmeAlertSystem.core.bell` / block the fiber lookup; `core` exists only with `devVersion`) and check the DOM mode the same way.

**Changelog**: bump the consumers' `@version` by two versions (+ entries) and reload → one grouped dialog (dialog mode) with both versions + one bell notification (notification mode) whose button opens both versions of that script's notes; "See previous changes"; reload again → nothing. A `loader` that fails (bad URL) → the script is left out and its notes show on the next reload. Several scripts: chips (name + version, no check icon) on one scrollable line (wheel slides it, faded edges, selecting a chip scrolls it into view), switching shows that script's notes, clicking the selected chip keeps it selected, the notes scroll inside a max height (the consumer's "changelog of several scripts" button demos it).

**Extras**: `alerts.map.confirm(...)` shows the map balloon (apply → true, cancel → false; a second call while one is open → the first resolves false; `lonLat` off-screen → `dialog.confirm` instead; pan the map away while it is open → the promise must still settle; `content: '<b>x</b>'` shows literal text; `alarming` is not an option and is not forwarded); `alerts.inline.alert(tabPane, …)` renders a `wz-alert`.

**i18n**: switch the WME language (pt-BR, es, ar for RTL); no raw `section.key` text. RTL: a long dialog title wraps before the native × (no overlap). A changelog bell notice created in one language shows in the new one after the switch (script texts stay as created).

Report which sections were exercised and what could not be verified.
