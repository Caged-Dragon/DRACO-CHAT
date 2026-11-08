// Shared WebRTC helpers used by 1:1 calls (CallContext) and group calls
// (GroupCallContext). Everything here is plain functions so it can be
// unit-tested without React.

// ------------------------------------------------------------
// ICE servers
// ------------------------------------------------------------
// STUN lets two devices discover their public addresses. On many mobile
// carriers and corporate networks that is NOT enough, so a TURN relay is
// strongly recommended: set VITE_TURN_URL (one or several comma-separated
// URLs, e.g. "turn:host:3478?transport=udp,turn:host:3478?transport=tcp,
// turns:host:443?transport=tcp"), VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL.
export function buildIceServers(env = import.meta.env || {}) {
  const servers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  const raw = env.VITE_TURN_URL;
  if (raw) {
    const urls = String(raw)
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length) {
      servers.push({
        urls,
        username: env.VITE_TURN_USERNAME,
        credential: env.VITE_TURN_CREDENTIAL,
      });
    }
  }
  return servers;
}

export function hasTurnServer(env = import.meta.env || {}) {
  return Boolean(env.VITE_TURN_URL);
}

export function buildRtcConfig(env = import.meta.env || {}) {
  return {
    iceServers: buildIceServers(env),
    // Gather a couple of candidates ahead of time so calls connect faster
    iceCandidatePoolSize: 2,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
}

// ------------------------------------------------------------
// Network profile -> video quality
// ------------------------------------------------------------
export const VIDEO_PROFILES = {
  low: { width: 640, height: 360, frameRate: 15, maxBitrate: 350_000 },
  medium: { width: 854, height: 480, frameRate: 24, maxBitrate: 800_000 },
  high: { width: 1280, height: 720, frameRate: 30, maxBitrate: 1_800_000 },
};

export const AUDIO_MAX_BITRATE = 32_000;

export function getNetworkProfile(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const c = nav.connection;
  if (!c) return 'high';
  if (c.saveData) return 'low';
  if (c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || c.effectiveType === '3g') return 'low';
  if (c.type === 'cellular' || c.effectiveType === '4g') {
    // 4g covers both great and mediocre links; be careful on cellular
    return c.type === 'cellular' ? 'medium' : 'high';
  }
  return 'high';
}

// More people in a mesh call = more uploads, so drop quality as the room grows.
export function groupProfileFor(participantCount, base = getNetworkProfile()) {
  if (participantCount >= 5) return 'low';
  if (participantCount >= 3) return base === 'high' ? 'medium' : 'low';
  return base;
}

// ------------------------------------------------------------
// Media constraints + acquisition
// ------------------------------------------------------------
export function getAudioConstraints(deviceId) {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

export function getVideoConstraints(profile = 'high', { facingMode = 'user', deviceId } = {}) {
  const p = VIDEO_PROFILES[profile] || VIDEO_PROFILES.high;
  return {
    width: { ideal: p.width },
    height: { ideal: p.height },
    frameRate: { ideal: p.frameRate, max: p.frameRate },
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facingMode } }),
  };
}

export function describeMediaError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Permission denied. Allow microphone/camera access in your browser settings and try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone or camera was found on this device.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Your microphone or camera is being used by another app. Close it and try again.';
  }
  return 'Could not access camera/microphone.';
}

// Ask for good settings first; if the device can't satisfy them (or a
// previously chosen device vanished), fall back to plain defaults.
export async function acquireMedia(type, { profile, facingMode, audioDeviceId, videoDeviceId } = {}) {
  const md = navigator.mediaDevices;
  const wantVideo = type === 'video';
  try {
    return await md.getUserMedia({
      audio: getAudioConstraints(audioDeviceId),
      video: wantVideo ? getVideoConstraints(profile || getNetworkProfile(), { facingMode, deviceId: videoDeviceId }) : false,
    });
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError' || err?.name === 'NotFoundError') throw err;
    return md.getUserMedia({ audio: true, video: wantVideo });
  }
}

export async function listDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return {
      mics: all.filter((d) => d.kind === 'audioinput'),
      cams: all.filter((d) => d.kind === 'videoinput'),
      speakers: all.filter((d) => d.kind === 'audiooutput'),
    };
  } catch {
    return { mics: [], cams: [], speakers: [] };
  }
}

