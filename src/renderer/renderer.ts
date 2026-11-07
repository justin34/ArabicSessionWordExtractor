interface SessionSummary {
  id: number;
  startedAt: string;
  endedAt: string | null;
  status: 'recording' | 'completed';
  desktopTrackPath: string;
}

interface Api {
  startSession(): Promise<SessionSummary>;
  appendAudio(sessionId: number, chunk: Uint8Array): Promise<void>;
  stopSession(sessionId: number): Promise<SessionSummary>;
  listSessions(): Promise<SessionSummary[]>;
}

const bridge = (window as unknown as { api: Api }).api;
const toggle = document.getElementById('toggle') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const listEl = document.getElementById('sessions') as HTMLUListElement;

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let current: SessionSummary | null = null;
let starting = false;
// Serializes audio writes so chunks reach the main process in order. Never rejects:
// a failed write is remembered in audioWriteError so later chunks and stop still run.
let audioWriteQueue: Promise<void> = Promise.resolve();
let audioWriteError: Error | null = null;

async function refresh(): Promise<void> {
  const sessions = await bridge.listSessions();
  listEl.textContent = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    li.textContent = `#${s.id} - ${new Date(s.startedAt).toLocaleString()} - ${s.status}`;
    listEl.appendChild(li);
  }
}

function resetRecordingState(): void {
  stream?.getTracks().forEach((t) => t.stop());
  recorder = null;
  stream = null;
  current = null;
  audioWriteError = null;
  toggle.textContent = 'Start Session';
}

async function start(): Promise<void> {
  if (starting || recorder) return;
  starting = true;
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    display.getVideoTracks().forEach((t) => {
      t.stop();
      display.removeTrack(t);
    });
    if (display.getAudioTracks().length === 0) {
      statusEl.textContent = 'No desktop audio available to record.';
      return;
    }
    stream = display;
    current = await bridge.startSession();
    const sessionId = current.id;
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      // Chain writes so chunks reach the main process in order.
      audioWriteQueue = audioWriteQueue.then(async () => {
        try {
          const bytes = new Uint8Array(await event.data.arrayBuffer());
          await bridge.appendAudio(sessionId, bytes);
        } catch (err) {
          audioWriteError = err as Error;
        }
      });
    };
    recorder.start(1000);
    toggle.textContent = 'Stop Session';
    statusEl.textContent = `Recording session #${sessionId}...`;
  } catch (err) {
    // Release the capture and close any Session row that was already created.
    const orphan = current;
    resetRecordingState();
    if (orphan) await bridge.stopSession(orphan.id).catch(() => undefined);
    statusEl.textContent = `Could not start: ${(err as Error).message}`;
    await refresh();
  } finally {
    starting = false;
  }
}

async function stop(): Promise<void> {
  if (!recorder || !current) return;
  const sessionId = current.id;
  const rec = recorder;
  await new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
    rec.stop();
  });
  stream?.getTracks().forEach((t) => t.stop());
  await audioWriteQueue;
  const writeError = audioWriteError as Error | null;
  await bridge.stopSession(sessionId);
  resetRecordingState();
  statusEl.textContent = writeError
    ? `Session #${sessionId} saved, but some audio could not be written: ${writeError.message}`
    : `Session #${sessionId} saved.`;
  await refresh();
}

toggle.addEventListener('click', () => {
  void (recorder ? stop() : start());
});

void refresh();
