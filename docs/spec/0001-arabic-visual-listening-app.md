# Spec 0001 — Visual Arabic listening app (v1)

Triage label (to apply once a tracker exists): `ready-for-agent`

Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). Decisions follow ADR 0001 (lemma as vocabulary unit) and ADR 0002 (Detail Modules).

## Problem Statement

I am learning Modern Standard Arabic and hear a lot of it in online classes and videos, but it passes too fast. I cannot see the words as I hear them, I do not know their meanings in the moment, and nothing keeps track of which words I have already met. Afterwards I have no organized material to study from, and I cannot re-listen to a class with the words in front of me.

## Solution

A Windows desktop app that records the audio playing on my computer (and optionally my microphone as a separate track), shows a live transcript in Arabic script with an English gloss under each word and an English sentence translation, and lets me click any word to see details about it. Every word I hear is added, by its dictionary form, to a growing Vocabulary. The app automatically builds a study card for each word and a study guide for each recording. Each recording keeps its transcript, and I can replay the audio while the same word-by-word view follows along.

## User Stories

1. As a learner, I want to start a Session with one click, so that I can begin capturing a class or video without setup each time.
2. As a learner, I want the desktop audio always captured and transcribed, so that online classes (Zoom/Teams) and videos are covered.
3. As a learner, I want to choose at Session start whether to also record my microphone, so that I can capture my own speaking when I want to.
4. As a learner, I want the microphone saved as a separate track that is never transcribed, so that my own voice and room noise never pollute the transcript.
5. As a learner, I want to stop a Session and have everything saved automatically, so that I never lose a recording.
6. As a learner, I want to see Arabic text appear live as it is spoken, so that I can connect sound to written words.
7. As a learner, I want Arabic displayed right-to-left and rendered correctly, so that it is readable.
8. As a learner, I want an English gloss under each Arabic word, so that I understand words as they appear.
9. As a learner, I want a full English sentence translation under each sentence, so that I understand the meaning, not just the words.
10. As a learner, I want unfinished text shown in a muted style that firms up when the sentence is final, so that I get fast feedback without being misled.
11. As a learner, I want glosses and dictionary forms to attach only once a sentence is final, so that they are stable and not flickering.
12. As a learner, I want to click any word in the Live View, so that I can see more about it without leaving the recording.
13. As a learner, I want the word panel to show the dictionary form, root, part of speech and pronunciation, so that I understand how the word is built.
14. As a learner, I want the panel to show full definitions from a dictionary, so that I get accurate meanings.
15. As a learner, I want example sentences, including ones from my own earlier Sessions, so that I see words in context.
16. As a learner, I want to see which Sessions a word appeared in, so that I can trace where I met it.
17. As a learner, I want the sections in the word panel to be configurable (added, removed, reordered), so that I see only the details I care about.
18. As a learner, I want a missing or failing detail section to simply not appear, so that one gap never breaks the panel.
19. As a learner, I want every heard word added to my Vocabulary automatically, so that I do not have to save words by hand.
20. As a learner, I want the Vocabulary to hold dictionary forms, not every spelling, so that the list stays clean.
21. As a learner, I want the different spellings I heard recorded on each entry, so that I see how words actually appeared.
22. As a learner, I want first-heard date and number of times heard on each Vocabulary entry, so that I can see what I meet often.
23. As a learner, I want to browse and search my Vocabulary, so that I can find any word I have met.
24. As a learner, I want a Word Card generated automatically for every word, so that I always have study material.
25. As a learner, I want a Session Guide generated automatically when a Session ends, so that I can review what was new.
26. As a learner, I want the Session Guide to list the new words from that Session and link to their cards, so that I can move between guide and cards.
27. As a learner, I want every Session to keep a full transcript, so that I can read it later.
28. As a learner, I want to browse a list of past Sessions, so that I can open any recording.
29. As a learner, I want to replay a Session's audio, so that I can listen again.
30. As a learner, I want the same word-by-word view to follow the audio in Replay, with the current word highlighted, so that I can read along.
31. As a learner, I want Replay to play the desktop track and, if it exists, my microphone track together in sync, so that I hear the whole Session.
32. As a learner, I want to click a word during Replay and see its details, so that studying works the same as live.
33. As a learner, I want to jump to any sentence in the transcript and have the audio seek to it, so that I can re-listen to a specific part.
34. As a learner, I want my data stored only on my computer, so that class content stays private.
35. As a learner, I want to enter my own Deepgram and Google API keys in a settings screen, so that the app works without a hosted service.
36. As a learner, I want a clear message when a key is missing or invalid, so that I know how to fix it.
37. As a learner, I want the app to keep recording audio even if transcription fails or the network drops, so that I never lose the recording.
38. As a learner, I want the transcript to catch up or be re-generated for a dropped stretch where possible, so that a short outage does not leave a permanent gap.
39. As a learner, I want a credits screen showing the data sources and licences used, so that attributions are respected.
40. As a developer, I want transcription, translation, Arabic analysis and dictionary each behind a swappable interface, so that I can change providers without touching the rest.
41. As a developer, I want the Arabic analysis helper started, supervised and restarted by the app, so that users never manage it manually.
42. As a developer, I want a build step that turns Wiktionary and Tatoeba data into one compact local database, so that the app never reads raw dumps at runtime.
43. As a contributor, I want third-party licence files kept in the repository, so that GPL and share-alike obligations are met.

## Implementation Decisions

