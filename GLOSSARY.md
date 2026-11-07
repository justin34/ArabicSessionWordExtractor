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
| Vocabulary (#7) | Each final Utterance is analyzed alongside its translation, never holding up the next one; a failed analysis leaves that Utterance's words out of the Vocabulary. A Lemma is identified by the analyzer's diacritized dictionary form (`lex`), one row per spelling. Every analyzed word with a letter is an occurrence: the count is occurrences across all Sessions, first heard is the wall-clock time its Utterance went final, and each new surface form (punctuation stripped) is added to the Lemma. Analyzed words are matched to the timed Tokens by their letters, so each Token links to its Lemma. The Vocabulary screen searches the Lemma, surface forms, root and English stem gloss, ignoring diacritics, hamza on alef, ى/ي, ة/ه and case |
| Quick gloss (#8) | Each word in Live View shows a short English gloss under it once its Utterance is analyzed, stored on the Token. It is the bundled dictionary's first sense of the word's Lemma: its first comma/semicolon alternative without parenthesised qualifiers, or the shortest when that one is over 16 characters (a verb keeps only its "to …" alternatives). CAMeL's stem gloss (first alternative, clitic and bracketed parts dropped) is used instead when the dictionary has no fitting entry, when the dictionary's gloss is over 24 characters, and for prepositions, conjunctions, particles and interjections, which Wiktionary describes ("introduces a yes-no question") rather than translates ("does"). A Lemma matches the entry spelled with the same letters whose diacritized headword equals CAMeL's `lex` (ignoring the final short vowel, sukun, and fatha before a long alef) and whose part of speech fits; failing that, the sole entry of that spelling with a fitting part of speech. A proper name only matches a Wiktionary name. A failed lookup falls back to the stem gloss |
| Word panel (#9) | Clicking a word in Live View opens a side panel built from Detail Modules, for the word's Lemma and the surface form clicked. Built-in modules, in default order: `form` (dictionary form, form heard, part of speech, root, pattern), `pronunciation` (CAMeL CAPHI of the form heard), `definitions` (all Wiktionary senses, up to 8, and the etymology), `examples` (up to 3 Tatoeba sentences containing the Lemma or a heard surface form as a whole word, shortest first), `own-examples` (up to 5 of the learner's Utterances, most recent first) and `sessions` (each Session heard in, with times heard). Until the settings screen (#13), the modules shown and their order come from `detail-modules.json` in the app's data folder (a JSON array of module ids); without it all built-ins show. A module with no data, one that throws, and one that has not answered in 5 s are left out; so is a section the panel cannot render. A word whose Utterance is not analyzed yet opens the panel with a note instead of details |
| Study guides | Word Cards and Session Guides; **read-only** (no SRS/quizzing in v1) |
| Study guides (#10) | Both are stored as generated (`word_cards`, `session_guides` in `app.db`). A **Word Card** is built from the same enabled Detail Modules as the word panel, without a form clicked, when its Lemma first enters the Vocabulary (alongside that Utterance's glosses, so a Session waits for it before it completes). When a Session ends, the Word Cards of every Lemma heard in it are rebuilt in the background, keeping when each was first generated, so "Your examples" and "Heard in" include that Session. A **Session Guide** is generated as the Session ends. It lists the Lemmas first heard in that Session (heard in no earlier Session), in the order heard, grouped as Nouns, Verbs, Adjectives, Adverbs, Names and Other words (by CAMeL part of speech). Each word shows the first quick gloss one of its Tokens got there (else its stem gloss) and the times heard there, and links to its Word Card. A guide is not regenerated later. When the app opens, any Lemma without a Word Card and any completed Session without a Session Guide (one a crash ended, or data from before #10) gets one. A card whose modules all fail is stored with no sections; a failure never stops the Session completing. Opening a completed Session shows its Session Guide (Replay View joins it in #11); a Word Card opens from the guide or from the Vocabulary |
| Word data | Dictionary / open data (modular per source), not LLM-generated |
| Storage | Local only: SQLite plus audio files on disk. No accounts |
| Lemmatizer | Python sidecar running CAMeL Tools (lemma, root, POS), bundled with the app |
| Ambiguity | Sentence-context disambiguation (CAMeL disambiguator) picks one reading per Token; no manual step in v1. **Not met yet (found in #6):** camel-tools' MLE disambiguator, the only one that runs without torch, picks each word's reading out of context, so a bare ambiguous spelling (كتب, العلم) gets the same reading in every sentence. Clitics still tell readings apart (وكتبوا is a verb, فكتبها a noun). Tracked in #20; see open question 2 |
| STT provider | Soniox real-time (`stt-rt-v6`) as the first adapter, with `max_endpoint_delay_ms` 1000; Deepgram Nova-3 kept as the fallback behind the same interface. Changed from Deepgram by spike #3 (`scripts/spikes/stt-msa/`). On 15.5 min of real class MSA, Soniox made 5.5% word errors (3.2% at its default setting) to Deepgram's 9.2%. It writes standard spelling and punctuation, where Deepgram writes no hamza, no ة and almost no punctuation. It lists at about $0.12/h to Deepgram's $0.46/h. The cost is latency: a final word's median wait for its gloss is 0.8-3.7 s, against Deepgram's 0.4-1.7 s, with a p95 of up to 7 s in long unbroken speech. Interim text trails the speaker by about 1 s, against 0.25 s |
| Sentence translation | Google Cloud Translation (Basic, v2), called once per finalized Utterance. The final Arabic shows at once and the translation fills in beneath it when it arrives; a failed translation leaves the Utterance untranslated and recording carries on. Per-word glosses come from the dictionary, not this service |
| STT cost | Key-in-config for now (settings field); distribution model (BYO key vs proxy) deferred. Until the settings screen (#13) exists, the app reads `SONIOX_API_KEY`, else `DEEPGRAM_API_KEY`, from the environment or, outside packaged builds, a git-ignored `.env` at the repo root (`.env.example`), and records without a Transcript when neither is set. `GOOGLE_TRANSLATE_API_KEY` is read the same way; without it, Utterances have no sentence translation |
| Audio source | Mic plus system-audio loopback |
| Interim text | Shown muted in Live View; glosses and lemmas attach only when the Utterance is finalized |
| Session audio | Desktop (loopback) audio is always the transcribed source. Mic is an optional second track, chosen at Session start, recorded as a separate audio track and never transcribed. Classes are online (teacher arrives via desktop audio) |
| OS | Windows only for v1 (WASAPI loopback via Electron); macOS/Linux deferred |
| Shell | Electron, spawning the Python sidecar |
| Licensing | App is open source. This makes bundling GPL v2 pieces (CAMeL database, Qutrub) and CC BY-SA / CC BY data (Wiktionary, Tatoeba) workable. Still need: pick a compatible app licence (GPL v2-or-later or GPL v3 is the simplest fit), add an attribution/credits screen, and keep third-party licence files in the repo. The dictionary build writes its own `NOTICE.txt` (#8) |
| Audience | Distributed to other learners: needs an installer, bundled models, and an STT key/cost strategy |

## Dictionary plan (v1, proposed)

Detail Modules and the source behind each. All data is looked up locally from one bundled SQLite file built by an offline build script, never from raw dumps at runtime.

| Detail Module | Source | Notes |
|---|---|---|
| Lemma, part of speech, root, pattern | CAMeL analyzer output (`lex`, `pos`, `root`, `pattern`) | Verified fields. Runs per Token in the sidecar |
| Quick gloss (shown under the word in Live View) | Wiktionary first sense, CAMeL `stemgloss` as fallback | Built (#8); rules under Decisions, Quick gloss. Reviewed on real transcripts, see open question 3 |
| Pronunciation | CAMeL `caphi` | Phonetic transcription, from the diacritized form |
| Full definitions, etymology, related forms | Wiktionary (English edition) via wiktextract/kaikki | Build script filters to Arabic entries and to forms we need. No licence stated on kaikki; Wiktionary text is CC BY-SA, so attribute |
| Example sentences (general) | Tatoeba AR-EN (about 31k pairs, CC BY 2.0) | Optional module; simple sentences |
| Your own examples | The learner's own Utterances | Built from Vocabulary history |
| Verb conjugation | Qutrub (GPL) or CAMeL generation | Decide later; not v1-critical |

Built (#9): the dictionary (schema 2) also keeps each entry's Wiktionary etymology and indexes every Tatoeba sentence by its words' letters, for the word panel's definitions and examples modules. A schema-1 file is refused; rebuild it. Measured: 14,424 of the 27,307 entries have an etymology (1.7 MB of text), and the word index holds 226,305 rows; **the built file is now 13.6 MB** (was 7.5 MB), and finding examples for the commonest words (في، من) takes about 24 ms.

Built (#8): `npm run build:dictionary` (`scripts/build-dictionary.mjs`) downloads kaikki.org's raw English-Wiktionary dump (`raw-wiktextract-data.jsonl.gz`, 3.08 GB, cached in the git-ignored `vendor/dictionary-sources/`) and Tatoeba's per-language `ara`/`eng` sentence exports with their `ara-eng` links. It streams the dump once (about 4 min) and writes `vendor/dictionary/dictionary.db` plus a `NOTICE.txt` with attribution; packaged builds are to ship that folder as `resources/dictionary`. Measured on the 30 Oct 2026 dump: of 233,417 Arabic entries, 27,307 are kept (12,833 nouns, 7,275 verbs, 3,798 adjectives, 2,384 names, the rest particles, pronouns, phrases); the 196,443 gloss-less root-form verb stubs, 8,836 inflection (form-of) and 1,071 alternative-spelling entries are dropped. Each kept entry holds its headword, part of speech and sense glosses. Tatoeba gives 48,663 Arabic-English pairs (more than the 31k Arabic sentences, since one can have several translations). **The built file is 7.5 MB.** Licences, confirmed: Wiktionary text is CC BY-SA 4.0 (also GFDL); kaikki.org states no licence of its own and asks for attribution to wiktextract (Ylonen, LREC 2022) and a link; Tatoeba is CC BY 2.0 FR. Both are recorded in the database's `meta` table and in `NOTICE.txt`, which the attribution screen should show.

Facts established: CAMeL provides `diac`, `lex`, `caphi`, `gloss`, `pos`, `root`, `pattern`, clitic fields and `stemgloss`. Kaikki's Arabic file is 827.9 MB (about 177k distinct word forms) but is marked **deprecated**; the supported source is the raw all-languages dump (2.9 GB compressed, 24.8 GB uncompressed). The build script should therefore extract Arabic entries from the raw dump once, or run wiktextract ourselves, and ship only the compact result.

## Installer size (researched)

Verified: CAMeL's MSA data is small: `morphology-db-msa-r13` 40.5 MB plus `disambig-mle-calima-msa-r13` 88.7 MB (both GPL v2), 129.2 MB together on disk. Install these two packages directly, **not** `camel_data -i light`: `light` also pulls every dialect database and MLE model plus the dialect-ID model (536 MB on disk). The large packages (AraBERT NER and sentiment 541.6 MB each, mBERT 712.5 MB) are not needed either.

Verified (spike #2, `scripts/spikes/camel-no-torch/`): `camel-tools` 1.6.0 declares `torch`, `transformers`, `scikit-learn`, `scipy`, `pandas` and `numpy` as hard requirements, but morphology plus MLE disambiguation **runs on Windows without any of them**. Install `camel-tools` with `--no-deps`, then only `cachetools`, `editdistance`, `emoji`, `regex`, `six`, `pyrsistent`, `tqdm`, `requests` and `muddler`. No vendoring needed. The wheels avoided total about 208 MB compressed (torch alone 126.7 MB).

Measured, Python helper (embeddable Python 3.13 + packages above + MSA data):

| Part | On disk |
|---|---|
| Embeddable Python runtime | 21.2 MB |
| site-packages | 9.2 MB |
| MSA data | 129.2 MB |
| **Helper total** | **159.7 MB** (23.8 MB zipped) |

Startup: about 2 s to import and 4 s to load the MLE model; disambiguating a sentence then takes milliseconds. So the helper runs as one long-lived process per app run, not one spawn per Utterance.

Packaging (decided by spike #2): ship the official Windows embeddable Python with a `site-packages` folder (camel-tools `--no-deps`, pinned) and a data folder holding only the two MSA packages, located through `CAMELTOOLS_DATA`. Electron spawns it as the sidecar. A build script fetches all three; the spike's `smoke.py`, which fails if any heavy package is imported, guards every camel-tools upgrade. Built (#6): `npm run build:helper` (`scripts/build-camel-helper.mjs`) writes the bundle to the git-ignored `vendor/camel-helper/`; packaged builds are to ship it as `resources/camel-helper`. The helper is `helper/camel/analyze.py`, speaking JSON lines over stdin/stdout.

Measured (#8): the dictionary SQLite (Wiktionary extract plus Tatoeba) is 7.5 MB; 13.6 MB since #9 added etymologies and the example word index. Estimate, unmeasured: Electron shell about 100-150 MB. With the 160 MB helper, the installed app is likely 270-320 MB, with no torch.

## Open questions

1. ~~Lemmatization~~ Resolved: CAMeL Tools Python sidecar. Packaging size and startup time measured (see Installer size). Supervision (#6): the main process starts one helper with the app, restarts it after a crash with a delay doubling from 1 s to 30 s, kills and replaces one that leaves a sentence unanswered for 15 s, and closes it when the app quits. A sentence in flight when the helper dies fails rather than being retried. Without the bundle, the app runs on the fake analyzer.
2. ~~Ambiguity~~ Resolved: context disambiguation. Remaining: does a wrong pick need a correction UI later? **Reopened by #6:** the torch-free MLE disambiguator is not context-aware (see Ambiguity). The two context cases are kept as expected failures in `tests/analysis/camel.test.ts`; follow-up #20.
3. ~~Dictionary source~~ Resolved by #8: built, licences and size confirmed (see Dictionary plan). Gloss quality, reviewed on the 32 real Utterances recorded so far (a learner dialogue: greetings, names, countries, age, where you live; 183 words): about 153 (84%) get a fitting gloss. 20 are wrong because the analyzer picked the wrong reading out of context, not the dictionary: آه as the verb "to moan", أيضًا as أَيْض, تسكن/أسكن "live" as سَكَّن "to calm" (7 of them), ليس as "to be valiant", لست as لاس "taste". Those wait on context disambiguation (#20). 6 get a weak first sense: عمر "lifespan" for "age", جدًا "seriousness" for "very", مثلًا "likeness" for "for example"; adverbial accusatives (جدًا, مثلًا, أيضًا) would want their own handling. 4 get none: names the analyzer does not know (خسو, غروزنة) and a filler sound. Fixed during the review: Wiktionary's descriptions of function words (now stem gloss), a name glossed by a common noun (سيف "sword"), alef wasla in CAMeL Lemmas (ٱِسْم), and unshortened or fragment glosses. Remaining: re-check on a real class with a native teacher. Findings: CAMeL's default MSA database (calima-msa-r13, about 40 MB, derived from MADAMIRA's almor-msa-r13) is **GPL v2**; Qutrub (verb conjugation) is **GPL**; Wiktionary-derived data (via kaikki.org, English-Wiktionary edition) is *probably* CC BY-SA, unverified; Tatoeba is CC BY 2.0 (about 31k Arabic-English pairs). Unverified: calima gloss/root fields, kaikki Arabic file size/licence, Arabic WordNet. Distribution implications of GPL/share-alike need a licensing decision (item 10). Original note: which open Arabic→English data (Wiktionary dumps, Tatoeba for examples, others) and how is it bundled offline?
4. ~~Audio source / OS~~ Resolved: Windows, Electron, desktop audio transcribed, optional separate mic track. Replay plays both tracks (Desktop Track and Mic Track, when a Mic Track exists), kept as separate files and played in sync. Remaining: per-track volume/mute controls in Replay View?
5. **Sentence translation**: which service, and does it run live per Utterance or after the Utterance finalizes?
6. ~~Interim results~~ Resolved: muted interim, finalize on commit.
7. **Cost/privacy**: audio goes to a cloud STT API even though storage is local; is that acceptable for class recordings? Distribution model for the STT key is deferred.
8. ~~STT provider~~ Resolved by spike #3: Soniox `stt-rt-v6` first, Deepgram Nova-3 as fallback (results in `scripts/spikes/stt-msa/README.md`). Remaining: accuracy was scored on one speaker, against the user's caption-style transcript; the second clip (a learner dialogue, not a news broadcast) had no Arabic reference. Re-check accuracy on a hand-checked transcript of a real class with a native teacher. The endpoint delay trades accuracy for latency (500 ms: 9.5% WER; 1000 ms: 5.5%; default: 3.2%, with finals up to 5-7 s late in continuous speech), so revisit it once the Live View shows real glosses.
10. ~~App licensing~~ Decided: open source. Remaining: choose the exact licence (GPL v2-or-later is the safest match for GPL v2 components; confirm Qutrub's version, and check Soniox/Google API terms (and Deepgram's, as the fallback) don't conflict with open-sourcing the client), and confirm kaikki/Wiktionary file licence.
9. ~~Sentence translation~~ Decided: Google Cloud Translation. Remaining: two third-party API keys (Soniox and Google) now sit behind the distribution/cost question in item 7.
