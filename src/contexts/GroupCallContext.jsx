import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from './AuthContext.jsx';
import {
  acquireMedia,
  buildRtcConfig,
  describeMediaError,
  getNetworkProfile,
  getVideoConstraints,
  groupProfileFor,
  tuneOpusSdp,
  tuneSenders,
} from '../utils/rtc.js';
import { useWakeLock } from '../hooks/useWakeLock.js';

const GroupCallContext = createContext(null);

// This is a full-mesh call: every participant connects directly to
// every other participant. That's simple and needs no media server, but
// upload bandwidth/CPU grows with each person, so the room is capped and
// video quality is lowered automatically as it fills up. For bigger rooms
// you would move to a media server (SFU) such as LiveKit.
export const MAX_GROUP_CALL_PARTICIPANTS = 6;

const DISCONNECT_GRACE_MS = 4000;
const STUCK_CONNECT_MS = 20000; // a link still not connected after this long is rebuilt
const MAX_RECOVERIES = 3;

export function GroupCallProvider({ children }) {
  const { user, profile } = useAuth();

  const [activeCall, setActiveCall] = useState(null); // {groupId, groupName, type}
  // { [userId]: { stream, username, state: 'connecting'|'connected'|'reconnecting' } }
  const [participants, setParticipants] = useState({});
  const [peerMedia, setPeerMedia] = useState({}); // { [userId]: { muted, cameraOff } }
  const [localStream, setLocalStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [error, setError] = useState('');

  const channelRef = useRef(null);
  const pcsRef = useRef(new Map()); // userId -> RTCPeerConnection
  const pendingCandidatesRef = useRef(new Map()); // userId -> RTCIceCandidate[]
  const localStreamRef = useRef(null);
  const namesRef = useRef({});
  const graceTimersRef = useRef(new Map());
  const stuckTimersRef = useRef(new Map());
  const recoveriesRef = useRef(new Map()); // userId -> count
  const profileRef = useRef('medium');
  const mutedRef = useRef(false);
  const cameraOffRef = useRef(false);
  const activeTypeRef = useRef(null);

  useWakeLock(!!activeCall);

  // Errors are shown briefly, then cleared
  useEffect(() => {
    if (!error) return undefined;
    const id = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(id);
  }, [error]);

  function setPeerState(peerId, patch) {
    setParticipants((prev) => {
      const cur = prev[peerId] || { stream: null, username: namesRef.current[peerId] || 'Someone', state: 'connecting' };
      return { ...prev, [peerId]: { ...cur, ...patch } };
    });
  }

  function sendTo(event, to, payload = {}) {
    channelRef.current?.send({ type: 'broadcast', event, payload: { from: user.id, to, ...payload } });
  }

  function broadcastMediaState() {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'media-state',
      payload: { from: user.id, muted: mutedRef.current, cameraOff: cameraOffRef.current },
    });
  }

  // keepCandidates: when replacing a connection because a fresh offer arrived, the
  // ICE candidates that already reached us for it must NOT be thrown away.
  function closePeer(peerId, { keepCandidates = false } = {}) {
    const pc = pcsRef.current.get(peerId);
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.close();
    }
    pcsRef.current.delete(peerId);
    if (!keepCandidates) pendingCandidatesRef.current.delete(peerId);
    [graceTimersRef, stuckTimersRef].forEach((ref) => {
      const t = ref.current.get(peerId);
      if (t) clearTimeout(t);
      ref.current.delete(peerId);
    });
  }

  // Lower the video quality as more people join
  function applyRoomQuality() {
    const count = pcsRef.current.size + 1;
    const next = groupProfileFor(count, getNetworkProfile());
    if (next !== profileRef.current) {
      profileRef.current = next;
      localStreamRef.current?.getVideoTracks().forEach((t) => {
        t.applyConstraints(getVideoConstraints(next)).catch(() => {});
      });
    }
    pcsRef.current.forEach((pc) => tuneSenders(pc, { profile: profileRef.current }));
  }

  function getOrCreatePeer(peerId) {
    const existing = pcsRef.current.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection(buildRtcConfig());
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      sendTo('ice-candidate', peerId, { candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      setPeerState(peerId, { stream, username: namesRef.current[peerId] || 'Someone' });
    };
    pc.onconnectionstatechange = () => {
      if (pcsRef.current.get(peerId) !== pc) return;
      const s = pc.connectionState;
      if (s === 'connected') {
        [graceTimersRef, stuckTimersRef].forEach((ref) => {
          const t = ref.current.get(peerId);
          if (t) clearTimeout(t);
          ref.current.delete(peerId);
        });
        recoveriesRef.current.set(peerId, 0);
        setPeerState(peerId, { state: 'connected' });
        applyRoomQuality();
        broadcastMediaState(); // tell the newcomer if we're muted
      } else if (s === 'disconnected') {
        setPeerState(peerId, { state: 'reconnecting' });
        const t = setTimeout(() => {
          if (pcsRef.current.get(peerId) === pc && pc.connectionState !== 'connected') recoverPeer(peerId);
        }, DISCONNECT_GRACE_MS);
        graceTimersRef.current.set(peerId, t);
      } else if (s === 'failed') {
        setPeerState(peerId, { state: 'reconnecting' });
        recoverPeer(peerId);
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current));
    }
    pcsRef.current.set(peerId, pc);

    // Safety net: if this link never reaches "connected", rebuild it
    const stuck = setTimeout(() => {
      if (pcsRef.current.get(peerId) === pc && pc.connectionState !== 'connected') recoverPeer(peerId);
    }, STUCK_CONNECT_MS);
    stuckTimersRef.current.set(peerId, stuck);
    return pc;
  }

  async function flushPending(peerId, pc) {
    const list = pendingCandidatesRef.current.get(peerId) || [];
    for (const c of list) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        // stale candidate — ignore
      }
    }
    pendingCandidatesRef.current.set(peerId, []);
  }

  async function connectToPeer(peerId) {
    const pc = getOrCreatePeer(peerId);
    const offer = await pc.createOffer();
    offer.sdp = tuneOpusSdp(offer.sdp);
    await pc.setLocalDescription(offer);
    sendTo('offer', peerId, { sdp: pc.localDescription });
  }

  // A link failed: rebuild it. The person with the smaller id always
  // offers; the other side asks them to.
  async function recoverPeer(peerId) {
    if (!channelRef.current) return;
    const attempts = (recoveriesRef.current.get(peerId) || 0) + 1;
    recoveriesRef.current.set(peerId, attempts);
    if (attempts > MAX_RECOVERIES) {
      closePeer(peerId);
      setParticipants((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      return;
    }
    closePeer(peerId);
    setPeerState(peerId, { state: 'reconnecting' });
    if (user.id < peerId) {
      try {
        await connectToPeer(peerId);
      } catch {
        // retried by the next state change
      }
    } else {
      sendTo('rejoin-request', peerId);
    }
  }

  // Back online: rebuild every link that isn't healthy
  useEffect(() => {
    const onOnline = () => {
      pcsRef.current.forEach((pc, peerId) => {
        if (pc.connectionState !== 'connected') {
          recoveriesRef.current.set(peerId, 0);
          recoverPeer(peerId);
        }
      });
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user]);

  async function joinCall(group, type) {
    if (activeCall) return;
    setError('');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError("You're offline. Check your internet connection and try again.");
      return;
    }

    profileRef.current = groupProfileFor(1, getNetworkProfile());
    let stream;
    try {
      stream = await acquireMedia(type, { profile: profileRef.current });
    } catch (err) {
      setError(describeMediaError(err));
      return;
    }
    localStreamRef.current = stream;
    activeTypeRef.current = type;
    setLocalStream(stream);
    setActiveCall({ groupId: group.id, groupName: group.name, type });

    const channel = supabase.channel(`groupcall-${group.id}`, {
      config: { presence: { key: user.id } },
    });
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (payload.to !== user.id) return;
        // An offer always means a fresh negotiation: drop any stale connection first
        // (but keep candidates that already arrived for it)
        closePeer(payload.from, { keepCandidates: true });
        const pc = getOrCreatePeer(payload.from);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPending(payload.from, pc);
          const answer = await pc.createAnswer();
          answer.sdp = tuneOpusSdp(answer.sdp);
          await pc.setLocalDescription(answer);
          sendTo('answer', payload.from, { sdp: pc.localDescription });
        } catch {
          // the other side will retry
        }
      })
      .on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (payload.to !== user.id) return;
        const pc = pcsRef.current.get(payload.from);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPending(payload.from, pc);
        } catch {
          // ignore stale answers
        }
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.to !== user.id) return;
        try {
          const candidate = new RTCIceCandidate(payload.candidate);
          const pc = pcsRef.current.get(payload.from);
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(candidate);
          } else {
            const list = pendingCandidatesRef.current.get(payload.from) || [];
            list.push(candidate);
            pendingCandidatesRef.current.set(payload.from, list);
          }
        } catch {
          // stale candidate — ignore
        }
      })
      .on('broadcast', { event: 'rejoin-request' }, async ({ payload }) => {
        if (payload.to !== user.id || user.id >= payload.from) return;
        closePeer(payload.from);
        try {
          await connectToPeer(payload.from);
        } catch {
          // ignore
        }
      })
      .on('broadcast', { event: 'media-state' }, ({ payload }) => {
        if (!payload?.from || payload.from === user.id) return;
        setPeerMedia((prev) => ({
          ...prev,
          [payload.from]: { muted: !!payload.muted, cameraOff: !!payload.cameraOff },
        }));
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const entries = Object.entries(state).map(([id, metas]) => ({
          id,
          username: metas[0]?.username,
          joinedAt: metas[0]?.joined_at || 0,
        }));

        // Room is full? The people who arrived last are turned away.
        const order = [...entries].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
        const myRank = order.findIndex((e) => e.id === user.id);
        if (myRank >= MAX_GROUP_CALL_PARTICIPANTS) {
          setError(`This call is full (maximum ${MAX_GROUP_CALL_PARTICIPANTS} people).`);
          leaveCall();
          return;
        }

        entries.forEach(({ id: peerId, username }) => {
          if (peerId === user.id) return;
          namesRef.current[peerId] = username || namesRef.current[peerId];
          // Deterministic tie-break: the lexicographically smaller id
          // always initiates, so both sides don't race to offer.
          if (!pcsRef.current.has(peerId) && user.id < peerId) {
            connectToPeer(peerId).catch(() => {});
          } else if (!pcsRef.current.has(peerId)) {
            getOrCreatePeer(peerId); // ready to receive their offer
          }
        });
        applyRoomQuality();
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        closePeer(key);
        setParticipants((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setPeerMedia((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        applyRoomQuality();
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ username: profile?.username || 'Someone', joined_at: Date.now() });
        }
      });
  }

  function leaveCall() {
    [...pcsRef.current.keys()].forEach(closePeer);
    pcsRef.current.clear();
    pendingCandidatesRef.current.clear();
    recoveriesRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    mutedRef.current = false;
    cameraOffRef.current = false;
    setLocalStream(null);
    setParticipants({});
    setPeerMedia({});
    setActiveCall(null);
    setMuted(false);
    setCameraOff(false);
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
    broadcastMediaState();
  }

  function toggleCamera() {
    const next = !cameraOffRef.current;
    cameraOffRef.current = next;
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
    setCameraOff(next);
    broadcastMediaState();
  }

  return (
    <GroupCallContext.Provider
      value={{
        activeCall,
        participants,
        peerMedia,
        localStream,
        muted,
        cameraOff,
        error,
        joinCall,
        leaveCall,
        toggleMute,
        toggleCamera,
      }}
    >
      {children}
    </GroupCallContext.Provider>
  );
}

export function useGroupCall() {
  return useContext(GroupCallContext);
}
