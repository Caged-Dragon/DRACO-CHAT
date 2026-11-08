import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from './AuthContext.jsx';
import {
  acquireMedia,
  applyRestartOffer,
  buildRtcConfig,
  createQualityMonitor,
  createQualityTracker,
  createRestartOffer,
  describeMediaError,
  getAudioConstraints,
  getNetworkProfile,
  getVideoConstraints,
  listDevices,
  replaceTrackOnPeer,
  tuneOpusSdp,
  tuneSenders,
} from '../utils/rtc.js';
import { playBeep, startRingback, startRingtone, stopRinging } from '../utils/ringer.js';
import { useWakeLock } from '../hooks/useWakeLock.js';

const CallContext = createContext(null);

const RING_TIMEOUT_MS = 30000; // caller gives up if nobody answers
const INCOMING_DISMISS_MS = 40000; // callee safety net if the "cancel" signal is lost
const CONNECT_TIMEOUT_MS = 25000; // answered, but media never connected
const DISCONNECT_GRACE_MS = 2500; // wait this long before trying to recover a dropped link
const RESTART_RETRY_MS = 8000; // wait this long for a restart to work before trying again
const MAX_RESTARTS = 3;

const NO_REMOTE_MEDIA = { muted: false, cameraOff: false, networkPaused: false };

