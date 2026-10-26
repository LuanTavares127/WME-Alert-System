# Changelog

All notable changes to WME Alert System. Aimed at script authors who `@require` the library; end users are not notified of library updates.

Format based on [Keep a Changelog](https://keepachangelog.com/). Changes that break the public API (`register()` and the client) are marked **Breaking**.

## [0.1.0] - 2026-10-25

First development version (not published yet).

### Added
- Singleton bootstrap shared by every `@require`d copy (the newest version wins).
- Dialog queue (FIFO across scripts), snackbar queue, bell notifications (native `query` strategy with DOM fallback), per-script changelog (`dialog` or `notification`), map confirmation balloon and inline alerts.
- Translations for 47 locales.
