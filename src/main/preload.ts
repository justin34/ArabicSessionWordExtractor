import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { TranscriptListener } from '../core/types';

contextBridge.exposeInMainWorld('api', {
  startSession: () => ipcRenderer.invoke('sessions:start'),
  appendDesktopAudio: (sessionId: number, chunk: Uint8Array) =>
    ipcRenderer.invoke('sessions:appendDesktopAudio', sessionId, chunk),
  stopSession: (sessionId: number) => ipcRenderer.invoke('sessions:stop', sessionId),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  listVocabulary: () => ipcRenderer.invoke('vocabulary:list'),
  wordDetails: (lemmaId: number, surface?: string) => ipcRenderer.invoke('words:details', lemmaId, surface),
  wordCard: (lemmaId: number) => ipcRenderer.invoke('guides:wordCard', lemmaId),
  sessionGuide: (sessionId: number) => ipcRenderer.invoke('guides:sessionGuide', sessionId),
  /** Live Transcript updates for every recording Session; returns an unsubscribe. */
  onTranscriptUpdate: (listener: TranscriptListener) => {
    const handler = (_event: IpcRendererEvent, ...[id, update]: Parameters<TranscriptListener>) =>
      listener(id, update);
    ipcRenderer.on('transcript:update', handler);
    return () => void ipcRenderer.removeListener('transcript:update', handler);
  },
});
