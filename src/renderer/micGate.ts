/** How long the gate stays open after the level falls below the threshold, so word endings and short pauses pass. */
export const MIC_GATE_HOLD_MS = 500;

/**
 * The input level of a block of samples, 0 to 1, as the level meters show it: the peak,
 * doubled so ordinary speech fills most of the meter.
 */
export function levelOf(samples: Float32Array): number {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return Math.min(1, peak * 2);
}

/** A mic threshold as the learner reads it: "20%". */
export function formatThreshold(threshold: number): string {
  return `${Math.round(threshold * 100)}%`;
}

/**
 * The mic threshold's gate, block by block: a block at or above the threshold opens it,
 * and it stays open until the level has stayed below for the hold time.
 */
export class MicGate {
  private openForMs = 0;

  constructor(
    private readonly threshold: number,
    private readonly holdMs = MIC_GATE_HOLD_MS,
  ) {}

  /** Whether a block of `durationMs` at `level` passes. */
  pass(level: number, durationMs: number): boolean {
    if (level >= this.threshold) {
      this.openForMs = this.holdMs;
      return true;
    }
    if (this.openForMs <= 0) return false;
    this.openForMs -= durationMs;
    return true;
  }

  /** Copies a block to `output` when it passes, silence when it does not. */
  process(input: Float32Array, output: Float32Array, sampleRate: number): boolean {
    const passes = this.pass(levelOf(input), (input.length / sampleRate) * 1000);
    if (passes) output.set(input);
    else output.fill(0);
    return passes;
  }
}
