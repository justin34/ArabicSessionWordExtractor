"""Arabic analysis helper: CAMeL Tools morphology plus MLE disambiguation, MSA only.

Long-lived: the app spawns it once (loading the model takes about 4 s) and talks to it
in JSON lines over stdin/stdout, UTF-8.

    out  {"type": "ready"}                              once the model is loaded
    in   {"id": 1, "sentence": "كتب الطالب الدرس", "translation": "The student wrote the lesson"}
    out  {"id": 1, "tokens": [{"surface": "كتب", "lemma": "كَتَب", ...}, ...]}
    out  {"id": 1, "error": "..."}                      if that one sentence failed

`translation`, the sentence's English translation, is optional. One token per word;
punctuation is dropped. stdout carries only these lines; anything else goes to stderr.
The helper exits when stdin closes.

Choosing a word's reading (#20). CAMeL's MLE disambiguator picks each word's reading out
of context, so the sentence is brought in on top of it:

1. The MLE ranking of all the analyzer's readings, with its reference reading matched by
   dictionary form first (camel-tools' own matching lets the MLE model's feature values,
   which the r13 database writes differently, outweigh the dictionary form: ليس came out
   as لَيِس "be valiant").
2. The translation: a reading whose stem gloss shares a word with the English translation
   wins over the MLE pick when the MLE pick shares none ("raised the flag": عَلَم).
3. Without that evidence, the neighbouring word: a bare perfect verb straight after
   another verb is read as a noun when it can be (قرأت كتب "I read books").
"""
import importlib.abc
import json
import re
import sys
from functools import lru_cache

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
from camel_tools.utils.dediac import dediac_ar  # noqa: E402

PROCLITICS = ("prc3", "prc2", "prc1", "prc0")
NONE = {"0", "na", "", None}
NOMINAL = {"noun", "adj"}
# Function words: their glosses ("to;towards") rarely appear in a translation, so the
# translation is no evidence against them.
CLOSED = {"prep", "conj", "conj_sub", "verb_pseudo", "adv_rel", "adv_interrog", "interj"}
# كان and its sisters (by dictionary form) take a verb straight after them (كان كتب "he had written").
AUXILIARIES = {"كان", "أصبح", "صار", "ظل", "بات", "أضحى", "أمسى", "ليس", "زال", "دام"}

# English words too common to tell two readings apart.
STOPWORDS = {
    "a", "an", "the", "of", "to", "in", "on", "at", "for", "with", "by", "from", "as",
    "and", "or", "but", "not", "no", "be", "is", "are", "was", "were", "been", "am",
    "he", "she", "it", "they", "i", "you", "we", "him", "her", "them", "me", "us",
    "his", "its", "their", "my", "your", "our", "this", "that", "these", "those",
    "do", "does", "did", "have", "has", "had", "will", "would", "there", "here",
    "s", "masc", "fem", "sg", "pl", "du", "one", "who", "which", "what", "if", "so",
    "than", "more", "most", "off", "up", "out", "away", "down", "about",
}
# Common irregular English forms, so "went" meets the gloss "go".
IRREGULAR = {
    "went": "go", "gone": "go", "goes": "go", "wrote": "write", "written": "write",
    "ate": "eat", "eaten": "eat", "came": "come", "saw": "see", "seen": "see",
    "said": "say", "says": "say", "made": "make", "took": "take", "taken": "take",
    "gave": "give", "given": "give", "bought": "buy", "sold": "sell", "told": "tell",
    "thought": "think", "found": "find", "left": "leave", "held": "hold", "knew": "know",
    "known": "know", "taught": "teach", "brought": "bring", "sat": "sit", "stood": "stand",
    "feet": "foot", "children": "child", "men": "man", "women": "woman", "lives": "life",
    "drank": "drink", "ran": "run", "began": "begin", "spoke": "speak", "met": "meet",
}


def _stem(word):
    """A crude English stem, the same for "raise", "raised" and "raises"."""
    word = IRREGULAR.get(word, word)
    for suffix, keep in (("ies", "y"), ("ing", ""), ("ed", ""), ("es", ""), ("s", "")):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3 and not word.endswith("ss"):
            word = word[: -len(suffix)] + keep
            break
    if len(word) > 3 and word.endswith("e"):
        word = word[:-1]
    return word


