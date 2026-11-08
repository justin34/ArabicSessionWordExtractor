import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { MicTranscriptionListener, ReadyUpdate, TranscriptionFailureListener, TranscriptListener } from '../core/types';

contextBridge.exposeInMainWorld('api', {
  startSession: (options?: { mic: boolean; transcribeMic?: boolean; gateMic?: boolean }) => ipcRenderer.invoke('sessions:start', options),
  appendDesktopAudio: (sessionId: number, chunk: Uint8Array) =>
    ipcRenderer.invoke('sessions:appendDesktopAudio', sessionId, chunk),
  appendMicAudio: (sessionId: number, chunk: Uint8Array) =>
    ipcRenderer.invoke('sessions:appendMicAudio', sessionId, chunk),
  appendGatedMicAudio: (sessionId: number, chunk: Uint8Array) =>
    ipcRenderer.invoke('sessions:appendGatedMicAudio', sessionId, chunk),
  micTranscription: (sessionId: number) => ipcRenderer.invoke('micTranscription:status', sessionId),
  beginGatedMicRecording: (sessionId: number) => ipcRenderer.invoke('micTranscription:beginGated', sessionId),
  appendGatedMicRecording: (sessionId: number, chunk: Uint8Array) =>
    ipcRenderer.invoke('micTranscription:appendGated', sessionId, chunk),
  transcribeMicTrack: (sessionId: number, options?: { gated?: boolean }) =>
    ipcRenderer.invoke('micTranscription:start', sessionId, options),
  /** How each "Transcribe my microphone" job is going; returns an unsubscribe. */
  subscribeMicTranscriptions: (listener: MicTranscriptionListener) => {
    const handler = (_event: IpcRendererEvent, ...[id, status]: Parameters<MicTranscriptionListener>) =>
      listener(id, status);
    ipcRenderer.on('micTranscription:status', handler);
    return () => void ipcRenderer.removeListener('micTranscription:status', handler);
  },
  stopSession: (sessionId: number) => ipcRenderer.invoke('sessions:stop', sessionId),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  transcript: (sessionId: number) => ipcRenderer.invoke('sessions:transcript', sessionId),
  listVocabulary: () => ipcRenderer.invoke('vocabulary:list'),
  wordDetails: (lemmaId: number, surface?: string) => ipcRenderer.invoke('words:details', lemmaId, surface),
  wordCard: (lemmaId: number) => ipcRenderer.invoke('guides:wordCard', lemmaId),
  sessionGuide: (sessionId: number) => ipcRenderer.invoke('guides:sessionGuide', sessionId),
  audioSettings: () => ipcRenderer.invoke('settings:audio'),
  saveAudioSettings: (settings: unknown) => ipcRenderer.invoke('settings:setAudio', settings),
  replayLayout: () => ipcRenderer.invoke('settings:replayLayout'),
  saveReplayLayout: (layout: string) => ipcRenderer.invoke('settings:setReplayLayout', layout),
  apiKeys: () => ipcRenderer.invoke('settings:apiKeys'),
  saveApiKey: (name: string, key: string | null) => ipcRenderer.invoke('settings:setApiKey', name, key),
  checkApiKey: (name: string) => ipcRenderer.invoke('settings:checkApiKey', name),
  transcriptionFailure: (sessionId: number, track?: string) =>
    ipcRenderer.invoke('sessions:transcriptionFailure', sessionId, track),
  dictionaryNotice: () => ipcRenderer.invoke('credits:dictionaryNotice'),
  exportToAnki: (target: unknown) => ipcRenderer.invoke('anki:export', target),
  showExportedFile: (path: string) => ipcRenderer.invoke('anki:showInFolder', path),
  bundleProblems: () => ipcRenderer.invoke('app:bundleProblems'),
  readyUpdate: () => ipcRenderer.invoke('update:ready'),
  restartToUpdate: () => ipcRenderer.invoke('update:restart'),
  /** Told when an update has downloaded; returns an unsubscribe. */
  subscribeUpdateReady: (listener: (update: ReadyUpdate) => void) => {
    const handler = (_event: IpcRendererEvent, update: ReadyUpdate) => listener(update);
    ipcRenderer.on('update:downloaded', handler);
    return () => void ipcRenderer.removeListener('update:downloaded', handler);
  },
  /** Live Sessions whose speech-to-text stopped; returns an unsubscribe. */
  onTranscriptionFailure: (listener: TranscriptionFailureListener) => {
    const handler = (_event: IpcRendererEvent, ...[id, message, track]: Parameters<TranscriptionFailureListener>) =>
      listener(id, message, track);
    ipcRenderer.on('transcript:failed', handler);
    return () => void ipcRenderer.removeListener('transcript:failed', handler);
  },
  /** Live Transcript updates for every recording Session; returns an unsubscribe. */
  onTranscriptUpdate: (listener: TranscriptListener) => {
    const handler = (_event: IpcRendererEvent, ...[id, update]: Parameters<TranscriptListener>) =>
      listener(id, update);
    ipcRenderer.on('transcript:update', handler);
    return () => void ipcRenderer.removeListener('transcript:update', handler);
  },
});