export function CallProvider({ children }) {
  const { user, profile } = useAuth();

  const [incomingCall, setIncomingCall] = useState(null); // {callId, callerId, callerName, type, offer}
  // idle | calling | connecting | connected | reconnecting
  const [callState, setCallState] = useState('idle');
  const [callType, setCallType] = useState(null); // 'audio' | 'video'
  const [remoteName, setRemoteName] = useState('');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState(null); // {level, rttMs, lossPct, jitterMs, downKbps, upKbps}
  const [videoPausedByNetwork, setVideoPausedByNetwork] = useState(false);
  const [remoteMedia, setRemoteMedia] = useState(NO_REMOTE_MEDIA);
  const [devices, setDevices] = useState({ mics: [], cams: [], speakers: [] });
  const [selectedDevices, setSelectedDevices] = useState({ mic: '', cam: '', speaker: '' });

  const pcRef = useRef(null);
  const callChannelRef = useRef(null);
  const callIdRef = useRef(null);
  const callStateRef = useRef('idle');
  const incomingRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const localStreamRef = useRef(null);
  const cameraTrackRef = useRef(null);
  const isCallerRef = useRef(false);
  const callTypeRef = useRef(null);
  const profileRef = useRef('high');
  const facingRef = useRef('user');

  // mirrors of UI state that timers / event handlers need to read
  const mutedRef = useRef(false);
  const cameraOffRef = useRef(false);
  const screenSharingRef = useRef(false);
  const networkPausedRef = useRef(false);

  const ringTimeoutRef = useRef(null);
  const connectTimerRef = useRef(null);
  const graceTimerRef = useRef(null);
  const restartTimerRef = useRef(null);
  const restartCountRef = useRef(0);
  const qualityStopRef = useRef(null);
  const qualityTrackerRef = useRef(null);

  // For call-history logging
  const callerIdRef = useRef(null);
  const calleeIdRef = useRef(null);
  const callTypeForLogRef = useRef(null);
  const connectedAtRef = useRef(null);
  const statusRef = useRef('missed'); // 'completed' | 'missed' | 'declined'

  function updateCallState(next) {
    callStateRef.current = next;
    setCallState(next);
  }

  // Keep the screen awake for the whole call
  useWakeLock(callState !== 'idle');

  // ------------------------------------------------------------
  // Sounds: ringtone for incoming, ringback while calling
  // ------------------------------------------------------------
  useEffect(() => {
    if (incomingCall) {
      startRingtone();
      return () => stopRinging();
    }
    if (callState === 'calling') {
      startRingback();
      return () => stopRinging();
    }
    return undefined;
  }, [incomingCall, callState]);

  // System notification when a call arrives while the tab is in the background
  useEffect(() => {
    if (!incomingCall) return undefined;
    if (
      typeof document === 'undefined' ||
      !document.hidden ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) {
      return undefined;
    }
    let n;
    try {
      n = new Notification(`${incomingCall.callerName} is calling`, {
        body: incomingCall.type === 'video' ? 'Incoming video call' : 'Incoming voice call',
        tag: 'dragon-call',
        requireInteraction: true,
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // some browsers only allow notifications from a service worker
    }
    return () => n?.close();
  }, [incomingCall]);

  // If the caller's "cancel" signal never arrives, don't ring forever
  useEffect(() => {
    if (!incomingCall) return undefined;
    const id = setTimeout(() => setIncomingCall(null), INCOMING_DISMISS_MS);
    return () => clearTimeout(id);
  }, [incomingCall]);

  // Errors are shown briefly, then cleared
  useEffect(() => {
    if (!error) return undefined;
    const id = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(id);
  }, [error]);

  // ------------------------------------------------------------
  // Always-on personal channel: this is how a call "rings" — the
  // caller broadcasts here, and only someone actively subscribed
  // (i.e. logged in with the app open) will receive it.
  // ------------------------------------------------------------
  useEffect(() => {
    if (!user) return undefined;
    const channel = supabase.channel(`signal-${user.id}`);
    channel
      .on('broadcast', { event: 'incoming-call' }, ({ payload }) => {
        // Already on a call (or already ringing)? Tell the caller we're busy.
        if (callStateRef.current !== 'idle' || incomingRef.current) {
          if (incomingRef.current?.callId === payload.callId) return;
          replyBusy(payload.callId);
          return;
        }
        incomingRef.current = payload;
        setIncomingCall(payload);
      })
      .on('broadcast', { event: 'cancel-call' }, ({ payload }) => {
        if (incomingRef.current?.callId === payload.callId) incomingRef.current = null;
        setIncomingCall((cur) => (cur && cur.callId === payload.callId ? null : cur));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  function replyBusy(callId) {
    const ch = supabase.channel(`call-${callId}`);
    ch.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      ch.send({ type: 'broadcast', event: 'busy', payload: {} });
      setTimeout(() => supabase.removeChannel(ch), 500);
    });
  }

  function sendSignal(event, payload = {}) {
    callChannelRef.current?.send({ type: 'broadcast', event, payload });
  }

  function sendMediaState() {
    sendSignal('media-state', {
      muted: mutedRef.current,
      cameraOff: cameraOffRef.current,
      networkPaused: networkPausedRef.current,
    });
  }

  async function logCallHistory() {
    if (!callerIdRef.current || !calleeIdRef.current) return;
    const duration = connectedAtRef.current
      ? Math.round((Date.now() - connectedAtRef.current) / 1000)
      : 0;

    await supabase.from('chat_calls').insert({
      caller_id: callerIdRef.current,
      callee_id: calleeIdRef.current,
      call_type: callTypeForLogRef.current || 'audio',
      status: statusRef.current,
      duration_seconds: duration,
    });

    callerIdRef.current = null;
    calleeIdRef.current = null;
    callTypeForLogRef.current = null;
    connectedAtRef.current = null;
    statusRef.current = 'missed';
  }

  function clearTimers() {
    [ringTimeoutRef, connectTimerRef, graceTimerRef, restartTimerRef].forEach((ref) => {
      if (ref.current) clearTimeout(ref.current);
      ref.current = null;
    });
  }

  function cleanupCall() {
    logCallHistory();
    clearTimers();

    if (qualityStopRef.current) qualityStopRef.current();
    qualityStopRef.current = null;
    qualityTrackerRef.current = null;

    if (pcRef.current) {
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (callChannelRef.current) {
      supabase.removeChannel(callChannelRef.current);
      callChannelRef.current = null;
    }
    pendingCandidatesRef.current = [];
    callIdRef.current = null;
    cameraTrackRef.current = null;
    isCallerRef.current = false;
    callTypeRef.current = null;
    restartCountRef.current = 0;
    mutedRef.current = false;
    cameraOffRef.current = false;
    screenSharingRef.current = false;
    networkPausedRef.current = false;
    facingRef.current = 'user';

    setLocalStream(null);
    setRemoteStream(null);
    setCallType(null);
    setRemoteName('');
    setMuted(false);
    setCameraOff(false);
    setScreenSharing(false);
    setQuality(null);
    setVideoPausedByNetwork(false);
    setRemoteMedia(NO_REMOTE_MEDIA);
    updateCallState('idle');
  }

  // End the call locally. `notify` also tells the other person (used when WE
  // give up, e.g. the connection was lost) so they aren't left in a dead call.
  function endWith(message, { notify = false } = {}) {
    if (notify) sendSignal('end');
    if (message) setError(message);
    playBeep('ended');
    cleanupCall();
  }

  // ------------------------------------------------------------
  // Network quality: indicator + automatic video pause on a bad link
  // ------------------------------------------------------------
  function pauseVideoForNetwork() {
    if (callTypeRef.current !== 'video' || screenSharingRef.current || cameraOffRef.current) return;
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = false));
    networkPausedRef.current = true;
    setVideoPausedByNetwork(true);
    sendMediaState();
  }

  function resumeVideoAfterNetwork() {
    if (!networkPausedRef.current) return;
    networkPausedRef.current = false;
    setVideoPausedByNetwork(false);
    if (!cameraOffRef.current) {
      localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = true));
    }
    sendMediaState();
  }

  function startQualityMonitoring(pc) {
    if (qualityStopRef.current) return;
    qualityTrackerRef.current = createQualityTracker();
    qualityStopRef.current = createQualityMonitor(pc, (sample) => {
      const tracker = qualityTrackerRef.current;
      if (!tracker) return;
      const { level, action } = tracker.push(sample.level);
      setQuality({
        level,
        rttMs: sample.rttMs,
        lossPct: sample.lossPct,
        jitterMs: sample.jitterMs,
        downKbps: sample.downKbps,
        upKbps: sample.upKbps,
      });
      if (action === 'pause-video') pauseVideoForNetwork();
      else if (action === 'resume-video') resumeVideoAfterNetwork();
    });
  }

  // ------------------------------------------------------------
  // Recovering from a dropped connection (ICE restart)
  // ------------------------------------------------------------
  async function attemptRestart() {
    const pc = pcRef.current;
    if (!pc || callStateRef.current === 'idle') return;

    if (restartCountRef.current >= MAX_RESTARTS) {
      endWith('Connection lost. Please try calling again.', { notify: true });
      return;
    }
    restartCountRef.current += 1;

    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = setTimeout(() => {
      if (pcRef.current === pc && pc.connectionState !== 'connected') attemptRestart();
    }, RESTART_RETRY_MS);

    try {
      if (isCallerRef.current) {
        // The caller owns renegotiation so both sides never offer at once
        const offer = await createRestartOffer(pc);
        sendSignal('restart-offer', { offer });
      } else {
        sendSignal('restart-request');
      }
    } catch {
      // the retry timer will try again
    }
  }

  function handleConnectionState(pc) {
    if (pcRef.current !== pc) return;
    const state = pc.connectionState;

    if (state === 'connected') {
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
      graceTimerRef.current = restartTimerRef.current = connectTimerRef.current = null;
      restartCountRef.current = 0;

      if (!connectedAtRef.current) {
        connectedAtRef.current = Date.now();
        playBeep('connected');
      }
      statusRef.current = 'completed';
      updateCallState('connected');
      startQualityMonitoring(pc);
      tuneSenders(pc, { profile: profileRef.current, screenSharing: screenSharingRef.current });
      sendMediaState();
    } else if (state === 'disconnected') {
      if (connectedAtRef.current) updateCallState('reconnecting');
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
      graceTimerRef.current = setTimeout(() => {
        if (pcRef.current === pc && pc.connectionState !== 'connected') attemptRestart();
      }, DISCONNECT_GRACE_MS);
    } else if (state === 'failed') {
      if (connectedAtRef.current) updateCallState('reconnecting');
      attemptRestart();
    }
  }

  // The browser tells us when the device goes offline / comes back
  useEffect(() => {
    const onOffline = () => {
      if (callStateRef.current === 'connected') updateCallState('reconnecting');
    };
    const onOnline = () => {
      const pc = pcRef.current;
      if (pc && callStateRef.current !== 'idle' && pc.connectionState !== 'connected') {
        restartCountRef.current = 0;
        attemptRestart();
      }
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // Manual "Try again" from the call screen
  function reconnect() {
    restartCountRef.current = 0;
    attemptRestart();
  }

  // ------------------------------------------------------------
  // Peer connection + signalling handlers shared by caller and callee
  // ------------------------------------------------------------
  function createPeerConnection(onIceCandidate) {
    const pc = new RTCPeerConnection(buildRtcConfig());
    pc.onicecandidate = (e) => {
      if (e.candidate) onIceCandidate(e.candidate);
    };
    pc.ontrack = (e) => {
      setRemoteStream((prev) => {
        if (e.streams && e.streams[0]) return e.streams[0];
        const stream = prev || new MediaStream();
        stream.addTrack(e.track);
        return stream;
      });
    };
    pc.onconnectionstatechange = () => handleConnectionState(pc);
    return pc;
  }

  async function addRemoteCandidate(pc, raw) {
    try {
      const candidate = new RTCIceCandidate(raw);
      if (pc.remoteDescription) await pc.addIceCandidate(candidate);
      else pendingCandidatesRef.current.push(candidate);
    } catch {
      // stale candidates from before a restart can be rejected — harmless
    }
  }

  async function flushPendingCandidates(pc) {
    for (const c of pendingCandidatesRef.current) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        // ignore
      }
    }
    pendingCandidatesRef.current = [];
  }

  function onRemoteMediaState(payload) {
    setRemoteMedia({
      muted: !!payload?.muted,
      cameraOff: !!payload?.cameraOff,
      networkPaused: !!payload?.networkPaused,
    });
  }

  function armConnectTimeout() {
    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    connectTimerRef.current = setTimeout(() => {
      if (callStateRef.current !== 'connected' && callStateRef.current !== 'idle') {
        endWith("Couldn't connect the call. Check your internet connection and try again.", { notify: true });
      }
    }, CONNECT_TIMEOUT_MS);
  }

  // ------------------------------------------------------------
  // Starting / answering / declining / ending
  // ------------------------------------------------------------
  const startCall = useCallback(
    async (friend, type) => {
      if (callStateRef.current !== 'idle') return;
      setError('');
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setError("You're offline. Check your internet connection and try again.");
        return;
      }

      profileRef.current = getNetworkProfile();
      let stream;
      try {
        stream = await acquireMedia(type, { profile: profileRef.current, facingMode: facingRef.current });
      } catch (err) {
        setError(describeMediaError(err));
        return;
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setCallType(type);
      callTypeRef.current = type;
      isCallerRef.current = true;
      setRemoteName(friend.username);
      updateCallState('calling');

      callerIdRef.current = user.id;
      calleeIdRef.current = friend.id;
      callTypeForLogRef.current = type;
      statusRef.current = 'missed';

      const callId = crypto.randomUUID();
      callIdRef.current = callId;

      const callChannel = supabase.channel(`call-${callId}`);
      callChannelRef.current = callChannel;

      const pc = createPeerConnection((candidate) => {
        callChannel.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: { from: 'caller', candidate },
        });
      });
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      callChannel
        .on('broadcast', { event: 'answer' }, async ({ payload }) => {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
          await flushPendingCandidates(pc);
          if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
          ringTimeoutRef.current = null;
          updateCallState('connecting'); // connected fires from onconnectionstatechange
          armConnectTimeout();
        })
        .on('broadcast', { event: 'ice-candidate' }, ({ payload }) => {
          if (payload.from === 'callee') addRemoteCandidate(pc, payload.candidate);
        })
        .on('broadcast', { event: 'restart-answer' }, async ({ payload }) => {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
          } catch {
            // the retry timer will try again
          }
        })
        .on('broadcast', { event: 'restart-request' }, () => {
          attemptRestart();
        })
        .on('broadcast', { event: 'media-state' }, ({ payload }) => onRemoteMediaState(payload))
        .on('broadcast', { event: 'reject' }, () => {
          statusRef.current = 'declined';
          endWith(`${friend.username} declined the call.`);
        })
        .on('broadcast', { event: 'busy' }, () => {
          statusRef.current = 'missed';
          endWith(`${friend.username} is on another call.`);
        })
        .on('broadcast', { event: 'end' }, () => {
          endWith('');
        })
        .subscribe(async (status) => {
          if (status !== 'SUBSCRIBED') return;
          const offer = await pc.createOffer();
          offer.sdp = tuneOpusSdp(offer.sdp);
          await pc.setLocalDescription(offer);

          const pingChannel = supabase.channel(`signal-${friend.id}`);
          pingChannel.subscribe((pingStatus) => {
            if (pingStatus !== 'SUBSCRIBED') return;
            pingChannel.send({
              type: 'broadcast',
              event: 'incoming-call',
              payload: {
                callId,
                callerId: user.id,
                callerName: profile?.username || 'Someone',
                type,
                offer: pc.localDescription,
              },
            });
            supabase.removeChannel(pingChannel);
          });

          ringTimeoutRef.current = setTimeout(() => {
            if (callStateRef.current === 'calling') {
              // Clear the ringing popup on the other end too
              const cancelChannel = supabase.channel(`signal-${friend.id}`);
              cancelChannel.subscribe((s) => {
                if (s !== 'SUBSCRIBED') return;
                cancelChannel.send({
                  type: 'broadcast',
                  event: 'cancel-call',
                  payload: { callId },
                });
                supabase.removeChannel(cancelChannel);
              });
              endWith('No answer.');
            }
          }, RING_TIMEOUT_MS);
        });
    },
    [user, profile]
  );

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    const { callId, callerId, callerName, type, offer } = incomingCall;
    incomingRef.current = null;
    setIncomingCall(null);
    setError('');

    profileRef.current = getNetworkProfile();
    let stream;
    try {
      stream = await acquireMedia(type, { profile: profileRef.current, facingMode: facingRef.current });
    } catch (err) {
      setError(describeMediaError(err));
      return;
    }

    localStreamRef.current = stream;
    setLocalStream(stream);
    setCallType(type);
    callTypeRef.current = type;
    isCallerRef.current = false;
    setRemoteName(callerName);
    updateCallState('connecting');
    callIdRef.current = callId;
    armConnectTimeout();

    callerIdRef.current = callerId;
    calleeIdRef.current = user.id;
    callTypeForLogRef.current = type;
    statusRef.current = 'completed';

    const callChannel = supabase.channel(`call-${callId}`);
    callChannelRef.current = callChannel;

    const pc = createPeerConnection((candidate) => {
      callChannel.send({
        type: 'broadcast',
        event: 'ice-candidate',
        payload: { from: 'callee', candidate },
      });
    });
    pcRef.current = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    callChannel
      .on('broadcast', { event: 'ice-candidate' }, ({ payload }) => {
        if (payload.from === 'caller') addRemoteCandidate(pc, payload.candidate);
      })
      .on('broadcast', { event: 'restart-offer' }, async ({ payload }) => {
        try {
          const answer = await applyRestartOffer(pc, new RTCSessionDescription(payload.offer));
          sendSignal('restart-answer', { answer });
        } catch {
          // the caller will retry
        }
      })
      .on('broadcast', { event: 'media-state' }, ({ payload }) => onRemoteMediaState(payload))
      .on('broadcast', { event: 'end' }, () => {
        endWith('');
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingCandidates(pc);
        const answer = await pc.createAnswer();
        answer.sdp = tuneOpusSdp(answer.sdp);
        await pc.setLocalDescription(answer);
        callChannel.send({ type: 'broadcast', event: 'answer', payload: { answer: pc.localDescription } });
      });
  }, [incomingCall, user]);

  const declineCall = useCallback(() => {
    if (!incomingCall) return;
    const { callId, callerId, type } = incomingCall;
    incomingRef.current = null;
    setIncomingCall(null);

    // Log this as a declined call even though we never fully connect
    callerIdRef.current = callerId;
    calleeIdRef.current = user.id;
    callTypeForLogRef.current = type;
    statusRef.current = 'declined';
    logCallHistory();

    const ch = supabase.channel(`call-${callId}`);
    ch.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      ch.send({ type: 'broadcast', event: 'reject', payload: {} });
      setTimeout(() => supabase.removeChannel(ch), 500);
    });
  }, [incomingCall, user]);

  const endCall = useCallback(() => {
    if (callChannelRef.current) {
      callChannelRef.current.send({ type: 'broadcast', event: 'end', payload: {} });
    }
    playBeep('ended');
    cleanupCall();
  }, []);

  // ------------------------------------------------------------
  // In-call controls
  // ------------------------------------------------------------
  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
    sendMediaState();
  }

  function toggleCamera() {
    const next = !cameraOffRef.current;
    cameraOffRef.current = next;
    if (!next && networkPausedRef.current) {
      // the user explicitly turned the camera back on during a poor connection
      networkPausedRef.current = false;
      setVideoPausedByNetwork(false);
      qualityTrackerRef.current?.reset();
    }
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
    setCameraOff(next);
    sendMediaState();
  }

  // Swap the video track on the live connection (no renegotiation needed)
  async function swapVideoTrack(constraints) {
    const pc = pcRef.current;
    if (!pc || callTypeRef.current !== 'video' || screenSharingRef.current) return false;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: constraints });
      const track = s.getVideoTracks()[0];
      track.enabled = !cameraOffRef.current && !networkPausedRef.current;
      const old = await replaceTrackOnPeer(pc, track);
      const local = localStreamRef.current;
      if (old) {
        local?.removeTrack(old);
        old.stop();
      }
      local?.addTrack(track);
      cameraTrackRef.current = track;
      const next = new MediaStream(local.getTracks());
      localStreamRef.current = next;
      setLocalStream(next);
      tuneSenders(pc, { profile: profileRef.current });
      return true;
    } catch {
      setError('Could not switch camera.');
      return false;
    }
  }

  async function switchCamera() {
    const next = facingRef.current === 'user' ? 'environment' : 'user';
    const ok = await swapVideoTrack(getVideoConstraints(profileRef.current, { facingMode: next }));
    if (ok) {
      facingRef.current = next;
      setSelectedDevices((d) => ({ ...d, cam: '' }));
    }
  }

  async function selectCamera(deviceId) {
    const ok = await swapVideoTrack(getVideoConstraints(profileRef.current, { deviceId }));
    if (ok) setSelectedDevices((d) => ({ ...d, cam: deviceId }));
  }

  async function selectMicrophone(deviceId) {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints(deviceId) });
      const track = s.getAudioTracks()[0];
      track.enabled = !mutedRef.current;
      const old = await replaceTrackOnPeer(pc, track);
      const local = localStreamRef.current;
      if (old) {
        local?.removeTrack(old);
        old.stop();
      }
      local?.addTrack(track);
      const next = new MediaStream(local.getTracks());
      localStreamRef.current = next;
      setLocalStream(next);
      setSelectedDevices((d) => ({ ...d, mic: deviceId }));
    } catch {
      setError('Could not switch microphone.');
    }
  }

  function selectSpeaker(deviceId) {
    setSelectedDevices((d) => ({ ...d, speaker: deviceId }));
  }

  async function toggleScreenShare() {
    const pc = pcRef.current;
    if (!pc) return;

    const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');

    if (screenSharingRef.current) {
      if (sender && cameraTrackRef.current) await sender.replaceTrack(cameraTrackRef.current);
      screenSharingRef.current = false;
      setScreenSharing(false);
      tuneSenders(pc, { profile: profileRef.current, screenSharing: false });
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
      });
      const screenTrack = screenStream.getVideoTracks()[0];
      // text and slides stay sharp instead of being blurred to keep motion smooth
      if ('contentHint' in screenTrack) screenTrack.contentHint = 'detail';
      if (sender) {
        cameraTrackRef.current = sender.track;
        await sender.replaceTrack(screenTrack);
      }
      screenTrack.onended = () => {
        if (screenSharingRef.current) toggleScreenShare();
      };
      screenSharingRef.current = true;
      setScreenSharing(true);
      tuneSenders(pc, { profile: profileRef.current, screenSharing: true });
    } catch {
      setError('Could not start screen sharing.');
    }
  }

  // Device lists (labels are only available once permission was granted)
  useEffect(() => {
    if (callState === 'idle') return undefined;
    const refresh = () => listDevices().then(setDevices);
    refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
  }, [callState === 'idle']);

  return (
    <CallContext.Provider
      value={{
        incomingCall,
        callState,
        callType,
        remoteName,
        localStream,
        remoteStream,
        muted,
        cameraOff,
        screenSharing,
        error,
        quality,
        videoPausedByNetwork,
        remoteMedia,
        devices,
        selectedDevices,
        canFlipCamera: devices.cams.length > 1,
        startCall,
        acceptCall,
        declineCall,
        endCall,
        reconnect,
        toggleMute,
        toggleCamera,
        toggleScreenShare,
        switchCamera,
        selectCamera,
        selectMicrophone,
        selectSpeaker,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  return useContext(CallContext);
}
