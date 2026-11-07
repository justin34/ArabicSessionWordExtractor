# Spike #3: Deepgram vs Soniox on real MSA

**Answer: change the first adapter to Soniox (`stt-rt-v6`) with `max_endpoint_delay_ms: 1000`.** Keep Deepgram Nova-3 behind the same interface as the fallback.

On the same 15.5 minutes of class audio, Soniox at that setting made 5.5% word errors to Deepgram's 9.2%, or 3.2% at its default setting. It writes standard Arabic spelling and punctuation; Deepgram writes neither. At list price it costs about a quarter as much.

The price is latency. Glosses attach only when a word is final, and Soniox finalizes later than Deepgram. Measured from the last word in each final message, Soniox's median wait is 0.8 s against Deepgram's 0.38 s. Measured from the first word, it is 3.7 s against 1.7 s. In long unbroken speech, the slowest 5% of Soniox finals arrive 5–7 s after the speech. Interim (muted) text keeps up with the speaker in both, within about 1 s.

Run on 2026-11-07, Windows 11, Node 24.18, from a home connection. Each clip was streamed once per configuration, at real-time speed, as 50 ms frames of 16 kHz mono 16-bit PCM.

## Clips

| Clip | Length | What it is | Reference |
|---|---|---|---|
| `class` | 15.5 min | One speaker, a non-native speaker who learned Arabic from books, explaining in careful MSA why learners understand him but not native speakers | Arabic + English transcript supplied by the user; the Arabic lines (about 1,200 words) are the reference |
| `news` | 2.7 min | Not a broadcast: a scripted two-person learner dialogue (greetings, age, family, home) | English only, so **no accuracy score**; only latency, cost and how far the transcripts agree |

The Arabic reference is written without hamza on alef, with ة as ه and ى as ي. That spelling style is typical of auto-generated captions, so the reference may itself be machine output that was never hand-checked. The score folds those letters, and diacritics, on both sides before comparing (`normalizeArabic` in `score.ts`), so spelling style is not counted as an error.

## Results

| Clip | Provider | WER | CER | Final, last word p50 / p95 | Final, first word p50 / p95 | Utterance end p50 / p95 | Interim lag p50 / p95 | Cost |
|---|---|---|---|---|---|---|---|---|
| class | Deepgram Nova-3 (`ar`) | 9.2% | 6.6% | 384 / 827 ms | 1736 / 3890 ms | 356 / 686 ms | 250 / 574 ms | $0.119 |
| class | Soniox, default endpointing | **3.2%** | **1.9%** | 5041 / 5690 ms | 6358 / 7061 ms | 601 / 1415 ms | 976 / 1225 ms | **$0.031** |
| class | Soniox, `max_endpoint_delay_ms` 1500 | 3.4% | 2.0% | 4992 / 5595 ms | 6106 / 7036 ms | 572 / 1401 ms | 954 / 1163 ms | $0.031 |
| class | **Soniox, `max_endpoint_delay_ms` 1000** | 5.5% | 2.5% | 811 / 5330 ms | 3732 / 7010 ms | 599 / 806 ms | 972 / 1036 ms | $0.031 |
| class | Soniox, `max_endpoint_delay_ms` 500 | 9.5% | 3.8% | 562 / 1582 ms | 783 / 5560 ms | 552 / 655 ms | 929 / 987 ms | $0.031 |
| news | Deepgram Nova-3 (`ar`) | no ref | no ref | 367 / 2048 ms | 2280 / 4135 ms | 342 / 679 ms | 268 / 725 ms | $0.020 |
| news | Soniox, default endpointing | no ref | no ref | 575 / 1030 ms | 2324 / 5583 ms | 575 / 707 ms | 948 / 1007 ms | $0.005 |
| news | Soniox, `max_endpoint_delay_ms` 1000 | no ref | no ref | 577 / 2010 ms | 2060 / 5596 ms | 576 / 807 ms | 952 / 1010 ms | $0.005 |

How far the transcripts agree (WER of Soniox against Deepgram): class 8.5%; news 19.4% at Soniox's default setting and 20.1% at 1000 ms. The two Soniox settings agree with each other on news to within 0.7%.

What the columns mean. Audio time 0 is when streaming starts, and each 50 ms frame is sent when its last sample would exist in live capture. Every latency is the time a message arrived on that clock, minus a time in the audio:

- **Final, last word**: minus the end of the last word the message makes final. This is the shortest wait any word in it had.
- **Final, first word**: minus the start of the first word. This is the longest wait. A word's real wait before its gloss can attach lies between the two.
- **Utterance end**: the message that closes an Utterance (Deepgram `speech_final`, Soniox `<end>`), minus the end of its last word. Deepgram closed far more, shorter Utterances (401 on class) than Soniox (116 at default), so the two providers' values are not the same event.
- **Interim lag**: how far the muted interim text trails the speaker.
- **Cost**: audio streamed × list price, checked 2026-11-07, not read from a bill. Deepgram Nova-3 monolingual streaming is $0.0077/min ($0.46/h), billed by audio duration. Soniox real-time is token-priced; its pricing page puts that at "about $0.12/hour", so its figure is an estimate.

