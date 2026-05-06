# Changelog

All notable changes to this project will be documented in this file.

## [2.5.9] - 2026-05-06

### Fixed

- Resolve the installed `@openclaw/zalouser` send API from the container's `.openclaw/npm/node_modules` path so `/post-start` and other poster commands can reply in Zalo.

## [2.5.8] - 2026-05-06

### Fixed

- Allow `/post-start` to create a draft before the N8N webhook is configured; webhook configuration is now required when `/post-send` is used.
- Add command and send-result logs so Zalo hook delivery can be verified from container logs.

## [2.5.7] - 2026-05-06

### Fixed

- Removed deprecated `kind: "runtime"` from the plugin entry and manifest for OpenClaw v2026.5.x compatibility.
- Added `activation.onCapabilities: ["hook"]` so the startup planner explicitly treats the plugin as a hook plugin.

## [2.5.6] - 2026-05-05

### Fixed

- Added `.clawhubignore` so ClawHub packages exclude dev/runtime files.
- Removed checked-in `config.json`; the plugin creates runtime config locally when needed.

## [2.5.5] - 2026-05-05

### Added

- Standardized plugin structure with `README.md` and `CHANGELOG.md`.

### Changed

- Changed package name to `openclaw-n8n-facebook-poster`.
- Changed plugin author to `tuanminhhole`.
- Updated plugin ID and runtime ID to `openclaw-n8n-facebook-poster`.
