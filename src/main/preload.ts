import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  startSession: () => ipcRenderer.invoke('sessions:start'),
  appendDesktopAudio: (sessionId: number, chunk: Uint8Array) =>
    ipcRenderer.invoke('sessions:appendDesktopAudio', sessionId, chunk),
  stopSession: (sessionId: number) => ipcRenderer.invoke('sessions:stop', sessionId),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
});
