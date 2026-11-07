// Renderer (built by tsconfig.renderer.json as an ES module): the main process owns the
// Session pipeline; this page only captures desktop audio and streams it over the preload bridge.

interface SessionView {
  id: number;
  startedAt: string;
  status: 'recording' | 'completed';
}

interface Api {
  startSession(): Promise<SessionView>;
  appendDesktopAudio(sessionId: number, chunk: Uint8Array): Promise<void>;
  stopSession(sessionId: number): Promise<SessionView>;
  listSessions(): Promise<SessionView[]>;
}

const bridge = (window as unknown as { api: Api }).api;
const toggleButton = document.getElementById('toggle') as HTMLButtonElement;
const statusLine = document.getElementById('status') as HTMLDivElement;
const sessionList = document.getElementById('sessions') as HTMLUListElement;

interface LiveSession {
  sessionId: number;
  stream: MediaStream;
  recorder: MediaRecorder;
  /** Chunk writes, chained so they reach the main process in order. Never rejects. */
  writes: Promise<void>;
  writeError: Error | null;
}

let liveSession: LiveSession | null = null;
let busy = false;

async function refreshList(): Promise<void> {
  const sessions = await bridge.listSessions();
  sessionList.replaceChildren(
    ...sessions.map((s) => {
      const li = document.createElement('li');
      li.textContent = `#${s.id} - ${new Date(s.startedAt).toLocaleString()} - ${s.status}`;
      return li;
    }),
  );
}

/** Desktop (loopback) audio only; getDisplayMedia insists on video, which is dropped. */
async function captureDesktopAudio(): Promise<MediaStream> {
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  for (const track of display.getVideoTracks()) {
    track.stop();
    display.removeTrack(track);
  }
  if (display.getAudioTracks().length === 0) throw new Error('No desktop audio available.');
  return display;
}

async function startSession(): Promise<void> {
  const stream = await captureDesktopAudio();
  let sessionId: number | undefined;
  try {
    sessionId = (await bridge.startSession()).id;
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const rec: LiveSession = { sessionId, stream, recorder, writes: Promise.resolve(), writeError: null };
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      rec.writes = rec.writes.then(async () => {
        try {
          await bridge.appendDesktopAudio(rec.sessionId, new Uint8Array(await event.data.arrayBuffer()));
        } catch (err) {
          rec.writeError = err as Error;
        }
      });
    };
    recorder.start(1000);
    liveSession = rec;
    toggleButton.textContent = 'Stop Session';
    statusLine.textContent = `Recording Session #${sessionId}...`;
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    if (sessionId !== undefined) await bridge.stopSession(sessionId).catch(() => undefined);
    throw err;
  }
}

async function stopSession(rec: LiveSession): Promise<void> {
  await new Promise<void>((resolve) => {
    rec.recorder.onstop = () => resolve();
    rec.recorder.stop();
  });
  rec.stream.getTracks().forEach((t) => t.stop());
  await rec.writes;
  liveSession = null;
  toggleButton.textContent = 'Start Session';
  await bridge.stopSession(rec.sessionId);
  statusLine.textContent = rec.writeError
    ? `Session #${rec.sessionId} saved, but some audio could not be written: ${rec.writeError.message}`
    : `Session #${rec.sessionId} saved.`;
}

toggleButton.addEventListener('click', () => {
  if (busy) return;
  busy = true;
  toggleButton.disabled = true;
  const action = liveSession ? stopSession(liveSession) : startSession();
  action
    .catch((err: Error) => {
      statusLine.textContent = `Something went wrong: ${err.message}`;
    })
    .finally(() => {
      busy = false;
      toggleButton.disabled = false;
      void refreshList();
    });
});

void refreshList();
