# 0002 — Word info as pluggable Detail Modules

**Status:** accepted (v1)

## Context
The click-a-word panel and Word Cards should show configurable details that can be added or removed.

## Decision
Each detail (definition, root, conjugations, own-session examples, etc.) is a Detail Module with a common interface: given a Lemma, return a renderable section or nothing. The panel and the Word Card render whichever modules are enabled, in configured order.

## Consequences
- New data sources are added as modules without touching the UI shell.
- Each module owns its own data source (dictionary, Tatoeba, learner history).
- A module that fails or has no data is skipped, not fatal.
