import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApiKeyName,
  ApiKeyStatus,
  AudioCapture,
  AudioInputs,
  AudioSettings,
  Bridge,
  BundleProblem,
  DemoFeed,
  DesktopAudioCapture,
  ListedSession,
  MicAudioCapture,
  LiveUtterance,
  ReadyUpdate,
  ReplayLayout,
  Track,
  Unsubscribe,
  VocabularyEntry,
} from './bridge';
import { DeviceUnavailableError, NoDesktopAudioError } from './bridge';
import type { AnkiActions } from './components/AnkiExport';
import { CreditsView } from './components/CreditsView';
import { LiveView } from './components/LiveView';
import { ReplayPlaceholder } from './components/ReplayPlaceholder';
import { SessionList } from './components/SessionList';
import { SessionView, type SessionTab } from './components/SessionView';
import { SettingsView } from './components/SettingsView';
import { Sidebar, type Destination } from './components/Sidebar';
import { StartPanel } from './components/StartPanel';
import { VocabularyList } from './components/VocabularyList';
import { WordCardView } from './components/WordCardView';
import { isDemoKey, sessionKey } from './sessionKey';
import { applyUpdate } from './transcript';
import { useNow } from './useNow';
import './App.css';

export interface AppProps {
  bridge: Bridge;
  capture: DesktopAudioCapture;
  /** Opens the microphone when the learner chooses a Mic Track. */
  micCapture: MicAudioCapture;
  /** Lists the audio inputs the Settings screen offers. */
  audioInputs: AudioInputs;
  /** Present only in dev builds; enables the Demo Session. */
  demoFeed?: DemoFeed;
}

type Route =
  | { name: Destination }
  | { name: 'live'; sessionKey: string }
  | { name: 'replay'; session: ListedSession; tab: SessionTab }
  | { name: 'word-card'; lemmaId: number; back: Route };

/** The sidebar destination a screen belongs to. */
function destinationOf(route: Route): Destination {
  if (route.name === 'word-card') return destinationOf(route.back);
  return route.name === 'live' || route.name === 'replay' ? 'sessions' : route.name;
}

interface ActiveRecording {
  sessionId: number;
  capture: AudioCapture;
  /** The microphone, when the Session has a Mic Track. */
  mic: AudioCapture | null;
  /** Serializes each track's writes so chunks reach the main process in order. Never reject. */
  writes: Promise<void>;
  micWrites: Promise<void>;
  writeError: Error | null;
}

/** The system's own devices: all system audio transcribed, the default microphone. */
const SYSTEM_AUDIO: AudioSettings = { desktopSource: null, microphone: null };

function sortNewestFirst(list: ListedSession[]): ListedSession[] {
  return [...list].sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt) || b.id - a.id,
  );
}

