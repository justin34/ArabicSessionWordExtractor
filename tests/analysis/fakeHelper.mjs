// A stand-in for helper/camel/analyze.py that speaks the same JSON-lines protocol, for
// supervision tests. Sentences steer it: 'crash' exits, 'hang' never answers, 'pid' answers
// with its process id, 'translation' with the translation it was sent; anything else is
// split on whitespace.
// FAKE_HELPER_STARTS: a file counting starts; with FAKE_HELPER_FAIL_STARTS=n the first n
// starts die before they are ready.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const startsFile = process.env.FAKE_HELPER_STARTS;
if (startsFile) {
  const starts = (existsSync(startsFile) ? Number(readFileSync(startsFile, 'utf8')) : 0) + 1;
  writeFileSync(startsFile, String(starts));
  if (starts <= Number(process.env.FAKE_HELPER_FAIL_STARTS ?? 0)) {
    console.error('failing on startup');
    process.exit(2);
  }
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
send({ type: 'ready' });

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, sentence, translation } = JSON.parse(line);
  if (sentence === 'crash') process.exit(3);
  if (sentence === 'hang') return;
  if (sentence === 'fail') return send({ id, error: 'ValueError: bad sentence' });
  if (sentence === 'translation') return send({ id, tokens: [{ surface: 'translation', lemma: String(translation) }] });
  if (sentence === 'pid') return send({ id, tokens: [{ surface: 'pid', lemma: String(process.pid) }] });
  send({ id, tokens: sentence.split(/\s+/).map((w) => ({ surface: w, lemma: w })) });
});
