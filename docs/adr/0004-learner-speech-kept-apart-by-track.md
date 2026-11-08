# 0004 — Learner speech is kept apart by Track, and transcribed but never analyzed

**Status:** accepted

The learner can have their own speech (the Mic Track) transcribed, so they can see what they said. A mispronounced word must never become a study word, so every Utterance records the **Track** it was heard on, and a Learner Utterance (Mic Track) is translated but never analyzed: no Lemma, gloss or word panel, and nothing in the Vocabulary, Word Cards, Session Guide or Anki export. Each Track gets its own speech-to-text stream, so who spoke is known from where the audio came from, never guessed.

## Considered options

- **One mixed stream with Soniox speaker diarization.** Cheaper (one stream), but who spoke becomes a guess, and every wrong guess puts the learner's mispronunciations back into the Vocabulary: the exact failure this feature exists to prevent. Rejected.
- **Analyze Learner Utterances but keep them out of the Vocabulary.** Would give glosses and clickable words, but CAMeL would analyze misheard words into wrong Lemmas, and a click would open a Word Card the word cannot belong to. Rejected; the sentence translation is the feedback the learner gets.

## Consequences

- Two paid streams while the learner speaks (roughly double speech-to-text usage), so mic transcription is opt-in per Session.
- Every reader of Utterances that feeds study material (Vocabulary, Word Cards, Session Guide, `own-examples`, `sessions`, Anki) must filter to the Desktop Track. Sessions stored before this decision are all Desktop.
- Bleed (the teacher heard through speakers) is still transcribed as the learner; headphones and a mic threshold on the speech-to-text feed mitigate it, not this decision.
