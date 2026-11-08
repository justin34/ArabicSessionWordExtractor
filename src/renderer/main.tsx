import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { TranscriptionFailureListener, TranscriptListener } from '../core/types';
import type { Bridge, Unsubscribe } from './bridge';
import { browserAudioInputs, browserDesktopAudio, browserMicAudio } from './browserCapture';
import { demoFeedForBuild } from './demoFeed';
import { browserMicRecordingGate } from './micRecordingGate';
import './tokens.css';

type PreloadApi = Omit<
  Bridge,
  'subscribeTranscript' | 'subscribeTranscriptionFailure' | 'desktopTrackUrl' | 'micTrackUrl'
> & {
  onTranscriptUpdate(listener: TranscriptListener): Unsubscribe;
  onTranscriptionFailure(listener: TranscriptionFailureListener): Unsubscribe;
};

const { onTranscriptUpdate, onTranscriptionFailure, ...api } = (window as unknown as { api: PreloadApi }).api;

const bridge: Bridge = {
  ...api,
  // Served by the main process from the Session's stored Desktop Track.
  desktopTrackUrl: (sessionId) => `session-audio://desktop/${sessionId}`,
  micTrackUrl: (sessionId) => `session-audio://mic/${sessionId}`,
  subscribeTranscript: (sessionId, onUpdate) =>
    onTranscriptUpdate((id, update) => {
      if (id === sessionId) onUpdate(update);
    }),
  subscribeTranscriptionFailure: (sessionId, onFailure) =>
    onTranscriptionFailure((id, message, track) => {
      if (id === sessionId) onFailure(message, track ?? 'desktop');
    }),
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      bridge={bridge}
      capture={browserDesktopAudio}
      micCapture={browserMicAudio}
      audioInputs={browserAudioInputs}
      micRecordingGate={browserMicRecordingGate}
      demoFeed={demoFeedForBuild(import.meta.env.DEV)}
    />
  </StrictMode>,
);
