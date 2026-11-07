import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { TranscriptListener } from '../core/types';
import type { Bridge, Unsubscribe } from './bridge';
import { browserDesktopAudio } from './browserCapture';
import { demoFeedForBuild } from './demoFeed';
import './tokens.css';

type PreloadApi = Omit<Bridge, 'subscribeTranscript'> & {
  onTranscriptUpdate(listener: TranscriptListener): Unsubscribe;
};

const { onTranscriptUpdate, ...api } = (window as unknown as { api: PreloadApi }).api;

const bridge: Bridge = {
  ...api,
  subscribeTranscript: (sessionId, onUpdate) =>
    onTranscriptUpdate((id, update) => {
      if (id === sessionId) onUpdate(update);
    }),
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      bridge={bridge}
      capture={browserDesktopAudio}
      demoFeed={demoFeedForBuild(import.meta.env.DEV)}
    />
  </StrictMode>,
);
