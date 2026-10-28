# AGENTS.md — WME Alert System

Shared **library** for Waze Map Editor (WME) userscripts. Scripts `@require` it and get native WME dialogs, snackbars, bell notifications and a unified changelog, all queued so scripts don't overlap each other. Author: Luan Tavares (luan_tavares_127). License: GPLv3. Released: v1.0.0 (2026-10-26). Repository: https://github.com/LuanTavares127/WME-Alert-System (remote `origin`). Greasy Fork: https://greasyfork.org/scripts/602363-wme-alert-system (library, id 602363; the `@require` URL carries the upload id, which changes on every upload).

The maintainer writes in **Brazilian Portuguese**: reply in pt-BR. Code, comments, JSDoc and the `@TODO`/`@Changelog` blocks in **English**: no pt-BR in `wmeAlertSystem.js` besides the translations (locale blocks, `@name:pt-BR`/`@description:pt-BR`) (user decision, 2026-10-25). Only user-facing strings are translated (47 locales). Commit messages in English.

## 1. Files

| File | What it is |
|---|---|
| `wmeAlertSystem.js` | The whole library: class `WmeAlertSystemCore` + `bootstrapWmeAlertSystem()` + the `WmeAlertSystem` handle. Translations at the end (`getTranslationsFor`). |
| `examples/consumer.user.js` | Test userscript that consumes the library: a sidebar tab ("AS Test") with a configurable form and a button per API call, results in a log (manual testing). |
| `scripts/check.mjs` | Static validator (syntax, version, i18n, XSS heuristic, CRLF, size). `--release` for dev leftovers. |
| `scripts/i18n.mjs` | Edits translation keys in every locale block (`locales`, `check`, `get`, `set`, `remove`, `slim`). |
| `readme.md` | Public description + usage (English, Greasy Fork). |
| `CHANGELOG.md` | The library's own history, for scripters (English). The library does **not** notify end users of its updates (user decision, 2026-10-25). Needs a `## [<version>]` section for the current version (`check.mjs`). |
| `ROADMAP.md` | Execution plan in phases (pt-BR): model, effort and status per phase. Update the Status column at the end of every phase. |

## 2. Design rules (user decisions, 2026-10-25)

