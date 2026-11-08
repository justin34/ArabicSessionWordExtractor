import {
  DeviceUnavailableError,
  NoDesktopAudioError,
  type AudioCapture,
  type AudioDevice,
  type AudioInputs,
  type DesktopAudioCapture,
  type MicAudioCapture,
} from './bridge';
import { levelOf, MicGate } from './micGate';

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

/** One MediaRecorder (WebM/Opus) delivering its chunks in order. */
function startRecorder(stream: MediaStream, onChunk: (chunk: Uint8Array) => void): () => Promise<void> {
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  // Blob reads are async; chain them so chunks are delivered in order.
  let delivery: Promise<void> = Promise.resolve();
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    delivery = delivery.then(async () => {
      onChunk(new Uint8Array(await event.data.arrayBuffer()));
    });
  };
  recorder.start(1000);
  return async () => {
    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }
    await delivery;
  };
}

/**
 * Records an audio stream with MediaRecorder (WebM/Opus), metering its level. With a
 * `threshold`, a second recorder takes the same audio through the mic threshold's gate:
 * the same timeline, with what the gate shuts out replaced by silence, so speech-to-text
 * times still match the recording, which itself is never gated.
 */
function recorderCapture(stream: MediaStream, threshold?: number): AudioCapture {
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  let gated: MediaStream | null = null;
  if (threshold !== undefined) {
    const gate = new MicGate(threshold);
    // A ScriptProcessorNode keeps the gate in this file: an AudioWorklet would need a
    // module of its own loaded into the page.
    const processor = audioContext.createScriptProcessor(1024, 1, 1);
    processor.onaudioprocess = (event) =>
      void gate.process(
        event.inputBuffer.getChannelData(0),
        event.outputBuffer.getChannelData(0),
        event.inputBuffer.sampleRate,
      );
    const destination = audioContext.createMediaStreamDestination();
    source.connect(processor).connect(destination);
    gated = destination.stream;
  }

  const stops: Array<() => Promise<void>> = [];

  return {
    begin(onChunk, onGatedChunk) {
      // Both recorders start together, so the gated audio keeps the recording's timeline.
      stops.push(startRecorder(stream, onChunk));
      if (gated && onGatedChunk) stops.push(startRecorder(gated, onGatedChunk));
    },
    level() {
      analyser.getFloatTimeDomainData(samples);
      return levelOf(samples);
    },
    async stop() {
      await Promise.all(stops.map((stop) => stop()));
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

/** Records the chosen (or default) microphone, for a Session's Mic Track, gated with a threshold. */
export const browserMicAudio: MicAudioCapture = {
  async open(device = null, threshold?: number): Promise<AudioCapture> {
    return recorderCapture(await openInput(device), threshold);
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
