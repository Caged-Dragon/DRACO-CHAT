import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';
import { usePresence } from '../contexts/PresenceContext.jsx';
import { useUnread } from '../contexts/UnreadContext.jsx';
import { useCall } from '../contexts/CallContext.jsx';
import ChatThemeModal from './ChatThemeModal.jsx';
import MessageBubble from './MessageBubble.jsx';
import PendingBubble from './PendingBubble.jsx';
import { sendViaOutbox } from '../utils/outbox.js';
import { useOutbox } from '../hooks/useOutbox.js';
import { compressImage } from '../utils/image.js';
import { uploadToBucket, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_LABEL, safeFileName, formatBytes } from '../utils/upload.js';
import { useVoiceRecorder, extensionForMime, formatClock } from '../hooks/useVoiceRecorder.js';
import Avatar from './Avatar.jsx';
import GifPicker, { gifsEnabled } from './GifPicker.jsx';
import ForwardModal from './ForwardModal.jsx';
import { computeGradient } from '../theme/fields.js';
import { QUICK_EMOJIS, formatLastSeen } from '../utils/format.js';

function sameId(a, b) {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.trim().toLowerCase() === b.trim().toLowerCase()
  );
}

const TYPING_STOP_DELAY = 3000;
const PAGE_SIZE = 50;

