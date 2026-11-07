"""Arabic analysis helper: CAMeL Tools morphology plus MLE disambiguation, MSA only.

Long-lived: the app spawns it once (loading the model takes about 4 s) and talks to it
in JSON lines over stdin/stdout, UTF-8.

    out  {"type": "ready"}                              once the model is loaded
    in   {"id": 1, "sentence": "كتب الطالب الدرس"}
    out  {"id": 1, "tokens": [{"surface": "كتب", "lemma": "كَتَب", ...}, ...]}
    out  {"id": 1, "error": "..."}                      if that one sentence failed

One token per word; punctuation is dropped. stdout carries only these lines; anything
else goes to stderr. The helper exits when stdin closes.
"""
import importlib.abc
import json
import sys

# Spike #2: these must never load. Fail loudly if a camel-tools upgrade starts importing one.
BLOCKED = {"torch", "transformers", "numpy", "pandas", "scipy", "sklearn"}


class _Blocker(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path, target=None):
        if name.split(".")[0] in BLOCKED:
            raise ImportError(f"blocked heavy import: {name}")
        return None


sys.meta_path.insert(0, _Blocker())

from camel_tools.disambig.mle import MLEDisambiguator  # noqa: E402
from camel_tools.tokenizers.word import simple_word_tokenize  # noqa: E402

PROCLITICS = ("prc3", "prc2", "prc1", "prc0")
NONE = {"0", "na", "", None}


def _clitics(analysis):
    """Attached prefixes and suffixes, as diacritized form plus CAMeL feature value.

    d3tok splits every clitic off the stem (e.g. وَ+_بِ+_كِتاب_+هُم), in the same order
    as the non-empty prc3..prc0 and enc0 features.
    """
    segments = analysis.get("d3tok", "").split("_")
    pre_forms = [s[:-1] for s in segments if s.endswith("+") and len(s) > 1]
    suf_forms = [s[1:] for s in segments if s.startswith("+") and len(s) > 1]
    pre_feats = [analysis.get(k) for k in PROCLITICS if analysis.get(k) not in NONE]
    suf_feats = [analysis.get("enc0")] if analysis.get("enc0") not in NONE else []
    pair = lambda forms, feats: [
        {"form": f, "feature": feats[i] if i < len(feats) else ""} for i, f in enumerate(forms)
    ]
    return pair(pre_forms, pre_feats), pair(suf_forms, suf_feats)


def _token(word, analyses):
    if not analyses:
        return {"surface": word, "lemma": word, "prefixes": [], "suffixes": []}
    a = analyses[0].analysis
    prefixes, suffixes = _clitics(a)
    token = {
        "surface": word,
        "lemma": a.get("lex") or word,
        "diacritized": a.get("diac"),
        "root": a.get("root"),
        "pattern": a.get("pattern"),
        "partOfSpeech": a.get("pos"),
        "pronunciation": a.get("caphi"),
        "stemGloss": a.get("stemgloss"),
        "prefixes": prefixes,
        "suffixes": suffixes,
    }
    return {k: v for k, v in token.items() if isinstance(v, list) or v not in NONE}


def analyze(mle, sentence):
    words = simple_word_tokenize(sentence)
    tokens = []
    for d in mle.disambiguate(words):
        if d.analyses and d.analyses[0].analysis.get("pos") == "punc":
            continue
        tokens.append(_token(d.word, d.analyses))
    return tokens


def _send(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    mle = MLEDisambiguator.pretrained("calima-msa-r13")
    _send({"type": "ready"})
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            _send({"id": request_id, "tokens": analyze(mle, str(request["sentence"]))})
        except Exception as err:  # one bad sentence must not take the helper down
            _send({"id": request_id, "error": f"{type(err).__name__}: {err}"})


if __name__ == "__main__":
    main()
