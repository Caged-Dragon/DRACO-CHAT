import { useEffect, useRef } from 'react';
import { useGroupCall } from '../contexts/GroupCallContext.jsx';
import { useAudioLevel } from '../hooks/useAudioLevel.js';

function ParticipantTile({ stream, username, isVideo, state, media }) {
  const mediaRef = useRef(null);
  useEffect(() => {
    if (mediaRef.current) mediaRef.current.srcObject = stream || null;
  }, [stream]);

  const showVideo = isVideo && !media?.cameraOff;

  return (
    <div className="group-call-tile">
      {/* Always render a playing media element: for voice calls it is an
          <audio> element, which is what actually makes sound come out. */}
      {isVideo ? (
        <video
          ref={mediaRef}
          autoPlay
          playsInline
          className="group-call-video"
          style={showVideo ? undefined : { visibility: 'hidden', position: 'absolute' }}
        />
      ) : (
        <audio ref={mediaRef} autoPlay />
      )}
      {!showVideo && <div className="call-avatar-big">{username?.[0]?.toUpperCase() || '?'}</div>}
      {state === 'reconnecting' && <span className="group-call-tile-state">Reconnecting…</span>}
      <span className="group-call-tile-name">
        {media?.muted ? '🔇 ' : ''}
        {username}
      </span>
    </div>
  );
}

export default function GroupCallScreen() {
  const { activeCall, participants, peerMedia, localStream, muted, cameraOff, error, leaveCall, toggleMute, toggleCamera } =
    useGroupCall();
  const localVideoRef = useRef(null);
  const micLevel = useAudioLevel(localStream, !!activeCall && !muted);

  // re-attach when the tile is re-created (camera turned back on)
  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream || null;
  }, [localStream, cameraOff, activeCall]);

  if (!activeCall) {
    return error ? (
      <div className="call-toast" role="alert">
        {error}
      </div>
    ) : null;
  }
  const isVideo = activeCall.type === 'video';
  const list = Object.entries(participants);

  return (
    <div className="call-overlay group-call-overlay">
      <div className="group-call-header">
        <span>{activeCall.groupName}</span>
        <span className="dim small"> · {list.length + 1} in call</span>
      </div>

      <div className="group-call-grid" data-count={list.length + 1}>
        <div className="group-call-tile">
          {isVideo && !cameraOff ? (
            <video ref={localVideoRef} autoPlay playsInline muted className="group-call-video" />
          ) : (
            <div className="call-avatar-big">You</div>
          )}
          <span className="group-call-tile-name">{muted ? '🔇 ' : ''}You</span>
        </div>
        {list.map(([id, p]) => (
          <ParticipantTile
            key={id}
            stream={p.stream}
            username={p.username}
            isVideo={isVideo}
            state={p.state}
            media={peerMedia[id]}
          />
        ))}
      </div>

      {list.length === 0 && <div className="call-banner">Waiting for others to join…</div>}
      {error && <div className="call-error">{error}</div>}

      <div className="call-controls">
        <button
          className={`call-btn ${muted ? 'active' : ''}`}
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          style={{ '--mic-level': muted ? 0 : micLevel }}
        >
          <span className="call-btn-level" aria-hidden="true" />
          {muted ? '🔇' : '🎙️'}
        </button>
        {isVideo && (
          <button
            className={`call-btn ${cameraOff ? 'active' : ''}`}
            onClick={toggleCamera}
            aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
          >
            {cameraOff ? '📷' : '🎥'}
          </button>
        )}
        <button className="call-btn end" onClick={leaveCall} aria-label="Leave call">
          📞
        </button>
      </div>
    </div>
  );
}
