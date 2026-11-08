import { describe, it, expect, vi } from 'vitest';
import {
  buildIceServers,
  buildRtcConfig,
  createQualityTracker,
  describeMediaError,
  evaluateQuality,
  getAudioConstraints,
  getNetworkProfile,
  getVideoConstraints,
  groupProfileFor,
  summarizeStats,
  tuneOpusSdp,
  VIDEO_PROFILES,
} from './rtc.js';

const SDP_NO_FMTP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  'a=rtpmap:111 opus/48000/2',
  'a=rtcp-fb:111 transport-cc',
  'a=rtpmap:63 red/48000/2',
  '',
].join('\r\n');

const SDP_WITH_FMTP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1;stereo=1',
  '',
].join('\r\n');

describe('buildIceServers', () => {
  it('always includes public STUN', () => {
    const s = buildIceServers({});
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(s)).toContain('stun:');
    expect(s.some((x) => x.username)).toBe(false);
  });

  it('adds one TURN entry with every comma-separated URL', () => {
    const s = buildIceServers({
      VITE_TURN_URL: 'turn:t.example.com:3478?transport=udp, turns:t.example.com:443?transport=tcp ,',
      VITE_TURN_USERNAME: 'u',
      VITE_TURN_CREDENTIAL: 'p',
    });
    const turn = s.find((x) => x.username === 'u');
    expect(turn.urls).toEqual(['turn:t.example.com:3478?transport=udp', 'turns:t.example.com:443?transport=tcp']);
    expect(turn.credential).toBe('p');
  });

  it('builds a config that pre-gathers candidates and bundles media', () => {
    const c = buildRtcConfig({});
    expect(c.iceCandidatePoolSize).toBeGreaterThan(0);
    expect(c.bundlePolicy).toBe('max-bundle');
  });
});

describe('network profile', () => {
  it('defaults to high when the API is missing', () => {
    expect(getNetworkProfile({})).toBe('high');
  });
  it('goes low on data saver and slow networks', () => {
    expect(getNetworkProfile({ connection: { saveData: true } })).toBe('low');
    expect(getNetworkProfile({ connection: { effectiveType: '3g' } })).toBe('low');
  });
  it('is careful on cellular, generous on wifi', () => {
    expect(getNetworkProfile({ connection: { type: 'cellular', effectiveType: '4g' } })).toBe('medium');
    expect(getNetworkProfile({ connection: { type: 'wifi', effectiveType: '4g' } })).toBe('high');
  });
  it('lowers group video as the room fills up', () => {
    expect(groupProfileFor(2, 'high')).toBe('high');
    expect(groupProfileFor(3, 'high')).toBe('medium');
    expect(groupProfileFor(3, 'medium')).toBe('low');
    expect(groupProfileFor(5, 'high')).toBe('low');
  });
});

describe('media constraints', () => {
  it('turns on echo cancellation, noise suppression and auto gain', () => {
    const a = getAudioConstraints();
    expect(a.echoCancellation).toBe(true);
    expect(a.noiseSuppression).toBe(true);
    expect(a.autoGainControl).toBe(true);
  });
  it('pins a chosen microphone', () => {
    expect(getAudioConstraints('abc').deviceId).toEqual({ exact: 'abc' });
  });
  it('uses the profile resolution and caps the frame rate', () => {
    const v = getVideoConstraints('low');
    expect(v.width.ideal).toBe(VIDEO_PROFILES.low.width);
    expect(v.frameRate.max).toBe(VIDEO_PROFILES.low.frameRate);
    expect(v.facingMode).toEqual({ ideal: 'user' });
  });
  it('prefers an explicit camera over facingMode', () => {
    const v = getVideoConstraints('high', { deviceId: 'cam1', facingMode: 'environment' });
    expect(v.deviceId).toEqual({ exact: 'cam1' });
    expect(v.facingMode).toBeUndefined();
  });
  it('explains permission and busy-device errors in plain words', () => {
    expect(describeMediaError({ name: 'NotAllowedError' })).toMatch(/permission/i);
    expect(describeMediaError({ name: 'NotFoundError' })).toMatch(/no microphone/i);
    expect(describeMediaError({ name: 'NotReadableError' })).toMatch(/another app/i);
    expect(describeMediaError(new Error('x'))).toMatch(/could not access/i);
  });
});

