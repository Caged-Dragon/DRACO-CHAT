import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatClock } from '../hooks/useVoiceRecorder';

const BARS = 34;
const RATES = [1, 1.5, 2];
let activeAudio = null; // only one voice message plays at a time

// Deterministic "waveform" so every message gets a stable, natural-looking shape
function barHeights(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = [];
  for (let i = 0; i < BARS; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const v = ((h >>> 0) % 1000) / 1000;
    out.push(Math.round(24 + 76 * (0.3 + 0.7 * Math.abs(Math.sin(i * 0.5 + v * 2.4)))));
  }
  return out;
}

// Messages are saved as "Voice message (12s)" so the length shows before audio loads
export function parseVoiceSeconds(label = '') {
  const m = /\((\d+)s\)\s*$/.exec(label);
  return m ? Number(m[1]) : 0;
}

export default function VoicePlayer({ src, label, mine }) {
  const audioRef = useRef(null);
  const trackRef = useRef(null);
  const draggingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [failed, setFailed] = useState(false);
  const [buffering, setBuffering] = useState(false);

  const labelDuration = parseVoiceSeconds(label);
  const total = mediaDuration > 0 ? mediaDuration : labelDuration;
  const progress = total > 0 ? Math.min(1, current / total) : 0;
  const bars = useMemo(() => barHeights(src || ''), [src]);

  useEffect(
    () => () => {
      if (activeAudio === audioRef.current) activeAudio = null;
    },
    []
  );

  const onLoadedMetadata = (e) => {
    const a = e.currentTarget;
    if (Number.isFinite(a.duration) && a.duration > 0) {
      setMediaDuration(a.duration);
      return;
    }
    // Chrome writes WebM voice notes without a length (duration = Infinity).
    // Seeking far past the end forces it to work the real length out.
    const settle = () => {
      a.removeEventListener('timeupdate', settle);
      if (Number.isFinite(a.duration) && a.duration > 0) setMediaDuration(a.duration);
      a.currentTime = 0;
      setCurrent(0);
    };
    a.addEventListener('timeupdate', settle);
    a.currentTime = 1e7;
  };

  const toggle = useCallback(async () => {
    const a = audioRef.current;
    if (!a) return;
    if (!a.paused) {
      a.pause();
      return;
    }
    if (activeAudio && activeAudio !== a) activeAudio.pause();
    activeAudio = a;
    try {
      a.playbackRate = rate;
      await a.play();
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [rate]);

  const seekFromPointer = (clientX) => {
    const a = audioRef.current;
    const track = trackRef.current;
    if (!a || !track || !(total > 0)) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    a.currentTime = ratio * total;
    setCurrent(a.currentTime);
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const onKeyDown = (e) => {
    const a = audioRef.current;
    if (!a || !(total > 0)) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') a.currentTime = Math.min(total, a.currentTime + 5);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') a.currentTime = Math.max(0, a.currentTime - 5);
    else if (e.key === 'Home') a.currentTime = 0;
    else if (e.key === 'End') a.currentTime = total;
    else return;
    e.preventDefault();
    setCurrent(a.currentTime);
  };

  return (
    <div className={`voice-player ${mine ? 'mine' : 'theirs'}${failed ? ' failed' : ''}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={(e) => !draggingRef.current && setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onPlaying={() => setBuffering(false)}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        className={`voice-play${buffering && playing ? ' buffering' : ''}`}
        onClick={toggle}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <rect x="6" y="5" width="4.5" height="14" rx="1.4" fill="currentColor" />
            <rect x="13.5" y="5" width="4.5" height="14" rx="1.4" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div className="voice-body">
        <div
          ref={trackRef}
          className="voice-track"
          role="slider"
          tabIndex={0}
          aria-label="Voice message position"
          aria-valuemin={0}
          aria-valuemax={Math.round(total) || 0}
          aria-valuenow={Math.round(current)}
          aria-valuetext={`${formatClock(current)} of ${formatClock(total)}`}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            draggingRef.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            seekFromPointer(e.clientX);
          }}
          onPointerMove={(e) => draggingRef.current && seekFromPointer(e.clientX)}
          onPointerUp={() => (draggingRef.current = false)}
          onPointerCancel={() => (draggingRef.current = false)}
        >
          {bars.map((h, i) => (
            <span key={i} className={i / BARS < progress ? 'bar played' : 'bar'} style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="voice-meta">
          <span className="voice-time">{formatClock(playing || current > 0 ? current : total)}</span>
          {failed ? (
            <a className="voice-fallback" href={src} target="_blank" rel="noopener noreferrer" download>
              Can't play - download
            </a>
          ) : (
            <button type="button" className="voice-speed" onClick={cycleRate} aria-label={`Playback speed ${rate}x`}>
              {rate}×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
