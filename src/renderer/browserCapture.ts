import { NoDesktopAudioError, type AudioCapture, type DesktopAudioCapture } from './bridge';

/** Records Windows desktop (loopback) audio through getDisplayMedia and MediaRecorder. */
export const browserDesktopAudio: DesktopAudioCapture = {
  async open(): Promise<AudioCapture> {
    // getDisplayMedia needs a video source to be granted; discard it and keep only the audio.
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((t) => {
      t.stop();
      stream.removeTrack(t);
    });
    const release = () => stream.getTracks().forEach((t) => t.stop());
    if (stream.getAudioTracks().length === 0) {
      release();
      throw new NoDesktopAudioError();
    }

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

    let recorder: MediaRecorder | null = null;
    // Blob reads are async; chain them so chunks are delivered in order.
    let delivery: Promise<void> = Promise.resolve();

    return {
      begin(onChunk) {
        recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        recorder.ondataavailable = (event) => {
          if (event.data.size === 0) return;
          delivery = delivery.then(async () => {
            onChunk(new Uint8Array(await event.data.arrayBuffer()));
          });
        };
        recorder.start(1000);
      },
      level() {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const s of samples) peak = Math.max(peak, Math.abs(s - 128));
        return Math.min(1, (peak / 128) * 2);
      },
      async stop() {
        const rec = recorder;
        if (rec && rec.state !== 'inactive') {
          await new Promise<void>((resolve) => {
            rec.onstop = () => resolve();
            rec.stop();
          });
        }
        await delivery;
        release();
        await audioContext.close().catch(() => undefined);
      },
    };
  },
};
