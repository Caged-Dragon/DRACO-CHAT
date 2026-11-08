// Call sounds generated with the Web Audio API (no audio files to ship).
//   startRingtone()  — incoming call: two-note chime + vibration
//   startRingback()  — you are calling: soft repeating tone
//   playBeep(kind)   — short cue when a call connects / ends
// Browsers only allow sound after the user has interacted with the page;
// if audio is blocked the call still works, it just rings silently.

let ctx = null;
let loopTimer = null;
let vibrateTimer = null;

function audio() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, start, dur, volume = 0.12) {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const t0 = c.currentTime + start;
  // short fade in/out so there are no clicks
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function stopRinging() {
  if (loopTimer) clearInterval(loopTimer);
  if (vibrateTimer) clearInterval(vibrateTimer);
  loopTimer = null;
  vibrateTimer = null;
  try {
    navigator.vibrate?.(0);
  } catch {
    // vibration not supported
  }
}

export function startRingtone() {
  stopRinging();
  const chime = () => {
    tone(784, 0.0, 0.22, 0.16); // G5
    tone(988, 0.25, 0.22, 0.16); // B5
    tone(784, 0.8, 0.22, 0.16);
    tone(988, 1.05, 0.22, 0.16);
  };
  chime();
  loopTimer = setInterval(chime, 3000);

  const buzz = () => {
    try {
      navigator.vibrate?.([400, 200, 400]);
    } catch {
      // vibration not supported
    }
  };
  buzz();
  vibrateTimer = setInterval(buzz, 3000);
}

export function startRingback() {
  stopRinging();
  const burst = () => {
    tone(440, 0, 0.9, 0.07);
    tone(480, 0, 0.9, 0.07);
  };
  burst();
  loopTimer = setInterval(burst, 3500);
}

export function playBeep(kind) {
  if (kind === 'connected') {
    tone(660, 0, 0.12, 0.1);
    tone(880, 0.13, 0.16, 0.1);
  } else if (kind === 'ended') {
    tone(520, 0, 0.14, 0.1);
    tone(390, 0.16, 0.2, 0.1);
  }
}
