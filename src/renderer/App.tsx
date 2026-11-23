import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApiKeyName,
  ApiKeyStatus,
  AudioCapture,
  AudioDevice,
  AudioInputs,
  AudioSettings,
  Bridge,
  BundleProblem,
  DemoFeed,
  DesktopAudioCapture,
  ImportStatus,
  ListedSession,
  MicAudioCapture,
  MicRecordingGate,
  MicTranscriptionStatus,
  LiveUtterance,
  PickedRecording,
  ReadyUpdate,
  RecordingProbe,
  ReplayLayout,
  Track,
  Unsubscribe,
  VocabularyEntry,
} from './bridge';
import { DeviceUnavailableError, NoDesktopAudioError } from './bridge';
import type { AnkiActions } from './components/AnkiExport';
import { CreditsView } from './components/CreditsView';
import { ImportDialog } from './components/ImportDialog';
import { LiveView } from './components/LiveView';
import { RemoveDialog } from './components/RemoveDialog';
import { ReplayPlaceholder } from './components/ReplayPlaceholder';
import { SessionList } from './components/SessionList';
import { SessionView, type SessionTab } from './components/SessionView';
import { SettingsView } from './components/SettingsView';
import { Sidebar, type Destination } from './components/Sidebar';
import { StartPanel } from './components/StartPanel';
import { VocabularyList } from './components/VocabularyList';
import { WordCardView } from './components/WordCardView';
import { formatShortStart } from './format';
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
  /** Applies the mic threshold to a stored Mic Track before "Transcribe my microphone" sends it. */
  micRecordingGate: MicRecordingGate;
  /** Present only in dev builds; enables the Demo Session. */
  demoFeed?: DemoFeed;
  /** Tells a picked recording's length before it is imported; unknown (null) by default. */
  recordingProbe?: RecordingProbe;
}

const NO_PROBE: RecordingProbe = { durationMs: async () => null };

/** Whether a speech-to-text key is set; unknown (null) keys count as set, so nothing is disabled for nothing. */
function hasSpeechToTextKey(keys: ApiKeyStatus[] | null): boolean {
  return keys === null || keys.some((k) => (k.name === 'soniox' || k.name === 'deepgram') && k.source !== null);
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
  /** What the mic threshold let through to speech-to-text, in order. */
  gatedMicWrites: Promise<void>;
  writeError: Error | null;
}

/** Shown while the Mic Track is gated here, before the main process has the job. */
const PREPARING_NOTE = 'Preparing your speech…';

/** The system's own devices: all system audio transcribed, the default microphone. */
const SYSTEM_AUDIO: AudioSettings = { desktopSource: null, microphone: null };

function sortNewestFirst(list: ListedSession[]): ListedSession[] {
  return [...list].sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt) || b.id - a.id,
  );
}

