import type { MicRecordingGate } from './bridge';
import { MicGate } from './micGate';

/**
 * The mic threshold applied afterwards, to a stored Mic Track ("Transcribe my microphone"):
 * the recording is decoded, gated block by block exactly as live audio is, and sent as WAV,
 * which both speech-to-text services accept. Silenced audio keeps its length, so word
 * timings still match the Mic Track.
 */

/** Speech-to-text needs no more than this; it keeps an hour of WAV near 115 MB. */
export const GATE_SAMPLE_RATE = 16_000;

/** Blocks of about the live gate's (1024 samples at 48 kHz). */
const BLOCK_MS = (1024 / 48_000) * 1000;

/** Chunks well inside the main process's limit per message. */
const CHUNK_BYTES = 4 * 1024 * 1024;

/** A copy of `samples` with every block the gate shuts out silenced. */
export function gateSamples(samples: Float32Array, sampleRate: number, threshold: number): Float32Array {
  const gate = new MicGate(threshold);
  const block = Math.max(1, Math.round((sampleRate * BLOCK_MS) / 1000));
  const out = new Float32Array(samples.length);
  for (let start = 0; start < samples.length; start += block) {
    const end = Math.min(samples.length, start + block);
    gate.process(samples.subarray(start, end), out.subarray(start, end), sampleRate);
  }
  return out;
}

/** Mono 16-bit PCM WAV of `samples`, in chunks of at most `chunkBytes`. */
export function wavChunks(samples: Float32Array, sampleRate: number, chunkBytes = CHUNK_BYTES): Uint8Array[] {
  const dataBytes = samples.length * 2;
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset: number, s: string) => [...s].forEach((c, i) => header.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  header.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, 'data');
  header.setUint32(40, dataBytes, true);
  const chunks: Uint8Array[] = [new Uint8Array(header.buffer)];
  const perChunk = Math.max(1, Math.floor(chunkBytes / 2));
  for (let start = 0; start < samples.length; start += perChunk) {
    const part = samples.subarray(start, Math.min(samples.length, start + perChunk));
    const pcm = new DataView(new ArrayBuffer(part.length * 2));
    part.forEach((s, i) => pcm.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 0x7fff), true));
    chunks.push(new Uint8Array(pcm.buffer));
  }
  return chunks;
}

/** Decodes the Mic Track at 16 kHz in the page, gates it, and encodes it as WAV. */
export const browserMicRecordingGate: MicRecordingGate = {
  async gate(url, threshold) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not read the recorded microphone.');
    const encoded = await response.arrayBuffer();
    // An offline context decodes straight to its own sample rate.
    const context = new OfflineAudioContext(1, 1, GATE_SAMPLE_RATE);
    let decoded: AudioBuffer;
    try {
      decoded = await context.decodeAudioData(encoded);
    } catch {
      throw new Error('Could not decode the recorded microphone to apply the mic threshold.');
    }
    return wavChunks(gateSamples(decoded.getChannelData(0), decoded.sampleRate, threshold), decoded.sampleRate);
  },
};
