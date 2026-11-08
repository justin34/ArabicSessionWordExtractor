import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveUtterance, Utterance } from '../bridge';
import { formatDuration } from '../format';
import { replayPosition, type ReplayPosition } from '../replay';
import type { Loaded } from '../useLoaded';
import { EmptyState } from './EmptyState';
import { UtteranceView } from './UtteranceView';
import { WordPanel, type LoadWordDetails } from './WordPanel';
import './LiveView.css';
import './ReplayView.css';

/** A stored Utterance in the shape the word-by-word view draws. */
function asShown(u: Utterance): LiveUtterance {
  return {
    id: String(u.id),
    isFinal: true,
    text: u.text,
    translation: u.translation,
    tokens: u.tokens,
    ...(u.track === 'mic' ? { track: u.track } : {}),
  };
}

/**
 * Which Utterances Replay draws: the teacher's and the learner's interleaved by start
 * (`all`, Together), the teacher's alone (`teacher`), or Learner Utterances alone (`learner`, My Speech).
 */
export type ReplayShows = 'all' | 'teacher' | 'learner';

/** How far the Mic Track may drift from the Desktop Track before it is moved back in step. */
const MAX_MIC_DRIFT_S = 0.25;

/**
 * Replay of a completed Session: plays its Desktop Track, and its Mic Track in sync when it
 * has one, while its Transcript, drawn as in Live View, highlights the sentence and word
 * being heard on each Track, so a learner talking over the teacher lights one of each.
 * Clicking a sentence seeks to it; clicking a teacher's word opens the word panel.
 * Changing what it `shows` changes only what is drawn, never what is playing.
 */
