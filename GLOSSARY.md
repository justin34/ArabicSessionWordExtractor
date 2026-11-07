# Interactive Language Learning — Domain Context

A desktop app that listens to spoken Arabic (class, videos), shows a live visual transcript with English glosses, and builds a growing vocabulary with auto-generated study guides.

## Glossary

- **Session** — one recording run (a class, a video). Owns one Transcript and one or two audio tracks: a **Desktop Track** (always; the transcribed one) and an optional **Mic Track** (separate file, not transcribed).
- **Transcript** — ordered list of Utterances for a Session, with timings.
- **Utterance** — one sentence/segment of speech: Arabic text, sentence translation (English), start/end time, and its Tokens.
- **Token** — one word occurrence in an Utterance: surface form, time span, per-word English gloss, link to a Lemma.
- **Surface form** — the word exactly as heard/written (e.g. كَتَبُوا).
- **Lemma** — dictionary form a Token resolves to. **This is the unit of the Vocabulary.** Surface forms heard are tracked on the Lemma.
- **Vocabulary** — the global, append-only set of Lemmas the learner has heard, with first-heard date, occurrence count, and the Sessions/Utterances where each appeared.
- **Word Card** — per-Lemma study guide, auto-generated from Detail Modules.
- **Session Guide** — per-Session study guide: new Lemmas, grouped, linking to their Word Cards.
- **Detail Module** — a pluggable unit that contributes one section of word info (e.g. definition, root, conjugations, example sentences from the learner's own Sessions). Modules can be added/removed/reordered without touching the rest of the app. Used by the click-a-word panel and Word Cards.
- **Session List** — the home screen: past Sessions, and the entry point to start a new one. Opening a completed Session shows its Replay View; opening a recording Session shows its Live View.
- **Live View** — the recording screen: Arabic (RTL) with English gloss under each word, plus a sentence translation line.
- **Demo Session** — a developer-only Session fed by a scripted fake transcript, kept in memory and never stored. Shown with a Demo badge; hidden in packaged builds.
- **Replay View** — plays a Session's audio while highlighting the current Token/Utterance, same visuals as Live View.

## Decisions (v1)

| Area | Decision |
|---|---|
| Platform | Desktop app (Electron or Tauri); can capture mic and, later, system audio |
| STT | Cloud streaming API behind a swappable provider interface |
| Language | Arabic → English only, hardcoded. **MSA (Fusha) only** |
| Vocabulary unit | Lemma; surface forms tracked |
| Translation | Word-level gloss and sentence-level, both |
| Study guides | Word Cards and Session Guides; **read-only** (no SRS/quizzing in v1) |
| Word data | Dictionary / open data (modular per source), not LLM-generated |
| Storage | Local only: SQLite plus audio files on disk. No accounts |
| Lemmatizer | Python sidecar running CAMeL Tools (lemma, root, POS), bundled with the app |
| Ambiguity | Sentence-context disambiguation (CAMeL disambiguator) picks one reading per Token; no manual step in v1 |
| STT provider | Deepgram Nova-3 (streaming) as the first adapter. Chosen on latency; no independent MSA benchmark exists, so validate with a short real-MSA test and keep the provider interface swappable |
| Sentence translation | Google Cloud Translation, called once per finalized Utterance. Per-word glosses come from the dictionary, not this service |
| STT cost | Key-in-config for now (settings field); distribution model (BYO key vs proxy) deferred |
| Audio source | Mic plus system-audio loopback |
| Interim text | Shown muted in Live View; glosses and lemmas attach only when the Utterance is finalized |
| Session audio | Desktop (loopback) audio is always the transcribed source. Mic is an optional second track, chosen at Session start, recorded as a separate audio track and never transcribed. Classes are online (teacher arrives via desktop audio) |
| OS | Windows only for v1 (WASAPI loopback via Electron); macOS/Linux deferred |
| Shell | Electron, spawning the Python sidecar |
| Licensing | App is open source. This makes bundling GPL v2 pieces (CAMeL database, Qutrub) and CC BY-SA / CC BY data (Wiktionary, Tatoeba) workable. Still need: pick a compatible app licence (GPL v2-or-later or GPL v3 is the simplest fit), add an attribution/credits screen, and keep third-party licence files in the repo |
| Audience | Distributed to other learners: needs an installer, bundled models, and an STT key/cost strategy |

## Dictionary plan (v1, proposed)

Detail Modules and the source behind each. All data is looked up locally from one bundled SQLite file built by an offline build script, never from raw dumps at runtime.

| Detail Module | Source | Notes |
|---|---|---|
| Lemma, part of speech, root, pattern | CAMeL analyzer output (`lex`, `pos`, `root`, `pattern`) | Verified fields. Runs per Token in the sidecar |
| Quick gloss (shown under the word in Live View) | CAMeL `gloss` / `stemgloss` | Machine-style gloss (e.g. `make_walk;adjust+you`), so the Live View should use the stem gloss or Wiktionary's first sense, not the raw string. Needs a quality check on real transcripts |
| Pronunciation | CAMeL `caphi` | Phonetic transcription, from the diacritized form |
| Full definitions, etymology, related forms | Wiktionary (English edition) via wiktextract/kaikki | Build script filters to Arabic entries and to forms we need. No licence stated on kaikki; Wiktionary text is CC BY-SA, so attribute |
| Example sentences (general) | Tatoeba AR-EN (about 31k pairs, CC BY 2.0) | Optional module; simple sentences |
| Your own examples | The learner's own Utterances | Built from Vocabulary history |
| Verb conjugation | Qutrub (GPL) or CAMeL generation | Decide later; not v1-critical |

Facts established: CAMeL provides `diac`, `lex`, `caphi`, `gloss`, `pos`, `root`, `pattern`, clitic fields and `stemgloss`. Kaikki's Arabic file is 827.9 MB (about 177k distinct word forms) but is marked **deprecated**; the supported source is the raw all-languages dump (2.9 GB compressed, 24.8 GB uncompressed). The build script should therefore extract Arabic entries from the raw dump once, or run wiktextract ourselves, and ship only the compact result.

## Installer size (researched)

Verified: CAMeL's MSA data is small: `morphology-db-msa-r13` 40.5 MB plus `disambig-mle-calima-msa-r13` 88.7 MB (both GPL v2), about 129 MB together. `camel_data -i light` installs only the morphology and MLE disambiguation data. The large packages (AraBERT NER and sentiment 541.6 MB each, mBERT 712.5 MB, dialect ID 282.3 MB) are not needed and are excluded.

Verified: `camel-tools` hard-requires `torch>=2.0`, `transformers>=4.44.0`, `scikit-learn`, `scipy`, `pandas` and `numpy>=2.0` in `setup.py`, even though morphology plus MLE disambiguation does not obviously need torch/transformers. A normal pip install would therefore bundle torch (likely several hundred MB; unmeasured).

Estimate, unmeasured: Electron shell about 100-150 MB; embedded Python plus numpy/pandas/scipy/sklearn a few hundred MB; dictionary SQLite (Wiktionary extract, Tatoeba) tens to low hundreds of MB. Total is dominated by torch, if included.

Mitigation options, to be tested in a spike: (a) install `camel-tools` with `--no-deps` and only the needed dependencies, checking that the morphology and MLE disambiguator import without torch/transformers; (b) vendor those modules; (c) accept a large installer. Option (a) is the first thing to try.

## Open questions

1. ~~Lemmatization~~ Resolved: CAMeL Tools Python sidecar. Remaining: sidecar packaging size, startup time, and how the Electron/Tauri shell supervises it.
2. ~~Ambiguity~~ Resolved: context disambiguation. Remaining: does a wrong pick need a correction UI later?
3. **Dictionary source** (plan proposed above; remaining: verify gloss quality on real audio, and confirm the Wiktionary extract's licence and size once built). Findings: CAMeL's default MSA database (calima-msa-r13, about 40 MB, derived from MADAMIRA's almor-msa-r13) is **GPL v2**; Qutrub (verb conjugation) is **GPL**; Wiktionary-derived data (via kaikki.org, English-Wiktionary edition) is *probably* CC BY-SA, unverified; Tatoeba is CC BY 2.0 (about 31k Arabic-English pairs). Unverified: calima gloss/root fields, kaikki Arabic file size/licence, Arabic WordNet. Distribution implications of GPL/share-alike need a licensing decision (item 10). Original note: which open Arabic→English data (Wiktionary dumps, Tatoeba for examples, others) and how is it bundled offline?
4. ~~Audio source / OS~~ Resolved: Windows, Electron, desktop audio transcribed, optional separate mic track. Replay plays both tracks (Desktop Track and Mic Track, when a Mic Track exists), kept as separate files and played in sync. Remaining: per-track volume/mute controls in Replay View?
5. **Sentence translation**: which service, and does it run live per Utterance or after the Utterance finalizes?
6. ~~Interim results~~ Resolved: muted interim, finalize on commit.
7. **Cost/privacy**: audio goes to a cloud STT API even though storage is local; is that acceptable for class recordings? Distribution model for the STT key is deferred.
8. ~~STT provider~~ Decided: Deepgram. Remaining: run a 5-10 minute MSA test (class clip plus news clip) against Deepgram and one alternative (Soniox or Azure) before locking in.
10. ~~App licensing~~ Decided: open source. Remaining: choose the exact licence (GPL v2-or-later is the safest match for GPL v2 components; confirm Qutrub's version, and check Deepgram/Google API terms don't conflict with open-sourcing the client), and confirm kaikki/Wiktionary file licence.
9. ~~Sentence translation~~ Decided: Google Cloud Translation. Remaining: two third-party API keys (Deepgram and Google) now sit behind the distribution/cost question in item 7.
