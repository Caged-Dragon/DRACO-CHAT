import { useCallback, useEffect, useRef, useState } from 'react';

export const MAX_VOICE_SECONDS = 5 * 60;

// Safari/iOS records MP4 (AAC); Chrome/Firefox/Edge record WebM or Ogg. Pick what this
// browser can actually produce instead of mislabelling everything as webm.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export function extensionForMime(mime = '') {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Records a voice message. `onComplete({ blob, mime, duration })` fires after stop();
 * cancel() throws the recording away. Works the same for direct and group chats.
 */
export function useVoiceRecorder({ onComplete, onError } = {}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  const discardRef = useRef(false);
  const completeRef = useRef(onComplete);
  const errorRef = useRef(onError);
  completeRef.current = onComplete;
  errorRef.current = onError;

  const supported =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  const release = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    stop();
  }, [stop]);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    if (!supported) {
      errorRef.current?.('Voice messages are not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mime = pickRecorderMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      discardRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const duration = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        release();
        recorderRef.current = null;
        setRecording(false);
        setSeconds(0);
        if (!discardRef.current && blob.size > 0) {
          completeRef.current?.({ blob, mime: type.split(';')[0], duration });
        }
      };
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_VOICE_SECONDS) stop();
      }, 250);
    } catch (err) {
      release();
      recorderRef.current = null;
      setRecording(false);
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      errorRef.current?.(
        denied
          ? 'Microphone access is blocked. Allow it in your browser settings to send voice messages.'
          : 'Could not access the microphone.'
      );
    }
  }, [supported, release, stop]);

  // Leaving the chat mid-recording must not keep the microphone on
  useEffect(
    () => () => {
      discardRef.current = true;
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') rec.stop();
      release();
    },
    [release]
  );

  return { supported, recording, seconds, start, stop, cancel };
}
