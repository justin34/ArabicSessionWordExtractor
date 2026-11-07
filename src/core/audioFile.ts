import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import { Readable } from 'node:stream';

const CONTENT_TYPES: Record<string, string> = {
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
};

/** The byte range a `Range: bytes=…` header asks for, or 'unsatisfiable'; null means the whole file. */
function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // A suffix: the last N bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/**
 * Serves a recorded audio file, honouring byte ranges so the player can seek. Replay
 * reads each Session's Desktop Track and Mic Track through this.
 */
export function audioFileResponse(path: string, rangeHeader: string | null): Response {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return new Response('Audio file not found', { status: 404 });
  }
  const headers: Record<string, string> = {
    'Content-Type': CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
  };
  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body =
    size === 0
      ? null
      : (Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream<Uint8Array>);
  headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1);
  if (!range) return new Response(body, { status: 200, headers });
  headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: 206, headers });
}
