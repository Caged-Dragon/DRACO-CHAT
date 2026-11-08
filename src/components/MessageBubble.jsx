import { useEffect, useRef, useState } from 'react';
import { linkifyParts, formatMessageTime, REACTION_EMOJIS } from '../utils/format.js';
import VoicePlayer from './VoicePlayer.jsx';

export default function MessageBubble({
  message,
  isMine,
  quotedMessage,
  reactions,
  currentUserId,
  onReact,
  onEdit,
  onDelete,
  onReply,
  onForward,
  onTogglePin,
  highlight,
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content || '');
  const stackRef = useRef(null);
  // Mouse/trackpad: toolbar follows hover. Touch: toolbar opens on tap.
  const canHover =
    typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

  useEffect(() => {
    if (!showMenu || canHover) return undefined;
    const close = (e) => {
      if (stackRef.current && !stackRef.current.contains(e.target)) {
        setShowMenu(false);
        setShowReactionPicker(false);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [showMenu, canHover]);

  const isDeleted = !!message.deleted_at;

  function submitEdit() {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== message.content) onEdit(trimmed);
    setEditing(false);
  }

  // Group reactions by emoji -> count + whether I reacted
  const grouped = {};
  (reactions || []).forEach((r) => {
    if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, mine: false };
    grouped[r.emoji].count += 1;
    if (r.user_id === currentUserId) grouped[r.emoji].mine = true;
  });

  return (
    <div className={`bubble-row ${isMine ? 'mine' : 'theirs'}`}>
      <div
        ref={stackRef}
        className={`bubble-stack${showMenu ? ' menu-open' : ''}`}
        onMouseEnter={canHover ? () => setShowMenu(true) : undefined}
        onMouseLeave={
          canHover
            ? () => {
                setShowMenu(false);
                setShowReactionPicker(false);
              }
            : undefined
        }
        onClick={
          canHover
            ? undefined
            : (e) => {
                if (e.target.closest('a, button, input, audio, video, [role="slider"]')) return;
                setShowMenu((v) => !v);
              }
        }
      >
          {showMenu && !isDeleted && (
            <div className="bubble-hover-actions">
              <button onClick={() => setShowReactionPicker((s) => !s)} title="React">
                😊
              </button>
              <button onClick={onReply} title="Reply">
                ↩
              </button>
              <button onClick={onForward} title="Forward">
                ➡️
              </button>
              <button onClick={onTogglePin} title={message.pinned_at ? 'Unpin' : 'Pin'}>
                📌
              </button>
              {isMine && (
                <>
                  {message.content && (
                    <button onClick={() => setEditing(true)} title="Edit">
                      ✏️
                    </button>
                  )}
                  <button onClick={onDelete} title="Delete">
                    🗑
                  </button>
                </>
              )}
            </div>
          )}

          {showReactionPicker && (
            <div className="reaction-picker">
              {REACTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    onReact(e);
                    setShowReactionPicker(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        <div className={`bubble ${isMine ? 'mine' : 'theirs'} ${highlight ? 'highlighted' : ''}`}>
        {quotedMessage && (
          <div className="bubble-quote">
            <span className="bubble-quote-text">
              {quotedMessage.deleted_at
                ? 'Message deleted'
                : quotedMessage.content || (quotedMessage.attachment_name ?? 'Attachment')}
            </span>
          </div>
        )}

        {!isDeleted && message.attachment_type === 'image' && (
          <a href={message.attachment_url} target="_blank" rel="noopener noreferrer">
            <img
              src={message.attachment_url}
              alt={message.attachment_name || 'image'}
              className="message-image"
            />
          </a>
        )}
        {!isDeleted && message.attachment_type === 'gif' && (
          <img src={message.attachment_url} alt="GIF" className="message-image" />
        )}
        {!isDeleted && message.attachment_type === 'video' && (
          <video controls preload="metadata" playsInline src={message.attachment_url} className="message-video" />
        )}
        {!isDeleted && message.attachment_type === 'file' && (
          <a
            href={message.attachment_url}
            target="_blank"
            rel="noopener noreferrer"
            className="message-file"
          >
            <span className="message-file-icon" aria-hidden="true">📄</span>
            <span className="message-file-name">{message.attachment_name}</span>
            <span className="message-file-action" aria-hidden="true">⬇</span>
          </a>
        )}
        {!isDeleted && message.attachment_type === 'audio' && (
          <VoicePlayer src={message.attachment_url} label={message.attachment_name} mine={isMine} />
        )}

        {isDeleted ? (
          <div className="bubble-text deleted-text">This message was deleted</div>
        ) : editing ? (
          <div className="bubble-edit">
            <input
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
            />
            <button onClick={submitEdit}>Save</button>
          </div>
        ) : (
          message.content && (
            <div className="bubble-text">
              {linkifyParts(message.content).map((p) =>
                p.type === 'link' ? (
                  <a key={p.key} href={p.text} target="_blank" rel="noopener noreferrer">
                    {p.text}
                  </a>
                ) : (
                  <span key={p.key}>{p.text}</span>
                )
              )}
            </div>
          )
        )}

        <div className="bubble-meta">
          <span>{formatMessageTime(message.created_at)}</span>
          {message.edited_at && !isDeleted && <span className="edited-tag">edited</span>}
          {message.expires_at && !isDeleted && (
            <span className="edited-tag" title="Disappearing message">
              ⏱
            </span>
          )}
          {isMine && !isDeleted && (
            <span className={`read-tick ${message.read_at ? 'read' : ''}`}>
              {message.read_at ? '✓✓' : '✓'}
            </span>
          )}
        </div>

        {Object.keys(grouped).length > 0 && (
          <div className="reaction-chips">
            {Object.entries(grouped).map(([emoji, info]) => (
              <button
                key={emoji}
                className={`reaction-chip ${info.mine ? 'mine' : ''}`}
                onClick={() => onReact(emoji)}
              >
                {emoji} {info.count}
              </button>
            ))}
          </div>
        )}

        </div>
      </div>
    </div>
  );
}