export function supportsSpeakerSelection() {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

export function supportsScreenShare() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

// ------------------------------------------------------------
// SDP tuning (Opus): in-band FEC + DTX + mono + capped bitrate.
// Great for voice on weak networks: the stream survives packet loss and
// uses almost no data while someone is silent.
// ------------------------------------------------------------
export function tuneOpusSdp(sdp, { maxBitrate = AUDIO_MAX_BITRATE } = {}) {
  if (!sdp) return sdp;
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n';
  const rtpmap = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!rtpmap) return sdp;
  const pt = rtpmap[1];

  const wanted = {
    useinbandfec: '1',
    usedtx: '1',
    stereo: '0',
    'sprop-stereo': '0',
    maxaveragebitrate: String(maxBitrate),
    minptime: '10',
  };

  const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  const existing = sdp.match(fmtpRe);
  if (existing) {
    const params = {};
    existing[1].split(';').forEach((kv) => {
      const [k, v] = kv.split('=');
      if (k && k.trim()) params[k.trim()] = v === undefined ? '' : v.trim();
    });
    Object.assign(params, wanted);
    const rebuilt = Object.entries(params)
      .map(([k, v]) => (v === '' ? k : `${k}=${v}`))
      .join(';');
    return sdp.replace(fmtpRe, `a=fmtp:${pt} ${rebuilt}`);
  }

  const line = `a=fmtp:${pt} ${Object.entries(wanted)
    .map(([k, v]) => `${k}=${v}`)
    .join(';')}`;
  return sdp.replace(new RegExp(`(a=rtpmap:${pt} opus/48000/2[^\\r\\n]*)`, 'i'), `$1${nl}${line}`);
}

// ------------------------------------------------------------
// Sender tuning: bitrate caps, priorities, what to sacrifice first
// ------------------------------------------------------------
export async function tuneSenders(pc, { profile = 'high', screenSharing = false } = {}) {
  if (!pc || pc.connectionState === 'closed') return;
  const v = VIDEO_PROFILES[profile] || VIDEO_PROFILES.high;
  for (const sender of pc.getSenders()) {
    if (!sender.track) continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      const enc = params.encodings[0];
      if (sender.track.kind === 'audio') {
        enc.maxBitrate = AUDIO_MAX_BITRATE;
        enc.priority = 'high';
        enc.networkPriority = 'high';
      } else {
        enc.maxBitrate = screenSharing ? Math.max(v.maxBitrate, 1_500_000) : v.maxBitrate;
        enc.maxFramerate = screenSharing ? 15 : v.frameRate;
        params.degradationPreference = screenSharing ? 'maintain-resolution' : 'maintain-framerate';
      }
      await sender.setParameters(params);
    } catch {
      // Some browsers reject optional fields; the call still works untuned.
    }
  }
}

// ------------------------------------------------------------
// Connection quality
// ------------------------------------------------------------
// Turns two consecutive getStats() reports into simple numbers.
export function summarizeStats(report, prev = {}) {
  let rtt = null;
  let jitter = null;
  let bytesIn = 0;
  let lost = 0;
  let received = 0;
  let bytesOut = 0;
  let limitation = 'none';

  report.forEach((s) => {
    if (s.type === 'candidate-pair' && (s.nominated || s.selected) && s.state === 'succeeded') {
      if (typeof s.currentRoundTripTime === 'number') rtt = s.currentRoundTripTime * 1000;
    }
    if (s.type === 'inbound-rtp' && !s.isRemote) {
      bytesIn += s.bytesReceived || 0;
      lost += s.packetsLost || 0;
      received += s.packetsReceived || 0;
      if (typeof s.jitter === 'number') jitter = Math.max(jitter ?? 0, s.jitter * 1000);
    }
    if (s.type === 'outbound-rtp' && !s.isRemote) {
      bytesOut += s.bytesSent || 0;
      if (s.kind === 'video' && s.qualityLimitationReason && s.qualityLimitationReason !== 'none') {
        limitation = s.qualityLimitationReason;
      }
    }
  });

  const dLost = Math.max(0, lost - (prev.lost || 0));
  const dReceived = Math.max(0, received - (prev.received || 0));
  const lossPct = dLost + dReceived > 0 ? (dLost / (dLost + dReceived)) * 100 : null;
  const dt = prev.t ? (Date.now() - prev.t) / 1000 : 0;
  const downKbps = dt > 0 ? Math.round(((bytesIn - (prev.bytesIn || 0)) * 8) / dt / 1000) : null;
  const upKbps = dt > 0 ? Math.round(((bytesOut - (prev.bytesOut || 0)) * 8) / dt / 1000) : null;

  return {
    rttMs: rtt === null ? null : Math.round(rtt),
    jitterMs: jitter === null ? null : Math.round(jitter),
    lossPct: lossPct === null ? null : Math.round(lossPct * 10) / 10,
    downKbps,
    upKbps,
    limitation,
    raw: { lost, received, bytesIn, bytesOut, t: Date.now() },
  };
}