## What the numbers mean

- **Accuracy.** On the class clip Soniox made 3.2% word errors at default and 5.5% at 1000 ms, against Deepgram's 9.2%. Deepgram's errors are real recognition misses, and each one puts the wrong Lemma into the Vocabulary. In the news clip, for example: "ممكن ان نتعرضها" for ممكن أن نتعرف, "لبنان الصغيران" for لي ابنان صغيران, and "هل ستمبو" for هل إسطنبول. Deepgram also wrote 12 numbers as digits where the reference spells them out, so up to 1 point of its 9.2% is digits rather than misses.
- **Spelling and punctuation.** Across 15.5 minutes, Deepgram's Arabic contained no أ/إ/آ, no ة and one punctuation mark. Soniox wrote 235 hamza-alefs, 110 ة, some tanween, and 337 punctuation marks. Hamza-less text gives the CAMeL analyzer more ambiguous readings to choose between. Missing punctuation makes sentences harder to split for sentence translation. Neither problem shows up in WER, because the score normalizes spelling.
- **Latency is Soniox's cost.** In continuous speech Soniox keeps words non-final until it detects an endpoint, or for about 5 s at most. Lowering `max_endpoint_delay_ms` forces earlier finals, but it cuts word endings. At 500 ms, كلامي became كلام, تعبانه became تعب and تاخذونها became تاخذ, and WER rose to 9.5%, no better than Deepgram. 1000 ms is the best balance measured. It roughly halves the median wait (first word 3.7 s against 6.4 s) and keeps WER well under Deepgram's. The p95 stays at 5–7 s, because long unbroken stretches still wait for the cap. In the dialogue clip, turns are short, so the setting barely matters there. Two other settings did not lower final latency (3-minute test runs, not in the table): `endpoint_sensitivity` 1.0 and `endpoint_latency_adjustment_level` 3.
- **Interim text.** Soniox's interim text trails the speaker by about 1 s, against Deepgram's 0.25 s. Both are fast enough to read along.

## Caveats

- There is one run per configuration and one speaker with a reference. Treat differences of a point or two as noise; the gap between Deepgram's 9.2% and Soniox's 3–5% is large enough to stand. A first round of runs, which sent each frame 50 ms early, gave the same picture within about 0.5 points of WER and 50 ms of latency.
- The news clip has no Arabic reference. The "news" label is the user's; the clip is a learner dialogue, not a broadcast.
- The reference transcript may itself be caption output (see Clips).
- Deepgram was run with `language=ar`, `punctuate=true` and default endpointing. Its keyterm prompting and `ar-*` regional codes were not tried.

## Files

| File | What |
|---|---|
| `stream.ts` | The provider seam: `StreamingStt` yields the app's `SttEvent` plus an endpoint flag, and carries its transcript separator and price |
| `deepgram.ts`, `soniox.ts` | One adapter each, over a plain WebSocket |
| `pacer.ts` | Releases audio frames at real-time speed |
| `score.ts`, `latency.ts`, `report.ts` | Arabic normalization and WER/CER, percentiles, the metrics and the table |
| `run.ts` | Streams one clip to the chosen providers in parallel |
| `compare.ts` | Merges results saved from separate runs into one table |

## Reproduce

Needs Node 24+, so the `.ts` files run directly, and ffmpeg to make the WAVs. `.env`, `clips/` and `results/` are git-ignored, so keys, class audio and transcripts stay local.

```bash
cp .env.example .env   # then fill DEEPGRAM_API_KEY and SONIOX_API_KEY
ffmpeg -i class.mp3 -ac 1 -ar 16000 -c:a pcm_s16le clips/class.wav
node run.ts --clip clips/class.wav --ref clips/class.txt --label class
node run.ts --clip clips/news.wav --label news
node run.ts --clip clips/class.wav --ref clips/class.txt --providers soniox --label class-delay1000 --soniox-config '{"max_endpoint_delay_ms":1000}'
npx vitest run --config vitest.config.mts   # from the repo root: --config scripts/spikes/stt-msa/vitest.config.mts
```

A reference can be Arabic only, or Arabic and English lines mixed; the runner keeps only the lines that contain Arabic. Use `--max-seconds N` for a cheap test run. The spike has its own `tsconfig.json`, so the repo's `npm run typecheck` does not cover it: run `npx tsc -p scripts/spikes/stt-msa` as well.