export function App({
  bridge,
  capture,
  micCapture,
  audioInputs,
  micRecordingGate,
  demoFeed,
  recordingProbe = NO_PROBE,
}: AppProps) {
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
  /** The Vocabulary's Ignored filter. */
  const [ignoredOnly, setIgnoredOnly] = useState(false);
  /** Bumped when a Lemma is ignored or stops being so: the Vocabulary, guides and word panel reload. */
  const [ignoreVersion, setIgnoreVersion] = useState(0);
  /** The word just ignored, for its "Undo" notice. */
  const [justIgnored, setJustIgnored] = useState<{ lemmaId: number; lemma: string } | null>(null);
  /** What a packaged build is missing (GLOSSARY: Installer); told until it is reinstalled. */
  const [bundleProblems, setBundleProblems] = useState<BundleProblem[]>([]);
  const [readyUpdate, setReadyUpdate] = useState<ReadyUpdate | null>(null);
  /** How Replay shows Learner Utterances, for every Session (settings.json). */
  const [replayLayout, setReplayLayout] = useState<ReplayLayout>('together');
  /** "Transcribe my microphone" by Session id: running, failed, or done this run. */
  const [micTranscriptions, setMicTranscriptions] = useState<Record<number, MicTranscriptionStatus>>({});
  /** Bumped when a Session's stored Transcript changes, so Replay loads it again. */
  const [transcriptVersions, setTranscriptVersions] = useState<Record<number, number>>({});
  /** How each import running is going, by Session id. */
  const [imports, setImports] = useState<Record<number, ImportStatus>>({});
  /** A recording picked to import, while its name is asked for. */
  const [importDraft, setImportDraft] = useState<PickedRecording | null>(null);
  /** Which API keys are set, for "Import recording"; null until loaded. */
  const [listKeys, setListKeys] = useState<ApiKeyStatus[] | null>(null);
  /** The Session the remove dialog is open for. */
  const [removing, setRemoving] = useState<ListedSession | null>(null);
  /** "Removed …", once a Session is removed. */
  const [removedNotice, setRemovedNotice] = useState<string | null>(null);
  const active = useRef<ActiveRecording | null>(null);
  const starting = useRef(false);
  const demoCancels = useRef(new Map<number, Unsubscribe>());
  const nextDemoId = useRef(-1);

  const sessions = sortNewestFirst([...demoSessions, ...realSessions]);

  const refresh = useCallback(async () => {
    const list = await bridge.listSessions();
    setRealSessions(list);
    // An import that began before this window loaded (or before it last listed) says how it is going.
    for (const s of list.filter((x) => x.status === 'importing')) {
      bridge
        .importStatus(s.id)
        .then((status) => status && setImports((m) => (m[s.id] ? m : { ...m, [s.id]: status })))
        .catch(() => undefined);
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The import runs in the main process; it reports however the learner moves around.
  useEffect(
    () =>
      bridge.subscribeImports((sessionId, status) => {
        if (status.state === 'running') {
          setImports((m) => ({ ...m, [sessionId]: status }));
          return;
        }
        setImports(({ [sessionId]: _, ...rest }) => rest);
        if (status.state === 'failed') setNotice(`Could not import “${status.name}”: ${status.message}`);
        void refresh().catch(() => undefined);
      }),
    [bridge, refresh],
  );

  // Keys can change in Settings, so they are read each time the Session List shows.
  const onSessionList = route.name === 'sessions';
  useEffect(() => {
    if (!onSessionList) return;
    let current = true;
    bridge
      .apiKeys()
      .then((keys) => current && setListKeys(keys))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [bridge, onSessionList]);

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

  const setMicTranscription = useCallback((sessionId: number, status: MicTranscriptionStatus) => {
    setMicTranscriptions((m) => ({ ...m, [sessionId]: status }));
    if (status.state === 'done') setTranscriptVersions((v) => ({ ...v, [sessionId]: (v[sessionId] ?? 0) + 1 }));
  }, []);

  // The job runs in the main process; it reports on every Session, whichever screen is open.
  useEffect(() => bridge.subscribeMicTranscriptions(setMicTranscription), [bridge, setMicTranscription]);

  /** The open Session's job may have started before this window last loaded. */
  const replayId = route.name === 'replay' && !route.session.isDemo ? route.session.id : null;
  useEffect(() => {
    if (replayId === null) return;
    let current = true;
    bridge
      .micTranscription(replayId)
      .then((status) => current && status && setMicTranscriptions((m) => (m[replayId] ? m : { ...m, [replayId]: status })))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [bridge, replayId]);

  /**
   * "Transcribe my microphone": with the mic threshold set, the Mic Track is gated here
   * first and sent as a copy; the transcription itself runs in the main process.
   */
  async function transcribeMic(sessionId: number): Promise<void> {
    setMicTranscription(sessionId, { state: 'running', note: PREPARING_NOTE });
    try {
      const threshold = (await bridge.audioSettings()).micThreshold;
      let gated = false;
      if (threshold !== undefined && threshold > 0) {
        const chunks = await micRecordingGate.gate(bridge.micTrackUrl(sessionId), threshold);
        await bridge.beginGatedMicRecording(sessionId);
        for (const chunk of chunks) await bridge.appendGatedMicRecording(sessionId, chunk);
        gated = true;
      }
      const status = await bridge.transcribeMicTrack(sessionId, { gated });
      // The main process may already have told how it went.
      setMicTranscriptions((m) => {
        const shown = m[sessionId];
        return shown?.state === 'running' && shown.note === PREPARING_NOTE ? { ...m, [sessionId]: status } : m;
      });
    } catch (err) {
      setMicTranscription(sessionId, { state: 'failed', message: (err as Error).message || String(err) });
    }
  }

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
  }, [bridge, onVocabulary, ignoreVersion]);

  /**
   * Ignores a Lemma (GLOSSARY: Ignored Lemma), or stops ignoring it, from the Vocabulary,
   * the word panel or a Session Guide. Ignoring shows an "Undo" notice; no dialog.
   */
  const setIgnored = useCallback(
    (lemmaId: number, lemma: string, ignored: boolean) => {
      bridge
        .setIgnored(lemmaId, ignored)
        .then(() => {
          setIgnoreVersion((v) => v + 1);
          setJustIgnored((shown) => (ignored ? { lemmaId, lemma } : shown?.lemmaId === lemmaId ? null : shown));
        })
        .catch((err: Error) =>
          setNotice(`Could not ${ignored ? 'ignore' : 'stop ignoring'} ${lemma}: ${err.message}`),
        );
    },
    [bridge],
  );

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
    // The mic threshold gates only what speech-to-text hears, so only a transcribed mic needs it.
    const threshold = withMic && transcribeMic ? devices.micThreshold : undefined;
    let mic: AudioCapture | null = null;
    if (withMic) {
      try {
        mic = await micCapture.open(devices.microphone, threshold);
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
        mic === null
          ? { mic: false }
          : {
              mic: true,
              ...(transcribeMic ? { transcribeMic: true } : {}),
              ...(threshold !== undefined ? { gateMic: true } : {}),
            },
      );
      createdId = created.id;
      const rec: ActiveRecording = {
        sessionId: created.id,
        capture: audio,
        mic,
        writes: Promise.resolve(),
        micWrites: Promise.resolve(),
        gatedMicWrites: Promise.resolve(),
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
      const recordMic = (chunk: Uint8Array) => {
        rec.micWrites = rec.micWrites.then(() => write(() => bridge.appendMicAudio(created.id, chunk)));
      };
      // Gated audio only feeds speech-to-text: losing a chunk of it loses no recording.
      const sendGatedMic = (chunk: Uint8Array) => {
        rec.gatedMicWrites = rec.gatedMicWrites.then(() =>
          bridge.appendGatedMicAudio(created.id, chunk).catch(() => undefined),
        );
      };
      mic?.begin(recordMic, threshold === undefined ? undefined : sendGatedMic);
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
        await Promise.all([rec.writes, rec.micWrites, rec.gatedMicWrites]);
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
      name: null,
      imported: false,
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
    if (s.status === 'importing') return;
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

  /** Picks a recording, then asks for its name (ImportDialog). */
  async function pickRecording(): Promise<void> {
    setNotice(null);
    try {
      const picked = await bridge.pickRecording();
      if (picked) setImportDraft(picked);
    } catch (err) {
      setNotice((err as Error).message || String(err));
    }
  }

  /** Imports the picked recording in the main process; its row shows at once, marked importing. */
  async function importRecording(draft: PickedRecording, name: string | null): Promise<void> {
    setImportDraft(null);
    try {
      const durationMs = await recordingProbe.durationMs(bridge.pickedRecordingUrl(draft.token)).catch(() => null);
      await bridge.importRecording(draft.token, name, durationMs);
    } catch (err) {
      setNotice(`Could not import the recording: ${(err as Error).message}`);
    }
    await refresh();
  }

  function cancelImport(s: ListedSession): void {
    bridge
      .cancelImport(s.id)
      .catch((err: Error) => setNotice(`Could not cancel the import: ${err.message}`))
      .finally(() => void refresh());
  }

  /** Renames a completed Session, from its row or its header. */
  function renameSession(s: ListedSession, name: string | null): void {
    bridge
      .renameSession(s.id, name)
      .then((renamed) => {
        setRealSessions((list) => list.map((x) => (x.id === renamed.id ? renamed : x)));
        setRoute((r) => (r.name === 'replay' && r.session.id === renamed.id ? { ...r, session: renamed } : r));
      })
      .catch((err: Error) => setNotice(`Could not rename the Session: ${err.message}`));
  }

  /** A completed Session can be removed unless its mic transcription is running. */
  const canRemove = (s: ListedSession) =>
    !s.isDemo && s.status === 'completed' && micTranscriptions[s.id]?.state !== 'running';

  /** Removes a Session from the remove dialog; afterwards the Session List shows. */
  async function removeSession(s: ListedSession, keepWords: boolean): Promise<void> {
    setRemoving(null);
    setNotice(null);
    // Replay's player stops before its files are deleted.
    setRoute({ name: 'sessions' });
    try {
      await bridge.removeSession(s.id, keepWords);
      setRemovedNotice(s.name ? `Removed “${s.name}”` : `Removed the Session of ${formatShortStart(s.startedAt)}`);
      setIgnoreVersion((v) => v + 1);
    } catch (err) {
      setNotice(`Could not remove the Session: ${(err as Error).message}`);
    }
    await refresh();
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
  // Each changes with ignoreVersion, so what they show is loaded again once a word is ignored.
  const loadWordDetails = useCallback(
    (lemmaId: number, surface: string) => bridge.wordDetails(lemmaId, surface),
    [bridge, ignoreVersion],
  );
  const loadSessionGuide = useCallback(
    (sessionId: number) => bridge.sessionGuide(sessionId),
    [bridge, ignoreVersion],
  );
  const loadTranscript = useCallback((sessionId: number) => bridge.transcript(sessionId), [bridge]);
  const loadWordCard = useCallback((lemmaId: number) => bridge.wordCard(lemmaId), [bridge]);
  const loadAudioSettings = useCallback(() => bridge.audioSettings(), [bridge]);
  const saveAudioSettings = useCallback((s: AudioSettings) => bridge.saveAudioSettings(s), [bridge]);
  const listAudioInputs = useCallback(() => audioInputs.list(), [audioInputs]);
  const openMicMeter = useCallback((device: AudioDevice | null) => micCapture.open(device), [micCapture]);
  const loadApiKeys = useCallback(() => bridge.apiKeys(), [bridge]);
  const saveApiKey = useCallback((name: ApiKeyName, key: string | null) => bridge.saveApiKey(name, key), [bridge]);
  const checkApiKey = useCallback((name: ApiKeyName) => bridge.checkApiKey(name), [bridge]);
  const loadDictionaryNotice = useCallback(() => bridge.dictionaryNotice(), [bridge]);
  const loadRemovalPreview = useCallback((sessionId: number) => bridge.removalPreview(sessionId), [bridge]);
  const importing = realSessions.some((s) => s.status === 'importing');
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
        {justIgnored && (
          <div className="notice notice--info" role="status" aria-label="Ignored word">
            <div className="notice__lines">
              <span>
                Ignored{' '}
                <span lang="ar" dir="rtl">
                  {justIgnored.lemma}
                </span>
                {' · '}
                <button
                  type="button"
                  className="btn btn--link"
                  onClick={() => setIgnored(justIgnored.lemmaId, justIgnored.lemma, false)}
                >
                  Undo
                </button>
              </span>
              <span className="notice__note">
                It stays out of your Session Guides and Anki exports. If you already imported it into Anki, suspend
                or delete its note there.
              </span>
            </div>
            <button type="button" className="btn btn--link" onClick={() => setJustIgnored(null)}>
              Dismiss
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
        {removedNotice && route.name === 'sessions' && (
          <div className="notice notice--info" role="status" aria-label="Removed Session">
            <span dir="auto">{removedNotice}</span>
            <button type="button" className="btn btn--link" onClick={() => setRemovedNotice(null)}>
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
            imports={imports}
            actions={{
              onRename: renameSession,
              onRemove: setRemoving,
              canRemove,
              onCancelImport: cancelImport,
            }}
            importOffer={{
              onImport: () => void pickRecording(),
              disabledBecause: !hasSpeechToTextKey(listKeys) ? 'no-key' : importing ? 'importing' : undefined,
              onOpenSettings: () => setRoute({ name: 'settings' }),
            }}
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
            onSetIgnored={liveSession.isDemo ? undefined : setIgnored}
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
              transcriptVersion={transcriptVersions[route.session.id] ?? 0}
              micTranscription={micTranscriptions[route.session.id]}
              onTranscribeMic={() => void transcribeMic(route.session.id)}
              loadWordDetails={loadWordDetails}
              loadGuide={loadSessionGuide}
              onOpenWord={openWordCard}
              onSetIgnored={setIgnored}
              onBack={goSessions}
              anki={anki}
              onRename={(name) => renameSession(route.session, name)}
              onRemove={canRemove(route.session) ? () => setRemoving(route.session) : undefined}
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
            ignoredOnly={ignoredOnly}
            onIgnoredOnlyChange={setIgnoredOnly}
            onOpenWord={openWordCard}
            onSetIgnored={setIgnored}
            anki={anki}
          />
        )}
        {route.name === 'settings' && (
          <SettingsView
            loadSettings={loadAudioSettings}
            saveSettings={saveAudioSettings}
            listDevices={listAudioInputs}
            openMeter={openMicMeter}
            loadKeys={loadApiKeys}
            saveKey={saveApiKey}
            checkKey={checkApiKey}
          />
        )}
        {route.name === 'credits' && <CreditsView loadDictionaryNotice={loadDictionaryNotice} />}
      </main>
      {importDraft && (
        <ImportDialog
          suggestedName={importDraft.name}
          onImport={(name) => void importRecording(importDraft, name)}
          onCancel={() => setImportDraft(null)}
        />
      )}
      {removing && (
        <RemoveDialog
          session={removing}
          loadPreview={loadRemovalPreview}
          onRemove={(keepWords) => void removeSession(removing, keepWords)}
          onCancel={() => setRemoving(null)}
        />
      )}
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
