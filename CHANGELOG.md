# Changelog

All notable changes to WME Alert System. Aimed at script authors who `@require` the library; end users are not notified of library updates.

Format based on [Keep a Changelog](https://keepachangelog.com/). Changes that break the public API (`register()` and the client) are marked **Breaking**.

## [Unreleased]

### Added
- `notification.add({ keepOpen })`: by default an `action` button now closes the bell popup before the handler runs; `keepOpen: true` leaves it open.

### Changed
- Changelog in `notification` mode keeps one notice per script: a newer update replaces an unopened notice, and its button still shows every version since the last one seen.

## [1.0.0] - 2026-10-26

First public release.

### Added
- Singleton bootstrap shared by every `@require`d copy (the newest version wins).
- Dialog queue (FIFO across scripts), snackbar queue, bell notifications (native `query` strategy with DOM fallback), per-script changelog (`dialog` or `notification`), map confirmation balloon and inline alerts.
- Translations for 47 locales.
