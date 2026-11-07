# Spike #2: CAMeL without torch

**Answer: yes.** CAMeL Tools 1.6.0 morphology (`Analyzer`) and sentence-context MLE disambiguation (`MLEDisambiguator`) run on Windows without torch, transformers, numpy, pandas, scipy or scikit-learn. `smoke.py` blocks those imports outright and still produces lemma, root, POS and stem gloss for an MSA sentence.

Run on 2026-11-07, Windows 11, Python 3.13.6 (official embeddable amd64 build), camel-tools 1.6.0.

## How it works

`camel-tools` declares torch, transformers and the scientific stack as hard requirements, but the code path for `camel_tools.morphology`, `camel_tools.disambig.mle` and `camel_tools.tokenizers.word` imports only:

`cachetools`, `editdistance`, `emoji`, `regex`, `six`, plus `pyrsistent`, `tqdm`, `requests` and `muddler` (pulled in by `camel_tools.data`, which locates the data files).

So: install `camel-tools` with `--no-deps`, then `requirements.txt`. Do not vendor: no source changes are needed.

## Data

Install only the two MSA packages, not `light`. `camel_data -i light` depends on `morphology-db-all`, `disambig-mle-all` and `dialectid-model26`, so it installs Egyptian, Gulf and Levantine data and the dialect-ID model: 536 MB on disk.

| Package | On disk |
|---|---|
| `morphology-db-msa-r13` (`morphology.db`) | 40.5 MB |
| `disambig-mle-calima-msa-r13` (`model.json`) | 88.7 MB |

The data dir also needs `catalogue.json` and `versions.json` at its root. Point the helper at it with the `CAMELTOOLS_DATA` environment variable.

## Measured sizes

| Part | Size |
|---|---|
| Embeddable Python 3.13 runtime | 21.2 MB |
| `site-packages` (camel-tools + the deps above) | 9.2 MB |
| MSA data (both packages) | 129.2 MB |
| **Helper total, on disk** | **159.7 MB** |
| **Helper total, zipped (deflate -9)** | **23.8 MB** |

What `--no-deps` avoids (Windows cp313 wheels, compressed download size, not installed size): torch 126.7 MB, scipy 36.6 MB, transformers 13.1 MB, numpy 12.6 MB, pandas 10.7 MB, scikit-learn 8.2 MB: about 208 MB compressed. Their installed size was not measured.

Timings (embeddable runtime): import 2.0 s, loading the MLE model 4.1 s (parsing an 88.7 MB JSON file), disambiguating a 6-token sentence 5 ms. The model load is a one-time startup cost, so the helper should be a long-lived process, not one spawn per Utterance.

## Reproduce

```bash
py -3.13 -m venv .venv
.venv/Scripts/python -m pip install --no-deps camel-tools==1.6.0
.venv/Scripts/python -m pip install -r requirements.txt
mkdir camel-data
CAMELTOOLS_DATA=$PWD/camel-data .venv/Scripts/python -c "from camel_tools.data import CATALOGUE as C; C.download_package('disambig-mle-calima-msa-r13', recursive=True)"
CAMELTOOLS_DATA=$PWD/camel-data PYTHONIOENCODING=utf-8 .venv/Scripts/python smoke.py
```

`download_package('disambig-mle-calima-msa-r13', recursive=True)` also fetches `morphology-db-msa-r13`, its only dependency.

For the embeddable layout: unzip `python-3.13.x-embed-amd64.zip`, `pip install --target <dir>/site-packages` the same two sets, and add `site-packages` to `python313._pth`.

## Caveats

- `pip check` reports the missing torch/transformers requirements. This is expected; the smoke test, not pip, is what guarantees the helper works. Pin `camel-tools` and rerun `smoke.py` on every upgrade, since a future release could add a heavy import to this code path.
- `docopt` (pulled in by `muddler`) prints `SyntaxWarning`s on Python 3.13. They are harmless; the helper can run with `-W ignore::SyntaxWarning`.
- Gloss quality example: ذهب came back with stem gloss `take_(with)` instead of "go". This feeds the quick-gloss quality check in the dictionary plan.