export function App({ bridge, capture, micCapture, audioInputs, demoFeed }: AppProps) {
  const [route, setRoute] = useState<Route>({ name: 'sessions' });
  const [realSessions, setRealSessions] = useState<ListedSession[]>([]);
  const [demoSessions, setDemoSessions] = useState<ListedSession[]>([]);
  const [transcripts, setTranscripts] = useState<Record<string, LiveUtterance[]>>({});
  const [startPanelOpen, setStartPanelOpen] = useState(false);
  /** The devices the next Session records from, loaded when the Start panel opens. */
  const [startDevices, setStartDevices] = useState<AudioSettings | null>(null);
  /** Which API keys are set, loaded when the Start panel opens so it can warn about missing ones. */
  const [startKeys, setStartKeys] = useState<ApiKeyStatus[] | null>(null);
  /** Why speech-to-text stopped, by Session key; its audio keeps recording. */
  const [transcriptionFailures, setTranscriptionFailures] = useState<Record<string, string>>({});
  /** Why the Mic Track's speech-to-text stopped, by Session key; the rest carries on. */
  const [micTranscriptionFailures, setMicTranscriptionFailures] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [vocabulary, setVocabulary] = useState<VocabularyEntry[] | null>(null);
  const [vocabularyQuery, setVocabularyQuery] = useState('');
  /** What a packaged build is missing (GLOSSARY: Installer); told until it is reinstalled. */
  const [bundleProblems, setBundleProblems] = useState<BundleProblem[]>([]);
  const [readyUpdate, setReadyUpdate] = useState<ReadyUpdate | null>(null);
  /** How Replay shows Learner Utterances, for every Session (settings.json). */
  const [replayLayout, setReplayLayout] = useState<ReplayLayout>('together');
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

  useEffect(() => {
    let current = true;
    bridge
      .bundleProblems()
      .then((problems) => current && setBundleProblems(problems))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [bridge]);

  useEffect(() => {
    let current = true;
    bridge
      .replayLayout()
      .then((layout) => current && setReplayLayout(layout))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [bridge]);

  /** Applies at once; saved for every Session afterwards. */
  function changeReplayLayout(layout: ReplayLayout): void {
    setReplayLayout(layout);
    bridge
      .saveReplayLayout(layout)
      .catch((err: Error) => setNotice(`Could not save the Replay choice: ${err.message}`));
  }

  // An update can finish downloading before or after the window opens.
  useEffect(() => {
    let current = true;
    const off = bridge.subscribeUpdateReady((u) => current && setReadyUpdate(u));
    bridge
      .readyUpdate()
      .then((u) => current && u && setReadyUpdate((shown) => shown ?? u))
      .catch(() => undefined);
    return () => {
      current = false;
      off();
    };
  }, [bridge]);

  const pushUpdate = useCallback((key: string, u: LiveUtterance) => {
    setTranscripts((t) => ({ ...t, [key]: applyUpdate(t[key] ?? [], u) }));
  }, []);

  /**
   * Follows a real Session's live Transcript, and whether its speech-to-text has stopped.
   * A failure can come before the subscription (no key fails at once), so it is also asked for.
   */
  const follow = useCallback(
    (sessionId: number): Unsubscribe => {
      const key = String(sessionId);
      let current = true;
      const fail = (message: string, track: Track = 'desktop') =>
        current &&
        (track === 'mic' ? setMicTranscriptionFailures : setTranscriptionFailures)((f) =>
          f[key] === message ? f : { ...f, [key]: message },
        );
      const offUpdates = bridge.subscribeTranscript(sessionId, (u) => pushUpdate(key, u));
      const offFailures = bridge.subscribeTranscriptionFailure(sessionId, fail);
      bridge
        .transcriptionFailure(sessionId)
        .then((message) => message && fail(message))
        .catch(() => undefined);
      bridge
        .transcriptionFailure(sessionId, 'mic')
        .then((message) => message && fail(message, 'mic'))
        .catch(() => undefined);
      return () => {
        current = false;
        offUpdates();
        offFailures();
      };
    },
    [bridge, pushUpdate],
  );

  // Live transcript of the Session this window is recording, kept while the learner
  // looks elsewhere so Live View is complete on return.
  useEffect(() => {
    if (activeId === null) return;
    return follow(activeId);
  }, [activeId, follow]);

  // Any other real Session being viewed live.
  const liveKey = route.name === 'live' ? route.sessionKey : null;
  useEffect(() => {
    if (liveKey === null || isDemoKey(liveKey) || liveKey === String(activeId)) return;
    return follow(Number(liveKey));
  }, [liveKey, activeId, follow]);

  // The Vocabulary grows while Sessions record, so reload it each time it is opened.
  const onVocabulary = route.name === 'vocabulary';
  useEffect(() => {
    if (!onVocabulary) return;
    let current = true;
    bridge
      .listVocabulary()
      .then((list) => current && setVocabulary(list))
      .catch((err: Error) => current && setNotice(`Could not load the Vocabulary: ${err.message}`));
    return () => {
      current = false;
    };
  }, [bridge, onVocabulary]);

  // Stop any demo feeds if the app unmounts.
  useEffect(() => {
    const cancels = demoCancels.current;
    return () => cancels.forEach((cancel) => cancel());
  }, []);

  const now = useNow(sessions.some((s) => s.status === 'recording'));

  async function startRecording({
    mic: withMic,
    transcribeMic = false,
  }: {
    mic: boolean;
    transcribeMic?: boolean;
  }): Promise<void> {
    if (starting.current || active.current) return;
    starting.current = true;
    setStartPanelOpen(false);
    setNotice(null);
    // The devices chosen in Settings; the system's own when they cannot be read.
    const devices = startDevices ?? (await bridge.audioSettings().catch(() => SYSTEM_AUDIO));
    let audio: AudioCapture;
    try {
      audio = await capture.open(devices.desktopSource);
    } catch (err) {
      starting.current = false;
      setNotice(
        err instanceof NoDesktopAudioError || err instanceof DeviceUnavailableError
          ? err.message
          : `Could not start: ${(err as Error).message}`,
      );
      return;
    }
    let mic: AudioCapture | null = null;
    if (withMic) {
      try {
        mic = await micCapture.open(devices.microphone);
      } catch (err) {
        starting.current = false;
        await audio.stop().catch(() => undefined);
        setNotice(`Could not open the microphone: ${(err as Error).message}`);
        return;
      }
    }
    let createdId: number | null = null;
    try {
      // Learner Utterances are asked for only when the learner ticked it (ADR 0004).
      const created = await bridge.startSession(
        mic !== null && transcribeMic ? { mic: true, transcribeMic: true } : { mic: mic !== null },
      );
      createdId = created.id;
      const rec: ActiveRecording = {
        sessionId: created.id,
        capture: audio,
        mic,
        writes: Promise.resolve(),
        micWrites: Promise.resolve(),
        writeError: null,
      };
      const write = async (append: () => Promise<void>) => {
        try {
          await append();
        } catch (err) {
          rec.writeError = err as Error;
        }
      };
      // Both tracks begin together so Replay can play them in sync.
      audio.begin((chunk) => {
        rec.writes = rec.writes.then(() => write(() => bridge.appendDesktopAudio(created.id, chunk)));
      });
      mic?.begin((chunk) => {
        rec.micWrites = rec.micWrites.then(() => write(() => bridge.appendMicAudio(created.id, chunk)));
      });
      active.current = rec;
      setActiveId(created.id);
      await refresh();
      setRoute({ name: 'live', sessionKey: String(created.id) });
    } catch (err) {
      // Release the captures and close any Session row that was already created.
      await Promise.all([audio.stop(), mic?.stop()].map((p) => p?.catch(() => undefined)));
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
        await Promise.all([rec.capture.stop(), rec.mic?.stop()]);
        await Promise.all([rec.writes, rec.micWrites]);
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
      micTrackPath: null,
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
        : { name: 'replay', session: s, tab: 'replay' },
    );
  }

  function openStartPanel(): void {
    setStartDevices(null);
    setStartKeys(null);
    setStartPanelOpen(true);
    // Without the key list the panel simply shows no key warnings.
    bridge.apiKeys().then(setStartKeys).catch(() => undefined);
    bridge
      .audioSettings()
      .then(setStartDevices)
      .catch(() => setStartDevices(SYSTEM_AUDIO));
  }

  // "Restart to update" never shows while a Session records, in this window or another.
  const recording = activeId !== null || realSessions.some((s) => s.status === 'recording');
  const restartToUpdate = () =>
    void bridge.restartToUpdate().catch((err: Error) => setNotice(`Could not restart to update: ${err.message}`));

  const goSessions = () => setRoute({ name: 'sessions' });
  const sidebarActive = destinationOf(route);
  const liveSession =
    route.name === 'live' ? sessions.find((s) => sessionKey(s) === route.sessionKey) : undefined;
  const audioCapture = active.current?.capture;
  const getLevel = useCallback(
    () => (audioCapture ? audioCapture.level() : 0),
    [audioCapture],
  );
  const loadWordDetails = useCallback(
    (lemmaId: number, surface: string) => bridge.wordDetails(lemmaId, surface),
    [bridge],
  );
  const loadSessionGuide = useCallback((sessionId: number) => bridge.sessionGuide(sessionId), [bridge]);
  const loadTranscript = useCallback((sessionId: number) => bridge.transcript(sessionId), [bridge]);
  const loadWordCard = useCallback((lemmaId: number) => bridge.wordCard(lemmaId), [bridge]);
  const loadAudioSettings = useCallback(() => bridge.audioSettings(), [bridge]);
  const saveAudioSettings = useCallback((s: AudioSettings) => bridge.saveAudioSettings(s), [bridge]);
  const listAudioInputs = useCallback(() => audioInputs.list(), [audioInputs]);
  const loadApiKeys = useCallback(() => bridge.apiKeys(), [bridge]);
  const saveApiKey = useCallback((name: ApiKeyName, key: string | null) => bridge.saveApiKey(name, key), [bridge]);
  const checkApiKey = useCallback((name: ApiKeyName) => bridge.checkApiKey(name), [bridge]);
  const loadDictionaryNotice = useCallback(() => bridge.dictionaryNotice(), [bridge]);
  const anki = useMemo<AnkiActions>(
    () => ({
      exportToAnki: (target) => bridge.exportToAnki(target),
      showExportedFile: (path) => bridge.showExportedFile(path),
    }),
    [bridge],
  );
  const openWordCard = (lemmaId: number) => setRoute({ name: 'word-card', lemmaId, back: route });

  return (
    <div className="app">
      <Sidebar active={sidebarActive} onNavigate={(d) => setRoute({ name: d })} />
      <main className="app__main">
        {bundleProblems.map((p) => (
          <div key={p.part} className="notice" role="alert">
            <span>{p.message}</span>
          </div>
        ))}
        {readyUpdate && !recording && (
          <div className="notice notice--update" role="status">
            <span>Version {readyUpdate.version} is ready to install.</span>
            <button type="button" className="btn btn--primary" onClick={restartToUpdate}>
              Restart to update
            </button>
          </div>
        )}
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
            onStart={openStartPanel}
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
            transcriptionFailure={transcriptionFailures[route.sessionKey]}
            micTranscriptionFailure={micTranscriptionFailures[route.sessionKey]}
            onStop={() => void stopSession(liveSession)}
            onBack={goSessions}
            loadWordDetails={loadWordDetails}
          />
        )}
        {route.name === 'replay' &&
          (route.session.isDemo ? (
            <ReplayPlaceholder onBack={goSessions} />
          ) : (
            <SessionView
              session={route.session}
              tab={route.tab}
              onTabChange={(tab) => setRoute({ ...route, tab })}
              layout={replayLayout}
              onLayoutChange={changeReplayLayout}
              audioUrl={bridge.desktopTrackUrl(route.session.id)}
              micAudioUrl={route.session.micTrackPath ? bridge.micTrackUrl(route.session.id) : undefined}
              loadTranscript={loadTranscript}
              loadWordDetails={loadWordDetails}
              loadGuide={loadSessionGuide}
              onOpenWord={openWordCard}
              onBack={goSessions}
              anki={anki}
            />
          ))}
        {route.name === 'word-card' && (
          <WordCardView
            lemmaId={route.lemmaId}
            loadCard={loadWordCard}
            backLabel={route.back.name === 'vocabulary' ? 'Back to Vocabulary' : 'Back to Session Guide'}
            onBack={() => setRoute(route.back)}
          />
        )}
        {route.name === 'vocabulary' && (
          <VocabularyList
            entries={vocabulary}
            query={vocabularyQuery}
            onQueryChange={setVocabularyQuery}
            onOpenWord={openWordCard}
            anki={anki}
          />
        )}
        {route.name === 'settings' && (
          <SettingsView
            loadSettings={loadAudioSettings}
            saveSettings={saveAudioSettings}
            listDevices={listAudioInputs}
            loadKeys={loadApiKeys}
            saveKey={saveApiKey}
            checkKey={checkApiKey}
          />
        )}
        {route.name === 'credits' && <CreditsView loadDictionaryNotice={loadDictionaryNotice} />}
      </main>
      {startPanelOpen && (
        <StartPanel
          devices={startDevices}
          keys={startKeys}
          onOpenSettings={() => {
            setStartPanelOpen(false);
            setRoute({ name: 'settings' });
          }}
          onStart={(options) => void startRecording(options)}
          onCancel={() => setStartPanelOpen(false)}
        />
      )}
    </div>
  );
}