- **Native UI only**: WME's own `wz-*` web components (Stencil, registered globally by the WME) and WME mechanisms. Hand-made UI only when nothing native exists (the DOM fallback of the bell reuses the native markup/classes).
- **SDK first**. The WME SDK (production v2.374, beta v2.376) has **no** dialog/snackbar/notification/toast API. Any `W.*` / internals use is marked `// TODO: There is no official replacement in the SDK yet` and checked before use.
- **Dialogs: one at a time, FIFO across all scripts.** **Snackbars: one at a time, FIFO** (native `wz-snackbar`s close each other: the WME shows one at a time).
- Changelog: each script chooses `dialog` (all updated scripts grouped in **one** dialog: native `wz-chip-select` chips on top (no check icon, one line scrolled sideways without a scroll bar: wheel → eased sideways glide, faded edges, like the Waze Chat Plus filters), "name vX.Y.Z", one script's notes below, notes area `max-height: min(60vh, 560px)` with scroll; the native chip truncates at 200px, so each chip has a `title`; no chips when only one script) or `notification` (bell).
- Bell fallback when the native list can't be reached: DOM items with the native markup.
- Distribution: `@require` (like WazeWrap). Tampermonkey is the supported manager (cross-realm objects on `unsafeWindow` are not exported for Firefox Xray wrappers).

## 3. Architecture

### Bootstrap / singleton
- Every copy (one per script that `@require`s it) runs `bootstrapWmeAlertSystem()`: it pushes `{ version, create }` into `pageWindow.__wmeAlertSystem.candidates` (`pageWindow` = `unsafeWindow` or `window`).
- The first copy publishes `pageWindow.WmeAlertSystem = { ready(), version }` (frozen). On `SDK_INITIALIZED` (+ one macrotask so same-tick copies register) the **newest version** creates the core; the others do nothing. A newer copy loaded after the start only logs a warning. Waiting for `SDK_INITIALIZED` has no deadline (250 ms polls for 15 s, then 2 s): `ready()` must resolve on a slow load.
- `__wmeAlertSystem` = `{ candidates, isStarting, startedVersion, ready, resolveReady, isRequestPatched }`, non-enumerable and non-writable. **Its shape and the version choice (the first copy's `start`, with its own `isVersionGreater`) are a contract between versions**: every future copy must read it the same way. It never holds the core (scripts would reach its internals), except `core` in a `devVersion` build, for the console tests. The object itself stays mutable (`resolveReady`, `candidates`): inherent to a page-wide bootstrap, every script on the page is trusted anyway. If the newest copy throws on creation, the next newest starts.
- Versions: numeric parts, leading `v` ignored, a pre-release (`1.2.0-beta.1`) is older than its release.
- The top-level `const WmeAlertSystem` gives the handle to the consumer scope (works whatever its `@grant`).
- Core start: `getWmeSdk({ mode: 'async' })` → `State.isReady()` or `Events.once('wme-ready')` → locale → i18n → storage → styles → listeners → request interception → bell strategy → `ready()` resolves with `{ version, register }` and `document` gets `wme-alert-system:ready`.

### Public API (contract with other scripts — changes need care)
```js
const alerts = (await WmeAlertSystem.ready()).register({
    scriptId: 'wme-speed-display',            // required, [\w-]+; same id again returns the same client
    scriptName: 'WME Speed Display',
    version: '2.4.0',
    changelog: { mode: 'dialog' | 'notification' | 'none', entries: [...] /* or */ loader: async () => [...] },
    links: { greasyFork: 'https://…', discuss: 'https://…' }
});

alerts.dialog.show({ id, title, content /* trusted HTML or Node */, size, dismissible, actions: [{ label, value, variant, alarming, disabled, keepOpen, onClick }], onRender })
    // → { id, result: Promise<value | null> }   null = closed by ×/Esc/overlay
alerts.dialog.alert(title, text)                     // → Promise<void>
alerts.dialog.confirm(title, text, { alarming, confirmLabel, cancelLabel })   // → Promise<boolean>
alerts.dialog.close(id)

alerts.snackbar.show(text, { id, closeDelay = 5000, closeAutomatically = true })   // → { id, close() }
alerts.snackbar.close(id)

alerts.notification.add({ id, title, message, buttonText, buttonURL /* http(s) */ | action, keepOpen /* bell stays open on action; default closes it */, data /* JSON, stored as a copy; TypeError otherwise */ })   // → id
alerts.notification.remove(id) / clear() / list()
alerts.notification.onAction(action, handler)       // call on every load: handlers aren't stored

alerts.changelog.show()                              // current version's notes on demand
alerts.map.confirm({ title, content, lonLat, applyButtonText, cancelButtonText })   // → Promise<boolean>   (no `alarming`: removed in phase 5b, the balloon ignores it)
alerts.inline.alert(container, { variant, title, text, dismissible })                       // → { element, remove() }
```
- `title`, `text`, labels, notification texts: plain text (escaped). `content` and changelog `changes` HTML: trusted HTML of the calling script.
- Changelog entries: same shape as the author's `changelog.json` — `{ version, versionId?, date: 'YYYY-MM-DD', changes: { <locale>: html, en: html } }`; text = `changes[locale] || changes.en`. Only the running version's notes are plain (`renderChangelogCurrent`: the script's HTML as is, no card, version or date — the dialog title names the version, like the WME Speed Display dialog; user decision, 2026-10-27); every other version (the update's older versions and the history button's) is a card (`renderChangelogCard(entry, item)`); `.was-changelog-body` has `padding-right: 8px` so notes and cards stay off the scroll bar; with `versionId` and `links.greasyFork` the version links to `<greasyFork>?version=<versionId>`. First install stores the version silently; an update shows every entry `> last seen && <= current` (dialog mode, and the bell notification's button through `data.since`). Notification mode keeps one notice per script (id `changelog`; up to v1.0.0 it was `changelog-<version>`): a newer update replaces an unopened one and keeps the oldest `since`. A `loader` has 15 s; after an update, a script whose notes failed to load is left out of the dialog and not marked as seen (retried on the next load).

### Dialogs (`DialogQueue` section)
`enqueueDialog` → `processNextDialog` (waits while a WME `wz-dialog` is open; retry 1 s) → `openDialog` (`wz-dialog` in `#wz-dialog-container`, `<form>` + header/content/controls `layout="horizontal-reverse"`, `componentOnReady` then `showDialog()`). Close = `dialogHidden` event, fallback shadow root emptied (`isRendered`), last resort `watchActiveDialog` (every 1 s: wrapper removed from the page → finished). A dialog closed before `componentOnReady` is never shown. The promise always resolves. Non-core dialogs show "Sent by <script>".
- Dismissible dialogs get `padding-right: 24px` (and `display: block`) on `wz-dialog-header`: the native × stays on the right even in RTL and the title area runs under it.
- Hidden tab: `hideDialog()` doesn't finish until the tab is visible (§4). Deliberately not worked around (user decision, phase 5b): the promise already resolved, nobody sees the screen, and removing a `wz-dialog` mid-animation has unknown side effects. Documented in the readme.

### Snackbars (`SnackbarQueue` section)
One library `wz-snackbar#was-snackbar` in `#map-message-container`, refilled per item (`textContent`, `closeAutomatically`, `closeDelay` props, `showSnackbar()`). Waits while any other `wz-snackbar` is rendered. Document capture listeners on `closeSnackbars`/`snackbarShown`/`snackbarHidden`: a foreign snackbar that closes ours re-queues it at the front (max 3 times). Besides `snackbarHidden` and the shadow-root observer (moved when the element is recreated), `watchActiveSnackbar` settles the active item every 1 s when its element left the page or it stopped rendering 2 s after it should have closed.

### Bell (`NativeNotifications` section) — two strategies, picked at runtime (`bell.strategy`)
- **`query` (native)**: the `QueryClient` found by walking the React fiber of `#notification-button` (`__reactFiber$…` → `memoizedProps.value` / `dependencies.firstContext`). Our records are converted to the feed format (`toNativeNotification`) and merged into `getQueryData(['notifications'])` (plain array; an object holding one is still accepted); `getQueryCache().subscribe` re-merges after every refetch (signature compare avoids loops). WME requests about our ids (`Feed/Notifications/…was-<id>`) are answered locally by wrappers on `fetch` / `XMLHttpRequest` (DELETE removes; anything else is just answered). Tried 20× (1 s) after start.
- **No read state** (like the native bell): records have no `isRead`, opening an item changes nothing, the counter is the number of items (in `query` the WME counts the merged list itself).
- **`dom` (fallback)**: observes `<body>` for the tippy popup `.tippy-box[data-theme~="notifications-box"]` and prepends items with the native markup (`notification-item item-type-notification`, `wz-h6.title`, `.message`, `wz-caption.timestamp`, `wz-button.delete-button`); details view with `.notification-content-container`; counter = native value + our item count on `wz-notification-indicator`.
- Button actions: `buttonURL = '#was-action:<id>'`, intercepted by a capture click listener on `document`. The bell popup is closed (`closeBellPopup`: click on `#notification-button`, tippy `hide()` as fallback) before the handler runs, unless the record has `keepOpen`.
- Storage: `localStorage.wmeAlertSystemNotifications` (records with `id = was-<scriptId>.<id>`: `.` can't appear in either part, so ids of different scripts never collide; 15 per script, 30 days). Synced across tabs via `storage` events.
- Language: script texts are stored as given. The library's own texts (changelog notice, default "Open" button) also store `textKeys: { title|message|buttonText: [key, params] }` and are translated again on display (`getNotificationText`); the translated text is stored too, for older copies that ignore `textKeys`. Only the third `addNotification` argument sets them: the client never passes it.

### Other
- `map.confirm` → `W.map.showConfirmationDialog` with `lonLat: { lon, lat }` (WGS84, default `Map.getMapCenter()`); resolves on apply, rejects on cancel/newer (caught → `false`). Falls back to `dialog.confirm` when the method is missing or the point is invalid/outside `Map.getMapExtent()` (the WME would show nothing and never resolve).
- `inline.alert` → `wz-alert level="page"` with `header`/`body`/`dismiss` slots.
- **No UI of its own** (user decision, 2026-10-25): no sidebar tab, no settings, no end-user toggles. The library is a toolbox; the scripter who `@require`s it decides what happens. Manual tests go through `examples/consumer.user.js` (its own tab).
- Storage keys: `wmeAlertSystemNotifications`, `wmeAlertSystemSeenVersions` (`{ scriptId: version }`). Never rename them. (`wmeAlertSystemSettings` was used by the removed settings tab; old data may remain in users' storage and is ignored.)

## 4. WME facts (read from the production bundle v2.374-5, 2026-10-25)

- `wz-dialog`: `size` xxs|xs|sm(default)|lg|xl, `alignment`, `dismissible`; `showDialog()`/`hideDialog()`; events `dialogShown`/`dialogHidden`; renders nothing until shown.
- `wz-snackbar`: `align`, `close-automatically` (default true), `close-delay` (3000), `close-button`, `position`; `showSnackbar()`/`hideSnackbar()`; events `snackbarShown`/`snackbarHidden`/`closeSnackbars` (showing one hides the others). WME's own: `W.app.showSnackbar(content, opts)` / `W.app.hideSnackbar(id)` (one Backbone attribute; string content).
- Bell: React + React Query, `queryKey ['notifications']`, `Feed/Notifications` (`W.Config.paths.notifications`), delete = `DELETE Feed/Notifications/{id}`, `staleTime: 0`. The old `W.controller.app.notificationsBoxState` (Backbone collection) **no longer exists**.
- `W.map.showConfirmationDialog({ title, content, alarming, applyButtonText, cancelButtonText, dontShowAgainKey, lonLat, hideOnClick })` → Promise.
- Minified names change every release: only public names (tags, props, events, `W.*`) may be used.

### Confirmed in the console (Passo 0, beta.waze.com 2026-10-25)
- `QueryClient` is reachable through the fiber of `#notification-button`. `getQueryData(['notifications'])` is a **plain array** (no wrapper); query `status: 'success'`.
- Server response of `GET {W.Config.paths.notifications}` (`/row-Descartes/app/Feed/Notifications`, credentials included): `{ notifications: { objects: [ item, … ] } }`; the cache holds `objects` directly.
- Item: `{ id, type: 'COUNTRY_MEETUP', timestamp (ms), parameters: { sender, subject, title, message, shortMessage, imageURL, buttonText, buttonURL, linkText, linkURL } }`. Only type seen in real data is `COUNTRY_MEETUP` (WME's own release/meetup notices), so it is a safe neutral type. **No read/unread field on the item.**
- Counter: `<wz-notification-indicator class="counter" value="2">` = number of items (2 items → 2); read state is therefore not in the item.

- Opening a notification sends **no read request**: the only request seen is another `GET Feed/Notifications` (refetch, same payload). So "read" has no server call to answer locally; opening only needs to be handled by the library's own state.

- There is **no read/unread state** in the native bell: the counter only drops when an item is deleted or expires; opening one changes nothing. Our items must mirror that (counter = count of items; opening doesn't mark anything).

- After the trash click, a `GET Feed/Notifications` follows (refetch) and the server list no longer has the deleted item. The DELETE is `DELETE {W.Config.paths.notifications}/{id}` (e.g. `/row-Descartes/app/Feed/Notifications/98d14319-…`), empty body, `content-type: application/x-www-form-urlencoded`, `x-csrf-token` header, credentials included; it matches `nativeNotification.requestPattern` for our `was-…` ids. No other request is sent for "read".

- `W.map.showConfirmationDialog({ title, content, lonLat: { lon, lat } })` accepts the SDK format (WGS84): with `{ lon: -46.63, lat: -23.55 }` (São Paulo, off-screen) nothing was visible; with the coordinates of the visible area the balloon (title, content, Cancel/Apply) appeared on the map, anchored with a pointer. Calling it again while one is open rejects the older promise (uncaught error with an `undefined` reason in the console): `confirmOnMap` must catch it.

### Confirmed with the library loaded (phase 5a, production v2.374-5, 2026-10-25, Opera GX via CDP, library injected)
- Injected items survive the native refetch (opening the bell, deleting) and a reload; the WME counts them (`wz-notification-indicator` **property** `value`; the attribute may lag).
- The native bell and the map balloon render `title`/`message`/`content` as **text** (`<b>x</b>` shows literally): no extra escaping needed.
- The native bell renders `buttonURL` as an `<a>`: `#was-action:` runs the action, no tab opens.
- Trash on our item: no request reaches the server (only the usual refetch `GET`). Direct `fetch`/XHR `DELETE …/was-…` are answered locally.
- A native snackbar (`W.app.showSnackbar`) interrupting ours: ours comes back once, then the queue goes on.
- Map balloon: markup `.tippy-box .map-balloon-confirm` (`wz-h4` title, `wz-body2` content, `wz-button`s). It stays open and answerable after panning the map. A second call rejects the first (→ `false`). `alarming: true` doesn't change the button color.
- **The async SDK (`mode: 'async'`) returns promises from `Map.getMapCenter()`/`Map.getMapExtent()`**: a promise passed as `lonLat` crashes the WME React tree ("Algo deu errado"). Always `await` SDK getters.
- In a **hidden tab** (`visibilityState: 'hidden'`, throttled timers) `wz-dialog.hideDialog()` doesn't finish: the dialog stays and the queue waits until the tab is visible again (then it closes by itself).
- The WME language follows the account preference: `/es/editor` redirects to the account locale.

- Beta v2.376-1 behaves the same (queues, bell `query`, `map.confirm`).
- The WME has no native dark theme (only Discuss); with a third-party dark-mode script the `wz-*` components follow it, nothing of ours stays light.
- RTL (simulated with `dir="rtl"` on `<html>`): the `wz-dialog` mirrors, but its native × (`.dismiss-button` in the shadow root) stays on the right, over the title.
- Measured on Beta v2.376-1 (phase 5b, `sm` = 400 px): × is `position: absolute`, 24 px wide, 16 px from the right edge; the header's shadow `div.wz-dialog-header` has `padding: 0 24px` and spans the full width, so in both directions the title area reaches under the ×. `wz-dialog-header` host is `display: inline`.
- Stencil reflects `dismissible` as an empty attribute (`dismissible=""`) once upgraded; `dismissible="false"` stays as set. Select it with `[dismissible]:not([dismissible="false"])`.
- A freshly created and connected `wz-dialog` had **no** `componentOnReady()` (TypeError when called; the library already uses `?.()`); `showDialog()` worked right after it.

### Pending
- Whether the bell has a "delete all" that sends our ids in bulk.
- A WME `wz-dialog` open while ours is queued (not reproduced).

Cross-tab sync works (Beta, two tabs): a notification added in one tab shows in the other's bell and counter; removing it in the second removes it in the first.

Loading through Tampermonkey `@require file:///…` works (Beta, 2026-10-25) once the browser grants Tampermonkey "Allow access to file URLs" (`chrome.extension.isAllowedFileSchemeAccess`); without it the script silently doesn't run.

## 5. Conventions (same as the author's other scripts)

- 4-space indent, single quotes, `${ expr }` with inner spaces, semicolons, **CRLF**, `let` for locals, loose `==` is fine, aligned `=` in consecutive assignments, braceless single-statement `if` on the next line, blank line after blocks.
- **Every method has a JSDoc block** (summary, `@param`, blank ` *`, `@returns`). Inline comments only for a non-obvious why.
- Handlers in `this.bound`, debounced functions in `this.debounced`, timers in `this.timers`. DOM ids/classes `was-`. Logging only through `this.logDebug(message, force, type)`.
- Every external string reaches the DOM escaped (`escapeHtml`) or via `textContent`.

## 6. i18n

- `getTranslationsFor(localeCode)` switch at the end of the file: 44 `case`s + `default` (en-US, canonical keys). en-AU/en-GB have no block (English). Fixed indentation (12 `case`, 16 `translations = {`, 20 sections, 24 keys) for `scripts/i18n.mjs`.
- Only `default` holds every key; a locale holds only real translations (no copies of English — `check.mjs` refuses them). Never hand-edit the blocks: `node scripts/i18n.mjs set <key> <file.json>`.
- Never translate: WME Alert System, Waze, WME, Discuss, Greasy Fork, SDK.

## 7. Testing

Nothing runs locally besides `node scripts/check.mjs`. Real verification = Tampermonkey on https://www.waze.com/editor (logged in): skill `test-in-wme`. Say what was not verified instead of claiming it works.

## 8. References

- WME SDK docs: https://web-assets.waze.com/wme_sdk_docs/production/latest/index.html · beta: https://web-assets.waze.com/wme_sdk_docs/beta/latest/index.html · typings: `…/production/latest/wme-sdk-typings.tgz`.
- WME React Components (props of the `wz-*` elements): https://github.com/WazeSpace/wme-react-components (stale: 2024, React 17; no dialog/snackbar wrappers).
- Fiber/webpack access patterns: https://github.com/WazeSpace/wme-suggestion-assist (`utils/react-fiber`, `webpack-injector.ts`).
- Ported code: `../WME Não sei que nome dar ainda/wazeChatPlus.js` (`openDialog`, `showSnackbar`, changelog, i18n, utilities).