- **Platform:** Windows desktop app built on Electron. Desktop (loopback) audio is captured natively through Electron; the Python helper is spawned and supervised by the app.
- **Core domain objects:** Session, Transcript, Utterance, Token, Lemma, Vocabulary, Word Card, Session Guide, Detail Module (see GLOSSARY.md). A Session owns a Desktop Track and an optional Mic Track.
- **Session pipeline (the deep module):** takes the Desktop Track audio stream, produces Utterances in order. Interim results update the display; when an Utterance is final it is sent for sentence translation and for Arabic analysis of its Tokens, then stored. Results arrive in the Live View as they complete.
- **Provider interfaces (four, each swappable):**
  - Speech-to-text: streaming audio in, interim and final text with word timings out. First adapter: Deepgram Nova-3.
  - Sentence translation: Arabic sentence in, English sentence out. First adapter: Google Cloud Translation.
  - Arabic analysis: whole final sentence in, one analysis per Token out (diacritized form, dictionary form, part of speech, root, pattern, pronunciation, attached prefixes and suffixes, stem gloss), with the reading chosen using sentence context. First adapter: a CAMeL Tools Python helper (morphology plus sentence-context disambiguation, MSA only).
  - Dictionary: dictionary form in, definitions, etymology, example sentences out, from the local database.
- **Vocabulary:** keyed by dictionary form (ADR 0001). Each entry records surface forms heard, first-heard time, count, and links to Utterances. New Tokens are appended automatically when an Utterance is finalized.
- **Detail Modules (ADR 0002):** common interface, given a Lemma return a renderable section or nothing. Initial modules: dictionary form / part of speech / root / pattern; pronunciation; definitions and etymology; general example sentences (Tatoeba); the learner's own examples; Sessions where heard. Verb conjugation is deferred. The word panel and Word Card render enabled modules in configured order; a module that errors or has no data is skipped.
- **Quick gloss:** the gloss under each word comes from the dictionary's first sense, falling back to CAMeL's stem gloss. CAMeL's raw machine gloss is not shown directly.
- **Study guides:** Word Card generated when a Lemma is first created; Session Guide generated when a Session ends. Both are read-only and built from Detail Modules and Session data. No quizzing or spaced repetition in v1.
- **Audio storage:** Desktop Track and Mic Track are separate files per Session, kept on disk. Replay plays both in sync. Transcript timing is based on the Desktop Track.
- **Storage:** local SQLite for structured data plus audio files on disk; no accounts and no cloud sync.
- **Dictionary data build:** an offline build script extracts Arabic entries from Wiktionary data and example pairs from Tatoeba into one compact SQLite file shipped with the app. The kaikki Arabic-only file is deprecated, so the script works from the supported raw dump or runs the extractor itself. Attribution is shown in the app.
- **Dependencies/installer:** CAMeL's MSA data (about 129 MB: morphology database and disambiguation model) is used; the large AraBERT, mBERT and dialect packages are excluded. CAMeL declares torch and transformers as hard dependencies; the intent is to install it without them if morphology and disambiguation work, otherwise vendor the needed modules. This is unresolved (see Further Notes).
- **Keys and cost:** Deepgram and Google keys are entered by the user in a settings screen for now. The distribution model for keys is deferred.
- **Licensing:** the app is open source. GPL v2 components (CAMeL database, possibly Qutrub) and CC BY-SA / CC BY data (Wiktionary, Tatoeba) are bundled with attribution and licence files. The exact app licence is not yet fixed (GPL v2-or-later is the likely fit).

## Testing Decisions

- **What makes a good test:** exercise external behavior only (what comes out of the Session pipeline, what the Replay View shows), never internal structure. Tests should survive refactors of internals.
- **Seam 1 — Session pipeline (the main seam):** feed it a recorded Arabic desktop audio file with the four provider interfaces replaced by fakes (scripted interim and final text, fixed translation, fixed analyses, a small dictionary). Assert on the resulting Transcript, Utterance timings, Vocabulary entries (dictionary form, surface forms, counts, first-heard), Word Cards and the Session Guide. Also assert on failure paths: provider errors, dropped stream, missing keys, a detail module that fails.
- **Seam 2 — Arabic analysis:** test the real CAMeL helper directly with real MSA sentences and assert on dictionary form, root, part of speech and the chosen reading in context, including known ambiguous cases (for example the same undiacritized spelling in different sentences). This is the riskiest component, so it is tested against the real tool, not a fake.
- **Replay timing:** a small additional check that, given a finished Transcript and its two tracks, Replay highlights the right Token at a given playback position and seeks correctly. Driven by data, not live providers.
- **Prior art:** none; the repository is empty. These tests set the pattern.
- **Manual validation, not automated:** a 5–10 minute real-MSA listening test comparing Deepgram with one alternative, and a review of gloss quality on real transcripts.

## Out of Scope

- Any language other than Arabic to English; any Arabic variety other than Modern Standard Arabic (no dialects).
- macOS and Linux.
- Transcribing the microphone; speaker identification.
- Spaced repetition, quizzes and any review mode beyond reading.
- Cloud sync, accounts, multi-device use.
- Showing vowel marks (tashkeel) in the transcript, and transliteration.
- A screen to correct a wrong dictionary-form choice.
- Verb conjugation tables (deferred).
- A hosted proxy for API keys and any billing.
- Offline speech-to-text.

## Further Notes

- **Unresolved risks that could change the design:** (1) whether CAMeL's morphology and disambiguation run without torch and transformers, which decides installer size; (2) whether Deepgram's streaming accuracy on real MSA is good enough; (3) whether the dictionary-based quick gloss is good in practice.
- **Open items:** per-track volume or mute in Replay; the exact app licence and confirmation that the Deepgram and Google terms allow an open-source client; who pays for API keys on distribution; confirming the licence and size of the built Wiktionary extract; the cloud privacy tradeoff (audio goes to a cloud service even though storage is local).
- **Tracker:** no issue tracker or triage vocabulary was configured, so this spec is a local file. Run the setup skill (`/setup-matt-pocock-skills`) to configure one, then publish it with the `ready-for-agent` label.
