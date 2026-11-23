# 0005 — Removing a Session purges it, or leaves a tombstone when its words are kept

**Status:** accepted

The Vocabulary was append-only: every Occurrence points at an Utterance, and nothing was ever taken back. Removing a Session (#57) breaks that, so the learner chooses in the remove dialog:

- **Purge (the default).** The Session, its Transcript, Occurrences, Session Guide and audio files are deleted. Lemmas heard only there leave the Vocabulary, and the rest are recomputed from the Sessions that remain. A removed Session leaves no trace. This is the one exception to the Vocabulary being append-only.
- **Keep its words.** The Vocabulary is unchanged. The Session becomes a **Removed Session**: its `sessions` row stays with status `removed`, its name and start date, and no audio or Transcript, hidden from the Session List. Its Occurrences lose their Utterance and point at that row instead, so counts and first-heard dates still add up, and a Lemma can say it was "First heard 22 Nov in a removed Session".

In neither mode is another Session changed: no other Session Guide is regenerated (guides stay as generated, as before).

## Considered options

- **Delete only the audio and Transcript, always keeping the words.** Leaves Occurrences pointing at deleted Utterances, or counts that no longer match any Session. Rejected as the only mode, and kept as an option through the tombstone.
- **Soft delete with Undo, like Ignore.** Would keep audio files and rows in a pending state across restarts for a rare action. Rejected: a confirmation dialog lists the words that will go instead.
- **Regenerate later Session Guides after a purge.** Would keep every Lemma in some guide, but changes Sessions the learner did not touch. Rejected: a Lemma first heard in the removed Session and heard again later takes the later Session as first heard without joining its stored guide.

## Consequences

- `occurrences` gains a Session reference, and its Utterance becomes optional. Every reader of Occurrences (Vocabulary, Word Cards, `own-examples`, `sessions`, Anki) must handle an Occurrence with no Utterance, and every reader of `sessions` must skip `removed` rows unless it is naming where a Lemma was heard.
- Purging recomputes a Lemma's first-heard date, surface forms and count from its remaining Occurrences. A Lemma left with none is deleted with its Word Card.
- Audio files are deleted after the rows. A file Windows keeps locked is swept on the next launch with any other file no Session points to.
- Anki is still one-way: notes already imported for purged words stay in Anki, and the dialog says so.