export default function ChatWindow({ friend, onBack }) {
  const { user } = useAuth();
  const { isOnline } = usePresence();
  const { markRead } = useUnread();
  const { startCall, callState } = useCall();

  const [messages, setMessages] = useState([]);
  const [reactionsByMessage, setReactionsByMessage] = useState({});
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [friendTyping, setFriendTyping] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadName, setUploadName] = useState('');
  const uploadAbortRef = useRef(null);
  const voice = useVoiceRecorder({ onComplete: sendVoiceMessage, onError: setAttachError });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [disappearingSeconds, setDisappearingSeconds] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [fetchedPinned, setFetchedPinned] = useState(null);
  const outbox = useOutbox(user.id);
  const pendingHere = outbox.filter((i) => i.table === 'chat_messages' && i.row.receiver_id === friend.id);

  // This chat's OWN theme overrides only — merged on top of the global
  // theme via inline CSS variables scoped to this component's root div.
  const [chatTheme, setChatTheme] = useState({});
  const [chatWallpaper, setChatWallpaper] = useState(null);

  const bottomRef = useRef(null);
  const listRef = useRef(null);
  const prependRef = useRef(null);
  const fileInputRef = useRef(null);
  const chatChannelRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const friendTypingTimeoutRef = useRef(null);

  useEffect(() => {
    loadMessages();
    loadChatSettings();
    markRead(friend.id);

    const channel = supabase
      .channel(`chat-${[user.id, friend.id].sort().join('-')}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const m = payload.new;
          const belongsHere =
            (sameId(m.sender_id, user.id) && sameId(m.receiver_id, friend.id)) ||
            (sameId(m.sender_id, friend.id) && sameId(m.receiver_id, user.id));
          if (belongsHere) {
            setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
            if (sameId(m.sender_id, friend.id)) markRead(friend.id);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const m = payload.new;
          const belongsHere =
            (sameId(m.sender_id, user.id) && sameId(m.receiver_id, friend.id)) ||
            (sameId(m.sender_id, friend.id) && sameId(m.receiver_id, user.id));
          if (belongsHere) {
            setMessages((prev) => prev.map((old) => (old.id === m.id ? m : old)));
            setFetchedPinned((fp) => (fp && fp.id === m.id ? (m.pinned_at && !m.deleted_at ? m : null) : fp));
          }
        }
      )
      .on('broadcast', { event: 'typing' }, () => {
        setFriendTyping(true);
        if (friendTypingTimeoutRef.current) clearTimeout(friendTypingTimeoutRef.current);
        friendTypingTimeoutRef.current = setTimeout(() => setFriendTyping(false), TYPING_STOP_DELAY + 500);
      })
      .on('broadcast', { event: 'stop-typing' }, () => {
        setFriendTyping(false);
      })
      .subscribe();

    chatChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (friendTypingTimeoutRef.current) clearTimeout(friendTypingTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friend.id]);

  useLayoutEffect(() => {
    // When older messages are prepended, keep the reader where they were
    // instead of jumping to the bottom.
    if (prependRef.current != null) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight - prependRef.current;
      prependRef.current = null;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingHere.length]);

  // Server-side search across the whole conversation (not just loaded messages)
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults(null);
      return undefined;
    }
    const timer = setTimeout(async () => {
      const safe = q.replace(/[\\%_]/g, (c) => `\\${c}`);
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .or(
          `and(sender_id.eq.${user.id},receiver_id.eq.${friend.id}),and(sender_id.eq.${friend.id},receiver_id.eq.${user.id})`
        )
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .is('deleted_at', null)
        .ilike('content', `%${safe}%`)
        .order('created_at', { ascending: false })
        .limit(50);
      setSearchResults((data || []).slice().reverse());
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, friend.id]);

  async function loadMessages() {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .or(
        `and(sender_id.eq.${user.id},receiver_id.eq.${friend.id}),and(sender_id.eq.${friend.id},receiver_id.eq.${user.id})`
      )
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (error) {
      console.error(error);
      return;
    }
    const list = data.slice().reverse();
    setMessages(list);
    setHasMore(data.length === PAGE_SIZE);
    if (list.length) loadReactions(list.map((m) => m.id));

    // The pinned banner should survive even if the pin is older than the first page
    const { data: pinned } = await supabase
      .from('chat_messages')
      .select('*')
      .or(
        `and(sender_id.eq.${user.id},receiver_id.eq.${friend.id}),and(sender_id.eq.${friend.id},receiver_id.eq.${user.id})`
      )
      .not('pinned_at', 'is', null)
      .is('deleted_at', null)
      .order('pinned_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setFetchedPinned(pinned ?? null);
  }

  async function loadOlder() {
    if (loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .or(
        `and(sender_id.eq.${user.id},receiver_id.eq.${friend.id}),and(sender_id.eq.${friend.id},receiver_id.eq.${user.id})`
      )
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .lt('created_at', messages[0].created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (!error && data) {
      const older = data.slice().reverse();
      prependRef.current = listRef.current?.scrollHeight ?? 0;
      setMessages((prev) => [...older, ...prev]);
      setHasMore(data.length === PAGE_SIZE);
      if (older.length) {
        const { data: rx } = await supabase
          .from('chat_message_reactions')
          .select('*')
          .in('message_id', older.map((m) => m.id));
        if (rx?.length) {
          setReactionsByMessage((prev) => {
            const next = { ...prev };
            rx.forEach((r) => {
              next[r.message_id] = [...(next[r.message_id] || []), r];
            });
            return next;
          });
        }
      }
    }
    setLoadingOlder(false);
  }

  async function loadReactions(messageIds) {
    const { data } = await supabase
      .from('chat_message_reactions')
      .select('*')
      .in('message_id', messageIds);

    const grouped = {};
    (data || []).forEach((r) => {
      if (!grouped[r.message_id]) grouped[r.message_id] = [];
      grouped[r.message_id].push(r);
    });
    setReactionsByMessage(grouped);

    // Live reaction updates for this conversation's messages
    const idSet = new Set(messageIds);
    const channel = supabase
      .channel(`reactions-${[user.id, friend.id].sort().join('-')}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_message_reactions' }, (payload) => {
        const row = payload.new || payload.old;
        if (!idSet.has(row.message_id) && !messages.find((m) => m.id === row.message_id)) return;
        setReactionsByMessage((prev) => {
          const next = { ...prev };
          const list = (next[row.message_id] || []).filter(
            (r) => !(r.user_id === row.user_id && r.emoji === row.emoji)
          );
          if (payload.eventType !== 'DELETE') list.push(row);
          next[row.message_id] = list;
          return next;
        });
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }

  async function loadChatSettings() {
    const { data } = await supabase
      .from('chat_settings')
      .select('theme, wallpaper_url, disappearing_seconds')
      .eq('owner_id', user.id)
      .eq('friend_id', friend.id)
      .maybeSingle();

    setChatTheme(data?.theme ?? {});
    setChatWallpaper(data?.wallpaper_url ?? null);
    setDisappearingSeconds(data?.disappearing_seconds || 0);
  }

  async function updateDisappearing(seconds) {
    setDisappearingSeconds(seconds);
    await supabase.from('chat_settings').upsert(
      {
        owner_id: user.id,
        friend_id: friend.id,
        disappearing_seconds: seconds || null,
        theme: chatTheme,
        wallpaper_url: chatWallpaper,
      },
      { onConflict: 'owner_id,friend_id' }
    );
  }

  function sendTyping() {
    chatChannelRef.current?.send({ type: 'broadcast', event: 'typing', payload: {} });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      chatChannelRef.current?.send({ type: 'broadcast', event: 'stop-typing', payload: {} });
    }, TYPING_STOP_DELAY);
  }

  function handleTextChange(e) {
    setText(e.target.value);
    sendTyping();
  }

  async function sendMessage(e) {
    e?.preventDefault();
    const content = text.trim();
    if (!content) return;

    setText('');
    setReplyingTo(null);
    chatChannelRef.current?.send({ type: 'broadcast', event: 'stop-typing', payload: {} });

    const expiresAt = disappearingSeconds
      ? new Date(Date.now() + disappearingSeconds * 1000).toISOString()
      : null;

    await sendViaOutbox(
      supabase,
      user.id,
      'chat_messages',
      {
        sender_id: user.id,
        receiver_id: friend.id,
        content,
        reply_to_id: replyingTo?.id ?? null,
        expires_at: expiresAt,
      },
      content
    );
  }

  async function handleAttachmentPick(e) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;

    setAttachError('');
    setUploading(true);
    // Photos are shrunk before upload (faster, less data); other files go as-is
    const file = await compressImage(picked, { maxDim: 1600, quality: 0.82 });

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError(`That file is ${formatBytes(file.size)}. The limit is ${MAX_ATTACHMENT_LABEL}.`);
      setUploading(false);
      return;
    }

    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploadName(file.name);
    setUploadPct(0);
    const path = `${user.id}/${Date.now()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await uploadToBucket({
      bucket: 'chat-attachments',
      path,
      file,
      onProgress: setUploadPct,
      signal: controller.signal,
    });
    uploadAbortRef.current = null;

    if (uploadError) {
      if (!uploadError.cancelled) setAttachError(uploadError.message);
      setUploading(false);
      setUploadName('');
      return;
    }

    const { data: pub } = supabase.storage.from('chat-attachments').getPublicUrl(path);
    const attachmentType = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
    const expiresAt = disappearingSeconds
      ? new Date(Date.now() + disappearingSeconds * 1000).toISOString()
      : null;

    await sendViaOutbox(
      supabase,
      user.id,
      'chat_messages',
      {
        sender_id: user.id,
        receiver_id: friend.id,
        attachment_url: pub.publicUrl,
        attachment_type: attachmentType,
        attachment_name: file.name,
        expires_at: expiresAt,
      },
      attachmentType === 'image' ? '📷 Photo' : attachmentType === 'video' ? '🎬 Video' : `📎 ${file.name}`
    );
    setUploading(false);
    setUploadName('');
  }

  async function handleGifSelect(url) {
    setShowGifPicker(false);
    const expiresAt = disappearingSeconds
      ? new Date(Date.now() + disappearingSeconds * 1000).toISOString()
      : null;
    await sendViaOutbox(
      supabase,
      user.id,
      'chat_messages',
      {
        sender_id: user.id,
        receiver_id: friend.id,
        attachment_url: url,
        attachment_type: 'gif',
        attachment_name: 'GIF',
        expires_at: expiresAt,
      },
      'GIF'
    );
  }

  async function sendVoiceMessage({ blob, mime, duration }) {
    setAttachError('');
    setUploading(true);
    const path = `${user.id}/${Date.now()}-voice-message.${extensionForMime(mime)}`;
    const { error: uploadError } = await uploadToBucket({ bucket: 'chat-attachments', path, file: blob, contentType: mime });
    if (uploadError) {
      setAttachError(uploadError.message);
      setUploading(false);
      return;
    }
    const { data: pub } = supabase.storage.from('chat-attachments').getPublicUrl(path);
    const expiresAt = disappearingSeconds
      ? new Date(Date.now() + disappearingSeconds * 1000).toISOString()
      : null;
    await sendViaOutbox(
      supabase,
      user.id,
      'chat_messages',
      {
        sender_id: user.id,
        receiver_id: friend.id,
        attachment_url: pub.publicUrl,
        attachment_type: 'audio',
        attachment_name: `Voice message (${duration}s)`,
        expires_at: expiresAt,
      },
      '🎙️ Voice message'
    );
    setUploading(false);
  }

  async function handleReact(messageId, emoji) {
    const existing = (reactionsByMessage[messageId] || []).find(
      (r) => r.user_id === user.id && r.emoji === emoji
    );
    if (existing) {
      await supabase.from('chat_message_reactions').delete().eq('id', existing.id);
    } else {
      await supabase.from('chat_message_reactions').insert({ message_id: messageId, user_id: user.id, emoji });
    }
  }

  async function handleEditMessage(messageId, newContent) {
    await supabase
      .from('chat_messages')
      .update({ content: newContent, edited_at: new Date().toISOString() })
      .eq('id', messageId);
  }

  async function handleDeleteMessage(messageId) {
    await supabase.from('chat_messages').update({ deleted_at: new Date().toISOString() }).eq('id', messageId);
  }

  async function handleTogglePin(message) {
    await supabase
      .from('chat_messages')
      .update({ pinned_at: message.pinned_at ? null : new Date().toISOString() })
      .eq('id', message.id);
  }

  function insertEmoji(emoji) {
    setText((t) => t + emoji);
    setShowEmojiPicker(false);
  }

  const searching = searchQuery.trim().length >= 2;
  const filteredMessages = searching ? searchResults ?? [] : messages;

  const pinnedMessage =
    [...messages].reverse().find((m) => m.pinned_at && !m.deleted_at) ?? fetchedPinned;

  // Only the CSS variables this chat has actually overridden get
  // applied here — everything else falls through to the global theme
  // set on <html> by ThemeContext, since custom properties inherit.
  const scopedStyle = { ...chatTheme };
  const scopedGradient = computeGradient(chatTheme);
  if (scopedGradient) scopedStyle['--gradient'] = scopedGradient;
  scopedStyle['--wallpaper-image'] = chatWallpaper ? `url("${chatWallpaper}")` : undefined;

  const online = isOnline(friend.id);

  return (
    <div className="chat-window" style={scopedStyle}>
      <div className="chat-header">
        <button className="back-btn" onClick={onBack} aria-label="Back to friends list">
          ←
        </button>
        <Avatar url={friend.avatar_url} name={friend.username} size={32} online={online} showStatusDot />
        <div className="chat-header-name">
          <div>{friend.username}</div>
          <div className="chat-header-sub">
            {friendTyping
              ? 'typing...'
              : online
              ? 'Online'
              : friend.last_seen_at
              ? `Last seen ${formatLastSeen(friend.last_seen_at)}`
              : ''}
          </div>
        </div>
        <button className="chat-settings-btn" onClick={() => setSearchOpen((s) => !s)} aria-label="Search">
          🔍
        </button>
        <button
          className="chat-settings-btn"
          onClick={() => startCall(friend, 'audio')}
          disabled={callState !== 'idle'}
          aria-label="Voice call"
          title="Voice call"
         
        >
          📞
        </button>
        <button
          className="chat-settings-btn"
          onClick={() => startCall(friend, 'video')}
          disabled={callState !== 'idle'}
          aria-label="Video call"
          title="Video call"
         
        >
          🎥
        </button>
        <button
          className="chat-settings-btn"
          onClick={() => setShowThemeModal(true)}
          aria-label="Chat settings"
         
        >
          🎨
        </button>
      </div>

      {searchOpen && (
        <div className="chat-search-bar">
          <input
            type="text"
            placeholder="Search in this chat..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          <button
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery('');
            }}
          >
            ✕
          </button>
        </div>
      )}

      {pinnedMessage && (
        <div className="pinned-banner">
          <span className="pinned-text">📌 {pinnedMessage.content || pinnedMessage.attachment_name || 'Pinned message'}</span>
          <button onClick={() => handleTogglePin(pinnedMessage)}>Unpin</button>
        </div>
      )}

      <div className="chat-messages" ref={listRef}>
        {hasMore && !searching && (
          <button type="button" className="load-older-btn" onClick={loadOlder} disabled={loadingOlder}>
            {loadingOlder ? 'Loading…' : 'Load earlier messages'}
          </button>
        )}
        {searching && searchResults && searchResults.length === 0 && (
          <p className="dim small" style={{ textAlign: 'center' }}>No messages match your search.</p>
        )}
        {filteredMessages.map((m) => {
          const quoted = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              isMine={sameId(m.sender_id, user.id)}
              quotedMessage={quoted}
              reactions={reactionsByMessage[m.id]}
              currentUserId={user.id}
              onReact={(emoji) => handleReact(m.id, emoji)}
              onEdit={(newContent) => handleEditMessage(m.id, newContent)}
              onDelete={() => handleDeleteMessage(m.id)}
              onReply={() => setReplyingTo(m)}
              onForward={() => setForwardingMessage(m)}
              onTogglePin={() => handleTogglePin(m)}
              highlight={searching}
            />
          );
        })}
        {!searching && pendingHere.map((p) => <PendingBubble key={p.id} item={p} userId={user.id} />)}
        <div ref={bottomRef} />
      </div>

      {attachError && <p className="error-text attach-error">{attachError}</p>}

      {uploading && uploadName && (
        <div className="upload-progress" role="status" aria-live="polite">
          <div className="upload-progress-info">
            <span className="upload-progress-name">{uploadName}</span>
            <span className="upload-progress-pct">{uploadPct}%</span>
          </div>
          <div className="upload-progress-bar"><span style={{ width: `${uploadPct}%` }} /></div>
          <button type="button" className="upload-progress-cancel" onClick={() => uploadAbortRef.current?.abort()} aria-label="Cancel upload">✕</button>
        </div>
      )}

      {replyingTo && (
        <div className="reply-preview">
          <div>
            <span className="reply-preview-label">Replying to</span>
            <span className="reply-preview-text">
              {replyingTo.content || replyingTo.attachment_name || 'a message'}
            </span>
          </div>
          <button onClick={() => setReplyingTo(null)}>✕</button>
        </div>
      )}

      <form className="chat-input" onSubmit={sendMessage}>
        {voice.recording ? (
          <div className="voice-recording-bar" role="status" aria-live="polite">
            <button type="button" className="voice-rec-cancel" onClick={voice.cancel} aria-label="Cancel recording">🗑️</button>
            <span className="voice-rec-dot" aria-hidden="true" />
            <span className="voice-rec-time">{formatClock(voice.seconds)}</span>
            <span className="voice-rec-hint">Recording…</span>
            <button type="button" className="voice-rec-send" onClick={voice.stop} aria-label="Send voice message">Send ➤</button>
          </div>
        ) : (
          <>
        <button
          type="button"
          className="attach-btn"
          onClick={() => setShowEmojiPicker((s) => !s)}
          aria-label="Emoji"
         
        >
          😊
        </button>
        {gifsEnabled && (
        <button
          type="button"
          className="attach-btn gif-btn"
          onClick={() => setShowGifPicker((s) => !s)}
          aria-label="Send GIF"
         
        >
          GIF
        </button>
        )}
        <button
          type="button"
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          aria-label="Attach image or document"
         
        >
          {uploading ? '…' : '📎'}
        </button>
        {voice.supported && (
          <button type="button" className="attach-btn" onClick={voice.start} disabled={uploading} aria-label="Record voice message">
            🎙️
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleAttachmentPick}
          hidden
        />
        <input
          type="text"
          placeholder="Type a message..."
          value={text}
          onChange={handleTextChange}
         
        />
        <button type="submit">
          Send
        </button>
          </>
        )}
      </form>

      {showEmojiPicker && (
        <div className="emoji-picker">
          {QUICK_EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => insertEmoji(e)}>
              {e}
            </button>
          ))}
        </div>
      )}

      {gifsEnabled && showGifPicker && <GifPicker onSelect={handleGifSelect} onClose={() => setShowGifPicker(false)} />}

      {forwardingMessage && (
        <ForwardModal message={forwardingMessage} onClose={() => setForwardingMessage(null)} />
      )}

      {showThemeModal && (
        <ChatThemeModal
          friend={friend}
          theme={chatTheme}
          wallpaperUrl={chatWallpaper}
          disappearingSeconds={disappearingSeconds}
          onDisappearingChange={updateDisappearing}
          onChange={(nextTheme, nextWallpaper) => {
            setChatTheme(nextTheme);
            setChatWallpaper(nextWallpaper);
          }}
          onClose={() => setShowThemeModal(false)}
        />
      )}
    </div>
  );
}
