import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { Bridge } from './bridge';
import { browserDesktopAudio } from './browserCapture';
import { demoFeedForBuild } from './demoFeed';
import './tokens.css';

type PreloadApi = Omit<Bridge, 'subscribeTranscript'>;

const api = (window as unknown as { api: PreloadApi }).api;

// No transcription source exists yet, so a real Session's transcript never updates.
const bridge: Bridge = { ...api, subscribeTranscript: () => () => {} };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      bridge={bridge}
      capture={browserDesktopAudio}
      demoFeed={demoFeedForBuild(import.meta.env.DEV)}
    />
  </StrictMode>,
);
