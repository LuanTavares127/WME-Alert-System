# WME Alert System

A library for Waze Map Editor (WME) userscripts. It shows dialogs, snackbars and bell notifications **with the WME's own components**, queued across every script that uses it, so they never pile up on top of each other. It also shows one grouped "What's new" dialog for all the scripts updated since the last visit.

- **Dialogs**: native `wz-dialog`, one at a time, in the order they were requested. They also wait for the WME's own dialogs.
- **Snackbars**: native `wz-snackbar`, one at a time, like the WME. They wait for the editor's own snackbars.
- **Bell notifications**: they appear in the WME notification list, persist across reloads and can run an action of your script.
- **Unified changelog**: per script, either a grouped dialog or a bell notification.
- **Extras**: confirmation balloon on the map (`W.map.showConfirmationDialog`), and a `wz-alert` inside your script tab.
- **Languages**: 47 locales.

## Usage

Copy the versioned `@require` URL from the library's page on Greasy Fork: https://greasyfork.org/scripts/602363-wme-alert-system. Source code: https://github.com/LuanTavares127/WME-Alert-System.

```js
// @require https://update.greasyfork.org/scripts/602363/<version-id>/WME%20Alert%20System.js
// @grant   unsafeWindow

const alerts = (await WmeAlertSystem.ready()).register({
    scriptId: 'my-script',
    scriptName: 'My Script',
    version: GM_info.script.version,
    changelog: { mode: 'dialog', loader: () => fetch('https://api.npoint.io/<bin>').then(response => response.json()) },
    links: { greasyFork: 'https://greasyfork.org/scripts/<id>' }
});

// Dialogs (queued)
let confirmed = await alerts.dialog.confirm('Delete places', 'Delete the 12 selected places?', { alarming: true });
let { result } = alerts.dialog.show({ title: 'Export', content: '<p>Choose a format.</p>', actions: [{ label: 'CSV', value: 'csv' }, { label: 'JSON', value: 'json' }] });

// Snackbars (queued)
alerts.snackbar.show('Settings saved.');

// Bell notifications (persisted; handlers must be set on every load)
alerts.notification.onAction('open-report', notification => openReport(notification.data.id));
alerts.notification.add({ id: 'report-42', title: 'Report ready', message: 'Your report finished.', buttonText: 'Open', action: 'open-report', data: { id: 42 } });
```

Changelog entries use the shape `{ version, date: 'YYYY-MM-DD', changes: { en: '<html>', 'pt-BR': '<html>', … } }`, newest first.

Texts (`title`, `text`, labels, notification fields) are plain text. `content` and changelog `changes` are trusted HTML from your own script.

Pressing a notification's `action` button closes the bell popup before your handler runs; pass `keepOpen: true` to `add()` to leave it open.

A notification's `data` must be JSON-serializable (`add()` throws a `TypeError` otherwise); it is stored as a copy. Notification texts are stored as given: if the user changes the WME language, your old notifications keep the language they were created in (the library's own "updated" notices follow the current language).

`map.confirm()` has no `alarming` option: the WME map balloon has no red style. Use `dialog.confirm(title, text, { alarming: true })` when the action needs a red button.

In a background tab the browser throttles the page: a dialog closed with `dialog.close(id)` resolves right away, but it only leaves the screen (and the next dialog only opens) once the tab is visible again.

Several scripts may `@require` different versions: only the newest one starts, and every script shares it.

## License

GPLv3
