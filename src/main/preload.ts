import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { TranscriptionFailureListener, TranscriptListener } from '../core/types';

contextBridge.exposeInMainWorld('api', {
  startSession: (options?: { mic: boolean }) => ipcRenderer.invoke('sessions:start', options),
  appendDesktopAudio: (sessionId: number, chunk: Uint8Array) =>
    ipcRenderer.invoke('sessions:appendDesktopAudio', sessionId, chunk),
  appendMicAudio: (sessionId: number, chunk: Uint8Array) =>
    ipcRenderer.invoke('sessions:appendMicAudio', sessionId, chunk),
  stopSession: (sessionId: number) => ipcRenderer.invoke('sessions:stop', sessionId),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  transcript: (sessionId: number) => ipcRenderer.invoke('sessions:transcript', sessionId),
  listVocabulary: () => ipcRenderer.invoke('vocabulary:list'),
  wordDetails: (lemmaId: number, surface?: string) => ipcRenderer.invoke('words:details', lemmaId, surface),
  wordCard: (lemmaId: number) => ipcRenderer.invoke('guides:wordCard', lemmaId),
  sessionGuide: (sessionId: number) => ipcRenderer.invoke('guides:sessionGuide', sessionId),
  audioSettings: () => ipcRenderer.invoke('settings:audio'),
  saveAudioSettings: (settings: unknown) => ipcRenderer.invoke('settings:setAudio', settings),
  apiKeys: () => ipcRenderer.invoke('settings:apiKeys'),
  saveApiKey: (name: string, key: string | null) => ipcRenderer.invoke('settings:setApiKey', name, key),
  checkApiKey: (name: string) => ipcRenderer.invoke('settings:checkApiKey', name),
  transcriptionFailure: (sessionId: number) => ipcRenderer.invoke('sessions:transcriptionFailure', sessionId),
  dictionaryNotice: () => ipcRenderer.invoke('credits:dictionaryNotice'),
  exportToAnki: (target: unknown) => ipcRenderer.invoke('anki:export', target),
  showExportedFile: (path: string) => ipcRenderer.invoke('anki:showInFolder', path),
  /** Live Sessions whose speech-to-text stopped; returns an unsubscribe. */
  onTranscriptionFailure: (listener: TranscriptionFailureListener) => {
    const handler = (_event: IpcRendererEvent, ...[id, message]: Parameters<TranscriptionFailureListener>) =>
      listener(id, message);
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
