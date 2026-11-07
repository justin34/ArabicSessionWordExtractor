import {
  DeviceUnavailableError,
  NoDesktopAudioError,
  type AudioCapture,
  type AudioDevice,
  type AudioInputs,
  type DesktopAudioCapture,
  type MicAudioCapture,
} from './bridge';

/** Opens one input device, or the default one. Throws DeviceUnavailableError when it is gone. */
async function openInput(device: AudioDevice | null, constraints: MediaTrackConstraints = {}): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: device ? { ...constraints, deviceId: { exact: device.deviceId } } : { ...constraints },
      video: false,
    });
  } catch (err) {
    const name = (err as DOMException).name;
    if (device && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
      throw new DeviceUnavailableError(device);
    }
    throw err;
  }
}

/** Records an audio stream with MediaRecorder (WebM/Opus), metering its level. */
function recorderCapture(stream: MediaStream): AudioCapture {
  const release = () => stream.getTracks().forEach((t) => t.stop());
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
}

/**
 * Records what is transcribed: Windows desktop (loopback) audio through getDisplayMedia, or
 * the chosen input device as it is, without echo cancellation, noise suppression or gain.
 */
export const browserDesktopAudio: DesktopAudioCapture = {
  async open(source = null): Promise<AudioCapture> {
    if (source) {
      return recorderCapture(
        await openInput(source, { echoCancellation: false, noiseSuppression: false, autoGainControl: false }),
      );
    }
    // getDisplayMedia needs a video source to be granted; discard it and keep only the audio.
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((t) => {
      t.stop();
      stream.removeTrack(t);
    });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new NoDesktopAudioError();
    }
    return recorderCapture(stream);
  },
};

/** Records the chosen (or default) microphone, for a Session's Mic Track. */
export const browserMicAudio: MicAudioCapture = {
  async open(device = null): Promise<AudioCapture> {
    return recorderCapture(await openInput(device));
  },
};

/** Windows' own aliases for the default devices; the settings offer a default of their own. */
const ALIASES = new Set(['default', 'communications']);

/** Lists audio inputs. Labels stay blank until a microphone has been allowed once, so ask first. */
export const browserAudioInputs: AudioInputs = {
  async list(): Promise<AudioDevice[]> {
    const inputs = async () =>
      (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'audioinput' && !ALIASES.has(d.deviceId),
      );
    let devices = await inputs();
    if (devices.some((d) => !d.label)) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(() => null);
      stream?.getTracks().forEach((t) => t.stop());
      devices = await inputs();
    }
    return devices.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }));
  },
};
