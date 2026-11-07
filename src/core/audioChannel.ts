/** An unbounded, single-consumer async queue of audio chunks that can be closed. */
export class AudioChannel implements AsyncIterable<Uint8Array> {
  private readonly buffered: Uint8Array[] = [];
  private waiting: ((result: IteratorResult<Uint8Array>) => void) | null = null;
  private closed = false;

  push(chunk: Uint8Array): void {
    if (this.closed) throw new Error('Audio channel is closed');
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: chunk, done: false });
    } else {
      this.buffered.push(chunk);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return {
      next: () => {
        const chunk = this.buffered.shift();
        if (chunk) return Promise.resolve({ value: chunk, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}
