import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  startSession: () => ipcRenderer.invoke('sessions:start'),
  appendAudio: (sessionId: number, chunk: Uint8Array) =>
    ipcRenderer.invoke('sessions:append', sessionId, chunk),
  stopSession: (sessionId: number) => ipcRenderer.invoke('sessions:stop', sessionId),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
});
