import { useEffect, useState } from 'react';

// Returns a 0..1 loudness value for a MediaStream's audio, ~10 times a
// second. Used for the live microphone meter on the call screen.
export function useAudioLevel(stream, enabled = true) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || !enabled || stream.getAudioTracks().length === 0) {
      setLevel(0);
      return undefined;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return undefined;

    let ac;
    let timer;
    try {
      ac = new AC();
      const source = ac.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      const analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 4));
      }, 100);
    } catch {
      return undefined;
    }

    return () => {
      clearInterval(timer);
      ac?.close().catch(() => {});
      setLevel(0);
    };
  }, [stream, enabled]);

  return level;
}