def _content_stems(text):
    words = re.findall(r"[a-z]+", text.lower())
    return {_stem(w) for w in words if w not in STOPWORDS}


@lru_cache(maxsize=100_000)
def _gloss_stems(stemgloss):
    return frozenset(_content_stems(stemgloss.replace("_", " ")))


def _stems_of(analysis):
    return _gloss_stems(analysis.get("stemgloss") or "")


def _closed(analysis):
    pos = analysis.get("pos") or ""
    return pos in CLOSED or pos.startswith(("part", "pron"))


def _bare(analysis):
    """A word with no clitics attached."""
    return all(analysis.get(k) in NONE for k in PROCLITICS + ("enc0",))


class Reader:
    """Picks one reading per word of a sentence, using the sentence around it."""

    def __init__(self, mle):
        # Pinned camel-tools 1.6.0: its word-based MLE model, and every reading ranked.
        self._mle = mle
        self._mle_model = mle._mle
        mle._top = 1_000_000
        self.ranked = lru_cache(maxsize=100_000)(self._ranked)

    def _ranked(self, word_dd):
        """All the analyzer's readings of a word, most likely first (out of context)."""
        ranked = [s.analysis for s in self._mle._scored_analyses(word_dd)]
        ref = self._mle_model.get(word_dd)
        if ref is None:
            return tuple(ranked)
        # The MLE model's own reading first: same dictionary form, part of speech, form.
        return tuple(
            sorted(
                ranked,
                key=lambda a: (
                    a.get("lex") != ref.get("lex"),
                    a.get("pos") != ref.get("pos"),
                    a.get("diac") != ref.get("diac"),
                ),
            )
        )

    def read(self, words, translation=None):
        """One chosen analysis (or None) per word."""
        heard = _content_stems(translation) if translation else set()
        rankings = [self.ranked(dediac_ar(word)) for word in words]
        # The translation words each word's MLE pick already accounts for ("good" for
        # جيدة), which another word's reading cannot then claim.
        explained = [_stems_of(r[0]) & heard if r else frozenset() for r in rankings]
        chosen = []
        previous = None
        for i, ranked in enumerate(rankings):
            pick = ranked[0] if ranked else None
            if pick is not None and pick.get("pos") != "punc":
                others = set().union(*(e for j, e in enumerate(explained) if j != i))
                pick = self._in_context(ranked, heard - others, previous)
                previous = pick
            chosen.append(pick)
        return chosen

    def _in_context(self, ranked, heard, previous):
        top = ranked[0]
        # 1. The translation, when it names one reading and not the MLE pick. A function
        #    word, or a pick whose gloss has no content words ("was"), stays as it is.
        top_stems = _stems_of(top)
        if not top_stems or _closed(top):
            return top
        if heard:
            if top_stems & heard:
                return top
            # The most likely reading that does, be it another sense of the same Lemma.
            for a in ranked:
                if _stems_of(a) & heard:
                    return a
        # 2. The word before: a bare perfect verb right after a verb is likely a noun.
        if (
            previous is not None
            and top.get("pos") == "verb"
            and top.get("asp") == "p"
            and _bare(top)
            and previous.get("pos") == "verb"
            and dediac_ar(previous.get("lex") or "") not in AUXILIARIES
        ):
            for a in ranked:
                if a.get("pos") in NOMINAL and _bare(a):
                    return a
        return top


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


def _token(word, a):
    if a is None:
        return {"surface": word, "lemma": word, "prefixes": [], "suffixes": []}
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


def analyze(reader, sentence, translation=None):
    words = simple_word_tokenize(sentence)
    return [
        _token(word, a)
        for word, a in zip(words, reader.read(words, translation))
        if not (a is not None and a.get("pos") == "punc")
    ]


def _send(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    reader = Reader(MLEDisambiguator.pretrained("calima-msa-r13"))
    _send({"type": "ready"})
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            translation = request.get("translation")
            tokens = analyze(reader, str(request["sentence"]), str(translation) if translation else None)
            _send({"id": request_id, "tokens": tokens})
        except Exception as err:  # one bad sentence must not take the helper down
            _send({"id": request_id, "error": f"{type(err).__name__}: {err}"})


if __name__ == "__main__":
    main()
