# 0003 — electron-builder NSIS Installer with electron-updater

**Status:** accepted (v1); built in #36

## Context
The app goes to other learners as a Windows x64 Installer from GitHub Releases. The Installer must install for the current user without admin, show the GPL-2.0-or-later licence, let the learner choose the install folder, offer "Also delete my recordings and vocabulary" (unticked) on uninstall, and update itself from GitHub Releases without ever restarting during a recording.

## Decision
Package with electron-builder's NSIS target (`oneClick: false`, `perMachine: false`, folder choice allowed) and update with electron-updater from the repo's GitHub Releases. The uninstall checkbox is a small custom NSIS include.

## Considered Options
- **Electron Forge + Squirrel.Windows**: per-user and auto-updating, but shows no installer pages, so no licence page, no folder choice and no uninstall checkbox.
- **MSIX / Microsoft Store**: needs a Store account and review; not how this open-source app is distributed.

## Consequences
- Hard to reverse: an installed copy only updates through the updater it shipped with, so moving to another format later strands every installed copy on its last NSIS version unless a bridging release is made.
- Code signing can be added later through electron-builder's config without changing the Installer.
- The update feed is tied to the repo's owner/name, so the repo is renamed before the first release.
