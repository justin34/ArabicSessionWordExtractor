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
| STT provider | Soniox real-time (`stt-rt-v6`) as the first adapter, with `max_endpoint_delay_ms` 1000; Deepgram Nova-3 kept as the fallback behind the same interface. Changed from Deepgram by spike #3 (`scripts/spikes/stt-msa/`). On 15.5 min of real class MSA, Soniox made 5.5% word errors (3.2% at its default setting) to Deepgram's 9.2%. It writes standard spelling and punctuation, where Deepgram writes no hamza, no ة and almost no punctuation. It lists at about $0.12/h to Deepgram's $0.46/h. The cost is latency: a final word's median wait for its gloss is 0.8-3.7 s, against Deepgram's 0.4-1.7 s, with a p95 of up to 7 s in long unbroken speech. Interim text trails the speaker by about 1 s, against 0.25 s |
| Sentence translation | Google Cloud Translation, called once per finalized Utterance. Per-word glosses come from the dictionary, not this service |
| STT cost | Key-in-config for now (settings field); distribution model (BYO key vs proxy) deferred. Until the settings screen (#13) exists, the app reads `SONIOX_API_KEY`, else `DEEPGRAM_API_KEY`, from the environment, and records without a Transcript when neither is set |
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

Packaging (decided by spike #2): ship the official Windows embeddable Python with a `site-packages` folder (camel-tools `--no-deps`, pinned) and a data folder holding only the two MSA packages, located through `CAMELTOOLS_DATA`. Electron spawns it as the sidecar. A build script fetches all three; the spike's `smoke.py`, which fails if any heavy package is imported, guards every camel-tools upgrade.

Estimate, unmeasured: Electron shell about 100-150 MB; dictionary SQLite (Wiktionary extract, Tatoeba) tens to low hundreds of MB. With the 160 MB helper, the installed app is likely 300-450 MB, with no torch.

## Open questions

1. ~~Lemmatization~~ Resolved: CAMeL Tools Python sidecar. Packaging size and startup time measured (see Installer size). Remaining: how the Electron shell supervises it.
2. ~~Ambiguity~~ Resolved: context disambiguation. Remaining: does a wrong pick need a correction UI later?
3. **Dictionary source** (plan proposed above; remaining: verify gloss quality on real audio, and confirm the Wiktionary extract's licence and size once built). Findings: CAMeL's default MSA database (calima-msa-r13, about 40 MB, derived from MADAMIRA's almor-msa-r13) is **GPL v2**; Qutrub (verb conjugation) is **GPL**; Wiktionary-derived data (via kaikki.org, English-Wiktionary edition) is *probably* CC BY-SA, unverified; Tatoeba is CC BY 2.0 (about 31k Arabic-English pairs). Unverified: calima gloss/root fields, kaikki Arabic file size/licence, Arabic WordNet. Distribution implications of GPL/share-alike need a licensing decision (item 10). Original note: which open Arabic→English data (Wiktionary dumps, Tatoeba for examples, others) and how is it bundled offline?
4. ~~Audio source / OS~~ Resolved: Windows, Electron, desktop audio transcribed, optional separate mic track. Replay plays both tracks (Desktop Track and Mic Track, when a Mic Track exists), kept as separate files and played in sync. Remaining: per-track volume/mute controls in Replay View?
5. **Sentence translation**: which service, and does it run live per Utterance or after the Utterance finalizes?
6. ~~Interim results~~ Resolved: muted interim, finalize on commit.
7. **Cost/privacy**: audio goes to a cloud STT API even though storage is local; is that acceptable for class recordings? Distribution model for the STT key is deferred.
8. ~~STT provider~~ Resolved by spike #3: Soniox `stt-rt-v6` first, Deepgram Nova-3 as fallback (results in `scripts/spikes/stt-msa/README.md`). Remaining: accuracy was scored on one speaker, against the user's caption-style transcript; the second clip (a learner dialogue, not a news broadcast) had no Arabic reference. Re-check accuracy on a hand-checked transcript of a real class with a native teacher. The endpoint delay trades accuracy for latency (500 ms: 9.5% WER; 1000 ms: 5.5%; default: 3.2%, with finals up to 5-7 s late in continuous speech), so revisit it once the Live View shows real glosses.
10. ~~App licensing~~ Decided: open source. Remaining: choose the exact licence (GPL v2-or-later is the safest match for GPL v2 components; confirm Qutrub's version, and check Soniox/Google API terms (and Deepgram's, as the fallback) don't conflict with open-sourcing the client), and confirm kaikki/Wiktionary file licence.
9. ~~Sentence translation~~ Decided: Google Cloud Translation. Remaining: two third-party API keys (Soniox and Google) now sit behind the distribution/cost question in item 7.