export function ReplayView({
  transcript,
  shows,
  audioUrl,
  micAudioUrl,
  fallbackDurationMs,
  loadWordDetails,
}: {
  transcript: Loaded<Utterance[]>;
  shows: ReplayShows;
  audioUrl: string;
  /** The Mic Track, when the Session has one. The Desktop Track leads; the Mic Track follows it. */
  micAudioUrl?: string;
  /** Length shown until the audio reports its own (a recording may not carry one). */
  fallbackDurationMs: number;
  loadWordDetails: LoadWordDetails;
}) {
  const all = transcript.state === 'loaded' ? transcript.value : [];
  const teacher = all.filter((u) => u.track !== 'mic');
  const learner = all.filter((u) => u.track === 'mic');
  let utterances: Utterance[];
  if (shows === 'teacher') utterances = teacher;
  else if (shows === 'learner') utterances = learner;
  // Interleaved by start time, as in Live View; a stable sort keeps each Track's own order.
  else utterances = [...all].sort((a, b) => a.startMs - b.startMs);

  const audioRef = useRef<HTMLAudioElement>(null);
  const micRef = useRef<HTMLAudioElement>(null);
  const [micError, setMicError] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mediaDurationMs, setMediaDurationMs] = useState<number | null>(null);
  const [audioError, setAudioError] = useState(false);
  const durationMs = Math.max(mediaDurationMs ?? fallbackDurationMs, positionMs);

  const readPosition = useCallback(() => {
    const audio = audioRef.current;
    if (audio) setPositionMs(audio.currentTime * 1000);
  }, []);

  /** The Mic Track, unless there is none or it cannot be played. */
  const micTrack = useCallback(() => (micError ? null : micRef.current), [micError]);

  /** Moves the Mic Track to the Desktop Track's position when it has drifted (or always, with `force`). */
  const alignMic = useCallback(
    (force = false) => {
      const audio = audioRef.current;
      const mic = micTrack();
      if (!audio || !mic) return;
      if (force || Math.abs(mic.currentTime - audio.currentTime) > MAX_MIC_DRIFT_S) {
        mic.currentTime = audio.currentTime;
      }
    },
    [micTrack],
  );

  // timeupdate fires only a few times a second: too coarse for words, so follow frames while playing.
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      readPosition();
      alignMic();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, readPosition, alignMic]);

  function seek(ms: number, play = false): void {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = ms / 1000;
    alignMic(true);
    setPositionMs(ms);
    if (play) void audio.play()?.catch(() => undefined);
  }

  function togglePlay(): void {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play()?.catch(() => undefined);
    else audio.pause();
  }

  // Each Track has its own current Utterance and Token: the two can overlap.
  const lit = new Map<number, number | null>();
  const light = (track: Utterance[], position: ReplayPosition | null) => {
    if (position) lit.set(track[position.utterance].id, position.token);
  };
  light(teacher, replayPosition(teacher, positionMs));
  light(learner, replayPosition(learner, positionMs));
  // The one kept in view: the teacher's, unless only the learner's is drawn or lit.
  const currentId = utterances.find((u) => lit.has(u.id) && u.track !== 'mic')?.id
    ?? utterances.find((u) => lit.has(u.id))?.id
    ?? null;

  // Keep the sentence being heard in view while it plays.
  const currentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (playing) currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [currentId, playing, shows]);

  const [selected, setSelected] = useState<{ utteranceId: number; position: number } | null>(null);
  // The panel belongs to a teacher's word, so it closes when My Speech is drawn instead.
  const selectedToken = selected
    ? utterances.find((u) => u.id === selected.utteranceId && u.track !== 'mic')?.tokens[selected.position]
    : undefined;
  const closePanel = useCallback(() => setSelected(null), []);

  let body;
  if (transcript.state === 'loading') body = null;
  else if (transcript.state === 'failed')
    body = <EmptyState title="Could not load the Transcript">{transcript.message}</EmptyState>;
  else if (utterances.length === 0)
    body =
      shows === 'teacher' && learner.length > 0 ? (
        <EmptyState title="No Transcript">Only your own speech was transcribed in this Session.</EmptyState>
      ) : (
        <EmptyState title="No Transcript">Nothing was transcribed in this Session.</EmptyState>
      );
  else
    body = utterances.map((u) => (
      <div key={u.id} ref={u.id === currentId ? currentRef : undefined}>
        <UtteranceView
          utterance={asShown(u)}
          selectedWord={selected?.utteranceId === u.id ? selected.position : null}
          onSelectWord={u.track === 'mic' ? undefined : (p) => setSelected({ utteranceId: u.id, position: p })}
          replay={{
            current: lit.has(u.id),
            currentWord: lit.get(u.id) ?? null,
            time: formatDuration(u.startMs),
            onSeek: () => seek(u.startMs, true),
          }}
        />
      </div>
    ));

  return (
    <div className="replay">
      <audio
        ref={audioRef}
        data-track="desktop"
        src={audioUrl}
        preload="metadata"
        onPlay={() => {
          setPlaying(true);
          alignMic(true);
          void micTrack()?.play()?.catch(() => undefined);
        }}
        onPause={() => {
          setPlaying(false);
          micTrack()?.pause();
          readPosition();
        }}
        onEnded={() => {
          setPlaying(false);
          micTrack()?.pause();
        }}
        onTimeUpdate={readPosition}
        onSeeked={readPosition}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          setMediaDurationMs(Number.isFinite(d) ? d * 1000 : null);
        }}
        onError={() => setAudioError(true)}
      />
      {micAudioUrl && (
        <audio
          ref={micRef}
          data-track="mic"
          src={micAudioUrl}
          preload="metadata"
          onError={() => {
            micRef.current?.pause();
            setMicError(true);
          }}
        />
      )}
      <div className="replay__controls">
        <button
          type="button"
          className="btn btn--primary replay__play"
          onClick={togglePlay}
          disabled={audioError}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          className="replay__seek"
          aria-label="Playback position"
          aria-valuetext={formatDuration(positionMs)}
          min={0}
          max={Math.round(durationMs)}
          step={100}
          value={Math.round(positionMs)}
          disabled={audioError}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="replay__time">
          {formatDuration(positionMs)} / {formatDuration(durationMs)}
        </span>
      </div>
      {audioError && (
        <div className="live__warning" role="status">
          <strong>The Session’s audio can’t be played.</strong> Its Transcript is still here to read.
        </div>
      )}
      {micAudioUrl && micError && !audioError && (
        <div className="live__warning" role="status">
          <strong>The microphone track can’t be played.</strong> Replay plays the desktop audio alone.
        </div>
      )}
      <div className="live__bodywrap">
        <div className="live__body" role="region" aria-label="Transcript">
          {body}
        </div>
        {selectedToken && (
          <WordPanel
            token={selectedToken}
            loadDetails={loadWordDetails}
            onClose={closePanel}
            unanalyzedNote="This word was not analyzed, so it has no details."
          />
        )}
      </div>
    </div>
  );
}