export function evaluateQuality({ rttMs = null, lossPct = null, jitterMs = null } = {}) {
  if ((rttMs ?? 0) > 450 || (lossPct ?? 0) > 10 || (jitterMs ?? 0) > 90) return 'poor';
  if ((rttMs ?? 0) > 220 || (lossPct ?? 0) > 3 || (jitterMs ?? 0) > 40) return 'fair';
  return 'good';
}

// Adds hysteresis so the indicator (and automatic video pausing) doesn't
// flap on a single bad sample.
export function createQualityTracker({ pauseAfter = 2, resumeAfter = 4 } = {}) {
  let level = 'good';
  let badStreak = 0;
  let goodStreak = 0;
  let paused = false;

  return {
    push(sampleLevel) {
      if (sampleLevel === 'poor') {
        badStreak += 1;
        goodStreak = 0;
      } else if (sampleLevel === 'good') {
        goodStreak += 1;
        badStreak = 0;
      } else {
        badStreak = 0;
        goodStreak = 0;
      }

      let action = null;
      if (sampleLevel === 'poor' && badStreak >= pauseAfter) {
        level = 'poor';
        if (!paused) {
          paused = true;
          action = 'pause-video';
        }
      } else if (paused && goodStreak >= resumeAfter) {
        level = 'good';
        paused = false;
        action = 'resume-video';
      } else if (!paused) {
        level = sampleLevel === 'poor' ? 'fair' : sampleLevel;
      }
      return { level, action };
    },
    get paused() {
      return paused;
    },
    reset() {
      level = 'good';
      badStreak = 0;
      goodStreak = 0;
      paused = false;
    },
  };
}

// Polls getStats() and reports each sample. Returns a stop function.
export function createQualityMonitor(pc, onSample, intervalMs = 2000) {
  let prev = {};
  let stopped = false;
  const tick = async () => {
    if (stopped || !pc || pc.connectionState === 'closed') return;
    try {
      const report = await pc.getStats();
      const summary = summarizeStats(report, prev);
      prev = summary.raw;
      onSample({ ...summary, level: evaluateQuality(summary) });
    } catch {
      // stats unavailable — skip this tick
    }
  };
  const id = setInterval(tick, intervalMs);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}

// ------------------------------------------------------------
// ICE restart (renegotiation with new connectivity checks)
// ------------------------------------------------------------
export async function createRestartOffer(pc) {
  const offer = await pc.createOffer({ iceRestart: true });
  offer.sdp = tuneOpusSdp(offer.sdp);
  await pc.setLocalDescription(offer);
  return pc.localDescription;
}

export async function applyRestartOffer(pc, offer) {
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  answer.sdp = tuneOpusSdp(answer.sdp);
  await pc.setLocalDescription(answer);
  return pc.localDescription;
}

// ------------------------------------------------------------
// Swap a live track (camera flip / device change) without renegotiating
// ------------------------------------------------------------
export async function replaceTrackOnPeer(pc, newTrack) {
  const sender = pc.getSenders().find((s) => s.track && s.track.kind === newTrack.kind);
  if (!sender) return null;
  const old = sender.track;
  await sender.replaceTrack(newTrack);
  return old;
}
