"""Spike #2: run CAMeL morphology + MLE disambiguation with no torch/transformers.

Blocks the heavy packages at import time so a hidden dependency fails loudly,
then analyzes and disambiguates one MSA sentence.
"""
import importlib.abc
import sys
import time

BLOCKED = {"torch", "transformers", "numpy", "pandas", "scipy", "sklearn"}


class Blocker(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path, target=None):
        if name.split(".")[0] in BLOCKED:
            raise ImportError(f"blocked heavy import: {name}")
        return None


sys.meta_path.insert(0, Blocker())

t0 = time.perf_counter()
from camel_tools.disambig.mle import MLEDisambiguator  # noqa: E402
from camel_tools.morphology.analyzer import Analyzer  # noqa: E402
from camel_tools.morphology.database import MorphologyDB  # noqa: E402
from camel_tools.tokenizers.word import simple_word_tokenize  # noqa: E402

t_import = time.perf_counter()
mle = MLEDisambiguator.pretrained()
t_load = time.perf_counter()

sentence = "ذهب الطالب إلى المدرسة وكتبوا الدرس"
tokens = simple_word_tokenize(sentence)
results = mle.disambiguate(tokens)
t_run = time.perf_counter()

for d in results:
    a = d.analyses[0].analysis
    print(f"{d.word}\tlex={a['lex']}\troot={a['root']}\tpos={a['pos']}\tstemgloss={a.get('stemgloss')}")

analyzer = Analyzer(MorphologyDB.builtin_db())
print(f"analyzer readings for كتبوا: {len(analyzer.analyze('كتبوا'))}")

loaded = sorted(m for m in sys.modules if m.split(".")[0] in BLOCKED)
print(f"heavy modules loaded: {loaded or 'none'}")
print(f"import {t_import - t0:.2f}s, load models {t_load - t_import:.2f}s, "
      f"disambiguate {len(tokens)} tokens {t_run - t_load:.3f}s")
