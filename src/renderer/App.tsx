import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudioCapture,
  Bridge,
  DemoFeed,
  DesktopAudioCapture,
  ListedSession,
  LiveUtterance,
  Unsubscribe,
} from './bridge';
import { NoDesktopAudioError } from './bridge';
import { EmptyState } from './components/EmptyState';
import { LiveView } from './components/LiveView';
import { ReplayPlaceholder } from './components/ReplayPlaceholder';
import { SessionList } from './components/SessionList';
import { ScreenHeader } from './components/ScreenHeader';
import { Sidebar, type Destination } from './components/Sidebar';
import { StartPanel } from './components/StartPanel';
import { isDemoKey, sessionKey } from './sessionKey';
import { applyUpdate } from './transcript';
import { useNow } from './useNow';
import './App.css';

export interface AppProps {
  bridge: Bridge;
  capture: DesktopAudioCapture;
  /** Present only in dev builds; enables the Demo Session. */
  demoFeed?: DemoFeed;
}

type Route =
  | { name: Destination }
  | { name: 'live'; sessionKey: string }
  | { name: 'replay'; session: ListedSession };

interface ActiveRecording {
  sessionId: number;
  capture: AudioCapture;
  /** Serializes audio writes so chunks reach the main process in order. Never rejects. */
  writes: Promise<void>;
  writeError: Error | null;
}

function sortNewestFirst(list: ListedSession[]): ListedSession[] {
  return [...list].sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt) || b.id - a.id,
  );
}