describe('tuneOpusSdp', () => {
  it('adds an fmtp line when there is none', () => {
    const out = tuneOpusSdp(SDP_NO_FMTP);
    expect(out).toContain('a=fmtp:111 useinbandfec=1;usedtx=1;stereo=0');
    expect(out).toContain('maxaveragebitrate=32000');
    // the new line sits right after the opus rtpmap and keeps CRLF endings
    expect(out).toMatch(/a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 /);
    // the unrelated "red" codec is untouched
    expect(out).toContain('a=rtpmap:63 red/48000/2');
  });

  it('merges into an existing fmtp line and overrides conflicting values', () => {
    const out = tuneOpusSdp(SDP_WITH_FMTP);
    const line = out.split('\r\n').find((l) => l.startsWith('a=fmtp:111'));
    expect(line).toContain('useinbandfec=1');
    expect(line).toContain('usedtx=1');
    expect(line).toContain('stereo=0');
    expect(line).not.toContain('stereo=1');
    expect(line.match(/minptime/g)).toHaveLength(1);
  });

  it('is idempotent', () => {
    const once = tuneOpusSdp(SDP_NO_FMTP);
    expect(tuneOpusSdp(once)).toBe(once);
  });

  it('leaves SDP without opus alone', () => {
    const sdp = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n';
    expect(tuneOpusSdp(sdp)).toBe(sdp);
    expect(tuneOpusSdp('')).toBe('');
  });
});

describe('quality evaluation', () => {
  it('grades good, fair and poor', () => {
    expect(evaluateQuality({ rttMs: 60, lossPct: 0, jitterMs: 5 })).toBe('good');
    expect(evaluateQuality({ rttMs: 300, lossPct: 0, jitterMs: 5 })).toBe('fair');
    expect(evaluateQuality({ rttMs: 60, lossPct: 5, jitterMs: 5 })).toBe('fair');
    expect(evaluateQuality({ rttMs: 600, lossPct: 0, jitterMs: 5 })).toBe('poor');
    expect(evaluateQuality({ rttMs: 60, lossPct: 15, jitterMs: 5 })).toBe('poor');
    expect(evaluateQuality({ rttMs: 60, lossPct: 0, jitterMs: 120 })).toBe('poor');
  });
  it('treats missing numbers as unknown, not bad', () => {
    expect(evaluateQuality({})).toBe('good');
  });
});

describe('summarizeStats', () => {
  const report = (extra = {}) =>
    new Map(
      Object.entries({
        pair: { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.12 },
        inA: { type: 'inbound-rtp', kind: 'audio', bytesReceived: 5000, packetsLost: 4, packetsReceived: 96, jitter: 0.02 },
        outV: { type: 'outbound-rtp', kind: 'video', bytesSent: 9000, qualityLimitationReason: 'bandwidth' },
        ...extra,
      })
    );

  it('reads delay, jitter and the quality limit', () => {
    const s = summarizeStats(report());
    expect(s.rttMs).toBe(120);
    expect(s.jitterMs).toBe(20);
    expect(s.limitation).toBe('bandwidth');
  });

  it('computes loss and bitrate from the change since the last sample', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const prev = { lost: 0, received: 0, bytesIn: 0, bytesOut: 0, t: 8_000 };
    const s = summarizeStats(report(), prev);
    expect(s.lossPct).toBe(4);
    expect(s.downKbps).toBe(20); // 5000 bytes * 8 / 2s / 1000
    vi.useRealTimers();
  });
});

describe('quality tracker (hysteresis)', () => {
  it('does not pause video on a single bad sample', () => {
    const t = createQualityTracker();
    expect(t.push('poor').action).toBeNull();
    expect(t.push('good').action).toBeNull();
  });

  it('pauses after two bad samples in a row, then resumes after four good ones', () => {
    const t = createQualityTracker();
    t.push('poor');
    const pause = t.push('poor');
    expect(pause.action).toBe('pause-video');
    expect(pause.level).toBe('poor');
    expect(t.push('poor').action).toBeNull(); // already paused, no repeat

    t.push('good');
    t.push('good');
    t.push('good');
    const resume = t.push('good');
    expect(resume.action).toBe('resume-video');
    expect(resume.level).toBe('good');
  });

  it('a fair sample while paused does not resume', () => {
    const t = createQualityTracker();
    t.push('poor');
    t.push('poor');
    for (let i = 0; i < 6; i++) expect(t.push('fair').action).toBeNull();
    expect(t.paused).toBe(true);
  });

  it('reset clears the paused state', () => {
    const t = createQualityTracker();
    t.push('poor');
    t.push('poor');
    t.reset();
    expect(t.paused).toBe(false);
  });
});
