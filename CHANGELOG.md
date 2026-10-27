# Changelog

All notable changes to WME Alert System. Aimed at script authors who `@require` the library; end users are not notified of library updates.

Format based on [Keep a Changelog](https://keepachangelog.com/). Changes that break the public API (`register()` and the client) are marked **Breaking**.

## [1.2.1] - 2026-10-27

### Fixed
- Changelog dialog: the running version's notes are plain again (the script's HTML as is, no card, version or date: the dialog title already names the version), as in 1.1.0 and WME Speed Display; only the other versions (older versions of the update and "See previous changes") are cards. The notes area has a right padding so the text and the cards no longer touch the scroll bar.

## [1.2.0] - 2026-10-27

### Changed
- Changelog dialog: the notes of the update (one or several versions) are cards too, like the older versions of "See previous changes": version (a link to its code on Greasy Fork when the entry has a `versionId` and the script gave `links.greasyFork`) and date on top, notes below.

## [1.1.0] - 2026-10-27

### Added
- Changelog dialog: the older versions loaded by "See previous changes" are cards (version and date on top, notes below), like the history of WME Sidebar Wazeopedia; the notes of the update stay plain text. When the changelog entry has a `versionId` and the script gave `links.greasyFork`, the version links to `<greasyFork>?version=<versionId>` (tooltip `changelog.viewVersionCode`, translated).
- `notification.add({ keepOpen })`: by default an `action` button now closes the bell popup before the handler runs; `keepOpen: true` leaves it open.

### Changed
- Changelog in `notification` mode keeps one notice per script: a newer update replaces an unopened notice, and its button still shows every version since the last one seen.

## [1.0.0] - 2026-10-26

First public release.

### Added
- Singleton bootstrap shared by every `@require`d copy (the newest version wins).
- Dialog queue (FIFO across scripts), snackbar queue, bell notifications (native `query` strategy with DOM fallback), per-script changelog (`dialog` or `notification`), map confirmation balloon and inline alerts.
- Translations for 47 locales.
