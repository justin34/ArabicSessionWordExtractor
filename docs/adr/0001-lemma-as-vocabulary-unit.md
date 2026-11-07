# 0001 — Lemma as the vocabulary unit

**Status:** accepted (v1)

## Context
Arabic is highly inflected and attaches clitics to words. Storing surface forms would flood the Vocabulary with duplicates of one word.

## Decision
The Vocabulary stores Lemmas. Each Token links to a Lemma; the Lemma records the surface forms heard.

## Consequences
- Requires an Arabic morphological analyzer in the pipeline.
- Undiacritized STT output makes lemma resolution ambiguous, so the analyzer must pick a best candidate and keep alternates.
- Word Cards are per-Lemma, which keeps study material compact.
