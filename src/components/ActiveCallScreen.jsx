import { useEffect, useRef, useState } from 'react';
import { useCall } from '../contexts/CallContext.jsx';
import { useAudioLevel } from '../hooks/useAudioLevel.js';
import { supportsScreenShare, supportsSpeakerSelection } from '../utils/rtc.js';

const QUALITY_LABEL = { good: 'Good connection', fair: 'Fair connection', poor: 'Poor connection' };

function SignalBars({ quality }) {
  if (!quality) return null;
  const level = quality.level || 'good';
  const bars = level === 'good' ? 3 : level === 'fair' ? 2 : 1;
  const details = [
    quality.rttMs != null ? `${quality.rttMs} ms delay` : null,
    quality.lossPct != null ? `${quality.lossPct}% packet loss` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span
      className={`call-signal call-signal-${level}`}
      role="img"
      aria-label={QUALITY_LABEL[level]}
      title={details ? `${QUALITY_LABEL[level]} — ${details}` : QUALITY_LABEL[level]}
    >
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= bars ? 'on' : ''} />
      ))}
    </span>
  );
}

function DevicePanel({ devices, selected, onMic, onCam, onSpeaker, showCamera }) {
  const canSpeaker = supportsSpeakerSelection() && devices.speakers.length > 0;
  return (
    <div className="call-device-panel" role="dialog" aria-label="Call devices">
      <label>
        Microphone
        <select value={selected.mic} onChange={(e) => onMic(e.target.value)}>
          <option value="">Default</option>
          {devices.mics.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      {showCamera && (
        <label>
          Camera
          <select value={selected.cam} onChange={(e) => onCam(e.target.value)}>
            <option value="">Default</option>
            {devices.cams.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {canSpeaker && (
        <label>
          Speaker
          <select value={selected.speaker} onChange={(e) => onSpeaker(e.target.value)}>
            <option value="">Default</option>
            {devices.speakers.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Speaker ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export default function ActiveCallScreen() {
  const {
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
    canFlipCamera,
    endCall,
    reconnect,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    switchCamera,
    selectCamera,
    selectMicrophone,
    selectSpeaker,
  } = useCall();

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const [seconds, setSeconds] = useState(0);
  const [showDevices, setShowDevices] = useState(false);

  const micLevel = useAudioLevel(localStream, callState === 'connected' && !muted);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream || null;
  }, [localStream]);

  useEffect(() => {
    if (callType === 'video' && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream || null;
    }
    if (callType === 'audio' && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream || null;
    }
  }, [remoteStream, callType]);

  // Send call audio to the speaker the user picked (where the browser supports it)
  useEffect(() => {
    const el = callType === 'video' ? remoteVideoRef.current : remoteAudioRef.current;
    if (el && typeof el.setSinkId === 'function') {
      el.setSinkId(selectedDevices.speaker || '').catch(() => {});
    }
  }, [selectedDevices.speaker, callType, callState]);

  useEffect(() => {
    if (callState !== 'connected' && callState !== 'reconnecting') {
      setSeconds(0);
      return undefined;
    }
    // keep counting while reconnecting; the call is still "on"
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [callState === 'connected' || callState === 'reconnecting']);

  useEffect(() => {
    if (callState === 'idle') setShowDevices(false);
  }, [callState]);

  // The call has ended: show any message (declined, no answer, permission problem...)
  if (callState === 'idle') {
    return error ? (
      <div className="call-toast" role="alert">
        {error}
      </div>
    ) : null;
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const statusText =
    callState === 'connected'
      ? `${mm}:${ss}`
      : callState === 'reconnecting'
        ? 'Reconnecting…'
        : callState === 'calling'
          ? 'Ringing…'
          : 'Connecting…';

  const remoteVideoHidden = remoteMedia.cameraOff || remoteMedia.networkPaused;

  return (
    <div className="call-overlay">
      {callType === 'video' ? (
        <>
          <video ref={remoteVideoRef} autoPlay playsInline className="call-remote-video" />
          {remoteVideoHidden && callState !== 'calling' && (
            <div className="call-remote-placeholder">
              <div className="call-avatar-big">{remoteName?.[0]?.toUpperCase() || '?'}</div>
              <span>
                {remoteMedia.networkPaused ? `${remoteName}'s video is paused (poor connection)` : `${remoteName}'s camera is off`}
              </span>
            </div>
          )}
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`call-local-video${cameraOff || videoPausedByNetwork ? ' off' : ''}`}
          />
        </>
      ) : (
        <audio ref={remoteAudioRef} autoPlay />
      )}

      <div className={`call-info${callType === 'video' ? ' call-info-video' : ''}`}>
        {callType !== 'video' && (
          <div className="call-avatar-big">{remoteName?.[0]?.toUpperCase() || '?'}</div>
        )}
        <div className="call-name">{remoteName}</div>
        <div className="call-status">
          {statusText}
          {callState === 'connected' && <SignalBars quality={quality} />}
          {screenSharing && ' · Sharing screen'}
        </div>
        {remoteMedia.muted && callState !== 'calling' && (
          <div className="call-badge">🔇 {remoteName} is muted</div>
        )}
        {error && <div className="call-error">{error}</div>}
      </div>

      {callState === 'reconnecting' && (
        <div className="call-banner call-banner-warn" role="status">
          <span>Connection lost — trying to reconnect…</span>
          <button type="button" onClick={reconnect}>
            Try again
          </button>
        </div>
      )}
      {callState === 'connected' && videoPausedByNetwork && (
        <div className="call-banner" role="status">
          Poor connection — your video is paused to keep the audio clear.
        </div>
      )}
      {callState === 'connected' && quality?.level === 'poor' && !videoPausedByNetwork && callType === 'audio' && (
        <div className="call-banner" role="status">
          Poor connection — audio may cut out.
        </div>
      )}

      {showDevices && (
        <DevicePanel
          devices={devices}
          selected={selectedDevices}
          onMic={selectMicrophone}
          onCam={selectCamera}
          onSpeaker={selectSpeaker}
          showCamera={callType === 'video'}
        />
      )}

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
        {callType === 'video' && (
          <>
            <button
              className={`call-btn ${cameraOff ? 'active' : ''}`}
              onClick={toggleCamera}
              aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
            >
              {cameraOff ? '📷' : '🎥'}
            </button>
            {canFlipCamera && !screenSharing && (
              <button className="call-btn" onClick={switchCamera} aria-label="Flip camera" title="Flip camera">
                🔄
              </button>
            )}
            {supportsScreenShare() && (
              <button
                className={`call-btn ${screenSharing ? 'active' : ''}`}
                onClick={toggleScreenShare}
                aria-label="Share screen"
                title="Share screen"
              >
                🖥️
              </button>
            )}
          </>
        )}
        <button
          className={`call-btn ${showDevices ? 'active' : ''}`}
          onClick={() => setShowDevices((v) => !v)}
          aria-label="Call settings"
          title="Microphone, camera and speaker"
        >
          ⚙️
        </button>
        <button className="call-btn end" onClick={endCall} aria-label="End call">
          📞
        </button>
      </div>
    </div>
  );
}
