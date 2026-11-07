import { describe, expect, it } from 'vitest';
import { crossProviderAgreement, formatTable, measureRun, type TimedEvent } from './report.ts';

const event = (overrides: Partial<TimedEvent>): TimedEvent => ({
  type: 'final',
  text: '',
  startMs: 0,
  endMs: 0,
  endpoint: false,
  receivedAtMs: 0,
  ...overrides,
});

const soniox = { name: 'soniox', finalSeparator: '', usdPerHour: 0.12 };
const deepgram = { name: 'deepgram', finalSeparator: ' ', usdPerHour: 0.462 };

const events: TimedEvent[] = [
  event({ type: 'interim', text: 'مرح', endMs: 400, receivedAtMs: 650 }),
  event({ text: 'مرحبا', startMs: 100, endMs: 600, receivedAtMs: 1000 }),
  event({ text: ' بكم', startMs: 700, endMs: 1000, receivedAtMs: 1600, endpoint: true }),
  event({ text: '', startMs: 1000, endMs: 1000, receivedAtMs: 1800, endpoint: true }),
];

describe('measureRun', () => {
  it('measures final text from its last and first word, endpoints and interim lag, against the audio clock', () => {
    const run = measureRun({ provider: soniox, events, audioMs: 60 * 60 * 1000 });
    expect(run.finalLatency).toMatchObject({ count: 2, p50: 400, max: 600 });
    expect(run.finalFirstWordLatency).toMatchObject({ count: 2, p50: 900, max: 900 });
    expect(run.endpointLatency).toMatchObject({ count: 2, p50: 600, max: 800 });
    expect(run.interimLag).toMatchObject({ count: 1, p50: 250 });
    expect(run.transcript).toBe('مرحبا بكم');
    expect(run.costUsd).toBeCloseTo(0.12);
    expect(run.wer).toBeUndefined();
  });

  it('scores against a reference when one is given, joining finals with the separator', () => {
    const run = measureRun({
      provider: deepgram,
      events: [event({ text: 'ذهب الولد' }), event({ text: 'الى البيت' })],
      audioMs: 1000,
      reference: 'ذهب الولد إلى المدرسة',
    });
    expect(run.transcript).toBe('ذهب الولد الى البيت');
    expect(run.wer).toEqual({ errors: 1, refLength: 4, rate: 0.25 });
    expect(run.cer?.errors).toBeGreaterThan(0);
  });
});

describe('crossProviderAgreement', () => {
  it('scores the second transcript against the first, only for exactly two runs', () => {
    const a = measureRun({ provider: deepgram, events: [event({ text: 'ذهب الولد' })], audioMs: 1000 });
    const b = measureRun({ provider: soniox, events: [event({ text: 'ذهب البنت' })], audioMs: 1000 });
    expect(crossProviderAgreement([a, b])).toBe('Cross-provider WER (deepgram as reference): 50.0%');
    expect(crossProviderAgreement([a])).toBeNull();
  });
});

describe('formatTable', () => {
  it('renders one Markdown row per run', () => {
    const run = measureRun({ provider: soniox, events, audioMs: 60_000 });
    const table = formatTable('news', [run]);
    expect(table.split('\n')).toHaveLength(3);
    expect(table).toContain('| news | soniox | 1.0 min |');
  });
});
