import { describe, expect, it } from 'vitest';
import { formatThreshold, levelOf, MIC_GATE_HOLD_MS, MicGate } from '../src/renderer/micGate';

/** The mic threshold's gate (#44): only what speech-to-text hears is gated, never the recording. */

const RATE = 48000;
/** A block of 1024 samples, about 21 ms, at a peak of `peak`. */
const block = (peak: number) => Float32Array.from({ length: 1024 }, (_, i) => (i % 2 ? peak : -peak / 2));
const blockMs = (1024 / RATE) * 1000;

describe('Mic threshold gate', () => {
  it('measures a block as the level meters show it: the peak, doubled, at most 1', () => {
    expect(levelOf(block(0))).toBe(0);
    expect(levelOf(block(0.1))).toBeCloseTo(0.2);
    expect(levelOf(block(0.8))).toBe(1);
  });

  it('silences audio below the threshold and passes audio at or above it unchanged', () => {
    const gate = new MicGate(0.3);
    const out = new Float32Array(1024).fill(9);

    expect(gate.process(block(0.1), out, RATE)).toBe(false);
    expect(out.every((s) => s === 0)).toBe(true);

    const loud = block(0.2);
    expect(gate.process(loud, out, RATE)).toBe(true);
    expect(out).toEqual(loud);
  });

  it('stays open about 0.5 s after the level falls below, so word endings and pauses pass', () => {
    const gate = new MicGate(0.3);
    expect(gate.pass(0.5, blockMs)).toBe(true);

    const quietBlocksPassed = Array.from({ length: 40 }, () => gate.pass(0.1, blockMs)).filter(Boolean).length;
    expect(quietBlocksPassed * blockMs).toBeGreaterThanOrEqual(MIC_GATE_HOLD_MS);
    expect(quietBlocksPassed * blockMs).toBeLessThan(MIC_GATE_HOLD_MS + blockMs * 2);
    expect(gate.pass(0.1, blockMs)).toBe(false);

    // Speaking again within the hold restarts it.
    const again = new MicGate(0.3);
    again.pass(0.5, blockMs);
    for (let i = 0; i < 10; i++) again.pass(0.1, blockMs);
    again.pass(0.4, blockMs);
    for (let i = 0; i < 20; i++) expect(again.pass(0.1, blockMs)).toBe(true);
  });

  it('is shut until the first loud block', () => {
    expect(new MicGate(0.3).pass(0.29, blockMs)).toBe(false);
  });

  it('reads as a percentage', () => {
    expect(formatThreshold(0.2)).toBe('20%');
    expect(formatThreshold(0.055)).toBe('6%');
  });
});
