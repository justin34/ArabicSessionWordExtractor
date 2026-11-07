/** Minimal WAV reader: 16-bit PCM only, which is what both services take as raw audio. */

export interface Wav {
  sampleRate: number;
  channels: number;
  pcm: Uint8Array;
  bytesPerMs: number;
  durationMs: number;
}

export function parseWav(file: Uint8Array): Wav {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const tag = (offset: number) => String.fromCharCode(...file.subarray(offset, offset + 4));
  if (file.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');

  let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | undefined;
  let offset = 12;
  while (offset + 8 <= file.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!format || format.audioFormat !== 1 || format.bits !== 16) {
        throw new Error('expected 16-bit PCM WAV (convert with: ffmpeg -i in -ac 1 -ar 16000 -c:a pcm_s16le out.wav)');
      }
      const pcm = file.subarray(body, Math.min(body + size, file.length));
      const bytesPerMs = (format.sampleRate * format.channels * 2) / 1000;
      return {
        sampleRate: format.sampleRate,
        channels: format.channels,
        pcm,
        bytesPerMs,
        durationMs: pcm.length / bytesPerMs,
      };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV file has no data chunk');
}
