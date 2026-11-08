import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveUtterance, Utterance } from '../bridge';
import { formatDuration } from '../format';
import { replayPosition } from '../replay';
import { useLoaded } from '../useLoaded';
import { EmptyState } from './EmptyState';
import { UtteranceView } from './UtteranceView';
import { WordPanel, type LoadWordDetails } from './WordPanel';
import './LiveView.css';
import './ReplayView.css';

/** A stored Utterance in the shape the word-by-word view draws. */
function asShown(u: Utterance): LiveUtterance {
  return { id: String(u.id), isFinal: true, text: u.text, translation: u.translation, tokens: u.tokens };
}

/** How far the Mic Track may drift from the Desktop Track before it is moved back in step. */
const MAX_MIC_DRIFT_S = 0.25;

/**
 * Replay of a completed Session: plays its Desktop Track, and its Mic Track in sync when it
 * has one, while its Transcript, drawn as in
 * Live View, highlights the sentence and word being heard. Clicking a sentence seeks to it;
 * clicking a word opens the word panel.
 */
export function ReplayView({
  sessionId,
  audioUrl,
  micAudioUrl,
  fallbackDurationMs,
  loadTranscript,
  loadWordDetails,
}: {
  sessionId: number;
  audioUrl: string;
  /** The Mic Track, when the Session has one. The Desktop Track leads; the Mic Track follows it. */
  micAudioUrl?: string;
  /** Length shown until the audio reports its own (a recording may not carry one). */
  fallbackDurationMs: number;
  loadTranscript: (sessionId: number) => Promise<Utterance[]>;
  loadWordDetails: LoadWordDetails;
}) {
  const load = useCallback(() => loadTranscript(sessionId), [loadTranscript, sessionId]);
  const transcript = useLoaded(load);
  // Replay shows the teacher's Transcript; Learner Utterances join it with Together · Separate (#43).
  const utterances = transcript.state === 'loaded' ? transcript.value.filter((u) => u.track !== 'mic') : [];

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

  const position = replayPosition(utterances, positionMs);
  const currentId = position ? utterances[position.utterance].id : null;

  // Keep the sentence being heard in view while it plays.
  const currentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (playing) currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [currentId, playing]);

  const [selected, setSelected] = useState<{ utteranceId: number; position: number } | null>(null);
  const selectedToken = selected
    ? utterances.find((u) => u.id === selected.utteranceId)?.tokens[selected.position]
    : undefined;
  const closePanel = useCallback(() => setSelected(null), []);

  let body;
  if (transcript.state === 'loading') body = null;
  else if (transcript.state === 'failed')
    body = <EmptyState title="Could not load the Transcript">{transcript.message}</EmptyState>;
  else if (utterances.length === 0)
    body = <EmptyState title="No Transcript">Nothing was transcribed in this Session.</EmptyState>;
  else
    body = utterances.map((u, i) => (
      <div key={u.id} ref={u.id === currentId ? currentRef : undefined}>
        <UtteranceView
          utterance={asShown(u)}
          selectedWord={selected?.utteranceId === u.id ? selected.position : null}
          onSelectWord={(p) => setSelected({ utteranceId: u.id, position: p })}
          replay={{
            current: position?.utterance === i,
            currentWord: position?.utterance === i ? position.token : null,
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