export function App({ bridge, capture, demoFeed }: AppProps) {
  const [route, setRoute] = useState<Route>({ name: 'sessions' });
  const [realSessions, setRealSessions] = useState<ListedSession[]>([]);
  const [demoSessions, setDemoSessions] = useState<ListedSession[]>([]);
  const [transcripts, setTranscripts] = useState<Record<string, LiveUtterance[]>>({});
  const [startPanelOpen, setStartPanelOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const active = useRef<ActiveRecording | null>(null);
  const starting = useRef(false);
  const demoCancels = useRef(new Map<number, Unsubscribe>());
  const nextDemoId = useRef(-1);

  const sessions = sortNewestFirst([...demoSessions, ...realSessions]);

  const refresh = useCallback(async () => {
    setRealSessions(await bridge.listSessions());
  }, [bridge]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pushUpdate = useCallback((key: string, u: LiveUtterance) => {
    setTranscripts((t) => ({ ...t, [key]: applyUpdate(t[key] ?? [], u) }));
  }, []);

  // Live transcript of the Session this window is recording, kept while the learner
  // looks elsewhere so Live View is complete on return.
  useEffect(() => {
    if (activeId === null) return;
    const key = String(activeId);
    return bridge.subscribeTranscript(activeId, (u) => pushUpdate(key, u));
  }, [bridge, activeId, pushUpdate]);

  // Any other real Session being viewed live.
  const liveKey = route.name === 'live' ? route.sessionKey : null;
  useEffect(() => {
    if (liveKey === null || isDemoKey(liveKey) || liveKey === String(activeId)) return;
    return bridge.subscribeTranscript(Number(liveKey), (u) => pushUpdate(liveKey, u));
  }, [bridge, liveKey, activeId, pushUpdate]);

  // Stop any demo feeds if the app unmounts.
  useEffect(() => {
    const cancels = demoCancels.current;
    return () => cancels.forEach((cancel) => cancel());
  }, []);

  const now = useNow(sessions.some((s) => s.status === 'recording'));

  async function startRecording(): Promise<void> {
    if (starting.current || active.current) return;
    starting.current = true;
    setStartPanelOpen(false);
    setNotice(null);
    let audio: AudioCapture;
    try {
      audio = await capture.open();
    } catch (err) {
      starting.current = false;
      setNotice(
        err instanceof NoDesktopAudioError
          ? err.message
          : `Could not start: ${(err as Error).message}`,
      );
      return;
    }
    let createdId: number | null = null;
    try {
      const created = await bridge.startSession();
      createdId = created.id;
      const rec: ActiveRecording = {
        sessionId: created.id,
        capture: audio,
        writes: Promise.resolve(),
        writeError: null,
      };
      audio.begin((chunk) => {
        rec.writes = rec.writes.then(async () => {
          try {
            await bridge.appendDesktopAudio(created.id, chunk);
          } catch (err) {
            rec.writeError = err as Error;
          }
        });
      });
      active.current = rec;
      setActiveId(created.id);
      await refresh();
      setRoute({ name: 'live', sessionKey: String(created.id) });
    } catch (err) {
      // Release the capture and close any Session row that was already created.
      await audio.stop().catch(() => undefined);
      if (createdId !== null) await bridge.stopSession(createdId).catch(() => undefined);
      active.current = null;
      setActiveId(null);
      setNotice(`Could not start: ${(err as Error).message}`);
      await refresh();
    } finally {
      starting.current = false;
    }
  }

  async function stopSession(session: ListedSession): Promise<void> {
    if (session.isDemo) {
      demoCancels.current.get(session.id)?.();
      demoCancels.current.delete(session.id);
      setDemoSessions((list) =>
        list.map((s) =>
          s.id === session.id
            ? { ...s, status: 'completed', endedAt: new Date().toISOString() }
            : s,
        ),
      );
      setRoute({ name: 'sessions' });
      return;
    }
    const rec = active.current?.sessionId === session.id ? active.current : null;
    try {
      if (rec) {
        await rec.capture.stop();
        await rec.writes;
      }
      await bridge.stopSession(session.id);
      if (rec?.writeError) {
        setNotice(
          `Session saved, but some audio could not be written: ${rec.writeError.message}`,
        );
      }
    } catch (err) {
      setNotice(`Could not stop the Session cleanly: ${(err as Error).message}`);
    } finally {
      if (rec) {
        active.current = null;
        setActiveId(null);
      }
    }
    setRoute({ name: 'sessions' });
    await refresh();
  }

  function startDemo(): void {
    if (!demoFeed) return;
    const id = nextDemoId.current--;
    const demo: ListedSession = {
      id,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'recording',
      desktopTrackPath: '',
      isDemo: true,
    };
    setDemoSessions((list) => [...list, demo]);
    demoCancels.current.set(
      id,
      demoFeed((u) => pushUpdate(sessionKey(demo), u)),
    );
    setRoute({ name: 'live', sessionKey: sessionKey(demo) });
  }

  function openSession(s: ListedSession): void {
    setRoute(
      s.status === 'recording'
        ? { name: 'live', sessionKey: sessionKey(s) }
        : { name: 'replay', session: s },
    );
  }

  const goSessions = () => setRoute({ name: 'sessions' });
  const sidebarActive: Destination =
    route.name === 'live' || route.name === 'replay' ? 'sessions' : route.name;
  const liveSession =
    route.name === 'live' ? sessions.find((s) => sessionKey(s) === route.sessionKey) : undefined;
  const audioCapture = active.current?.capture;
  const getLevel = useCallback(
    () => (audioCapture ? audioCapture.level() : 0),
    [audioCapture],
  );

  return (
    <div className="app">
      <Sidebar active={sidebarActive} onNavigate={(d) => setRoute({ name: d })} />
      <main className="app__main">
        {notice && (
          <div className="notice" role="alert">
            <span>{notice}</span>
            <button type="button" className="btn btn--link" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        {route.name === 'sessions' && (
          <SessionList
            sessions={sessions}
            now={now}
            onOpen={openSession}
            onStart={() => setStartPanelOpen(true)}
            startDisabled={activeId !== null}
            onStartDemo={demoFeed ? startDemo : undefined}
          />
        )}
        {route.name === 'live' && liveSession && (
          <LiveView
            session={liveSession}
            now={now}
            utterances={transcripts[route.sessionKey] ?? []}
            getLevel={liveSession.isDemo ? undefined : getLevel}
            onStop={() => void stopSession(liveSession)}
            onBack={goSessions}
          />
        )}
        {route.name === 'replay' && <ReplayPlaceholder onBack={goSessions} />}
        {route.name === 'vocabulary' && (
          <>
            <ScreenHeader title="Vocabulary" />
            <EmptyState title="Vocabulary is coming soon">
              Every word you hear will collect here.
            </EmptyState>
          </>
        )}
        {route.name === 'settings' && (
          <>
            <ScreenHeader title="Settings" />
            <EmptyState title="Settings are coming soon">
              API keys and preferences will live here.
            </EmptyState>
          </>
        )}
      </main>
      {startPanelOpen && (
        <StartPanel onStart={() => void startRecording()} onCancel={() => setStartPanelOpen(false)} />
      )}
    </div>
  );
}
