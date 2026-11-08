import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useGroupCall } from '../contexts/GroupCallContext.jsx';
import { useUnread } from '../contexts/UnreadContext.jsx';
import PendingBubble from './PendingBubble.jsx';
import { sendViaOutbox } from '../utils/outbox.js';
import { useOutbox } from '../hooks/useOutbox.js';
import { compressImage } from '../utils/image.js';
import { uploadToBucket, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_LABEL, safeFileName, formatBytes } from '../utils/upload.js';
import { useVoiceRecorder, extensionForMime, formatClock } from '../hooks/useVoiceRecorder.js';
import Avatar from './Avatar.jsx';
import GifPicker, { gifsEnabled } from './GifPicker.jsx';
import ForwardModal from './ForwardModal.jsx';
import { linkifyParts, formatMessageTime, QUICK_EMOJIS, REACTION_EMOJIS } from '../utils/format.js';

const TYPING_STOP_DELAY = 3000;
const PAGE_SIZE = 50;
const DISAPPEAR_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '24 hours', value: 24 * 3600 },
  { label: '7 days', value: 7 * 24 * 3600 },
];

function highlightMentions(text, mentionUsernames) {
  if (!mentionUsernames?.length) return [{ type: 'text', text, key: 0 }];
  const pattern = new RegExp(
    `(@(?:${mentionUsernames.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`,
    'gi'
  );
  return text
    .split(pattern)
    .map((part, i) => ({ type: pattern.test(part) ? 'mention' : 'text', text: part, key: i }))
    .filter((p) => p.text !== '');
}

export default function GroupChatWindow({ group, onBack }) {
  const { user, profile } = useAuth();
  const { joinCall, activeCall } = useGroupCall();
  const { markGroupRead, setActiveGroup } = useUnread();

  const [messages, setMessages] = useState([]);
  const [reactionsByMessage, setReactionsByMessage] = useState({});
  const [members, setMembers] = useState([]);
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadName, setUploadName] = useState('');
  const uploadAbortRef = useRef(null);
  const voice = useVoiceRecorder({ onComplete: sendVoiceMessage, onError: setAttachError });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  const [showMembers, setShowMembers] = useState(false);
  const [mentionQuery, setMentionQuery] = useState(null);
  const [disappearingSeconds, setDisappearingSeconds] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [fetchedPinned, setFetchedPinned] = useState(null);
  const [addCandidates, setAddCandidates] = useState(null);
  const [panelError, setPanelError] = useState('');
  const outbox = useOutbox(user.id);
  const pendingHere = outbox.filter((i) => i.table === 'chat_group_messages' && i.row.group_id === group.id);
  const [menuMsgId, setMenuMsgId] = useState(null);
  const canHover =
    typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

  const bottomRef = useRef(null);
  const listRef = useRef(null);
  const prependRef = useRef(null);
  const membersRef = useRef([]);
  const fileInputRef = useRef(null);
  const channelRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    loadMessages();
    loadMembers();
    loadGroupSettings();
    markRead();

    const channel = supabase
      .channel(`group-${group.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_group_messages', filter: `group_id=eq.${group.id}` },
        (payload) => {
          // Realtime rows don't include the joined sender profile, so attach it here
          const senderProfile = membersRef.current.find((mm) => mm.id === payload.new.sender_id);
          const withSender = {
            ...payload.new,
            sender: senderProfile
              ? { id: senderProfile.id, username: senderProfile.username, avatar_url: senderProfile.avatar_url }
              : undefined,
          };
          setMessages((prev) => (prev.some((x) => x.id === withSender.id) ? prev : [...prev, withSender]));
          if (payload.new.sender_id !== user.id) markRead();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_group_messages', filter: `group_id=eq.${group.id}` },
        (payload) => {
          setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? { ...payload.new, sender: m.sender } : m)));
          setFetchedPinned((fp) =>
            fp && fp.id === payload.new.id ? (payload.new.pinned_at && !payload.new.deleted_at ? { ...payload.new, sender: fp.sender } : null) : fp
          );
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_group_message_reactions' },
        (payload) => {
          const row = payload.new?.id ? payload.new : payload.old;
          setReactionsByMessage((prev) => {
            const list = (prev[row.message_id] || []).filter(
              (r) => !(r.user_id === row.user_id && r.emoji === row.emoji)
            );
            if (payload.eventType !== 'DELETE') list.push(row);
            return { ...prev, [row.message_id]: list };
          });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_group_members', filter: `group_id=eq.${group.id}` },
        () => loadMembers()
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.userId === user.id) return;
        setTypingUsers((prev) => ({ ...prev, [payload.userId]: payload.username }));
        setTimeout(() => {
          setTypingUsers((prev) => {
            const next = { ...prev };
            delete next[payload.userId];
            return next;
          });
        }, TYPING_STOP_DELAY + 500);
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);

  // On touch screens the message toolbar opens on tap; close it on any tap elsewhere
  useEffect(() => {
    if (menuMsgId === null || canHover) return undefined;
    const close = (e) => {
      if (!e.target.closest?.('.bubble-stack.menu-open')) setMenuMsgId(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuMsgId, canHover]);

  // Tell the unread tracker which group is open so its badge stays at zero
  useEffect(() => {
    setActiveGroup(group.id);
    return () => setActiveGroup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);

  useLayoutEffect(() => {
    // Keep the reader's place when older messages are prepended
    if (prependRef.current != null) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight - prependRef.current;
      prependRef.current = null;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingHere.length]);

  async function loadMessages() {
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from('chat_group_messages')
      .select('*, sender:chat_profiles!chat_group_messages_sender_id_fkey(id, username, avatar_url)')
      .eq('group_id', group.id)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    const list = (data || []).slice().reverse();
    setMessages(list);
    setHasMore((data || []).length === PAGE_SIZE);

    if (list.length) {
      const { data: reactions } = await supabase
        .from('chat_group_message_reactions')
        .select('*')
        .in(
          'message_id',
          list.map((m) => m.id)
        );
      const grouped = {};
      (reactions || []).forEach((r) => {
        if (!grouped[r.message_id]) grouped[r.message_id] = [];
        grouped[r.message_id].push(r);
      });
      setReactionsByMessage(grouped);
    }

    // Keep the pinned banner even if the pin is older than the first page
    const { data: pinned } = await supabase
      .from('chat_group_messages')
      .select('*, sender:chat_profiles!chat_group_messages_sender_id_fkey(id, username, avatar_url)')
      .eq('group_id', group.id)
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
      .from('chat_group_messages')
      .select('*, sender:chat_profiles!chat_group_messages_sender_id_fkey(id, username, avatar_url)')
      .eq('group_id', group.id)
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
          .from('chat_group_message_reactions')
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

  async function loadMembers() {
    const { data } = await supabase
      .from('chat_group_members')
      .select('user_id, last_read_at, role, profiles:chat_profiles(id, username, avatar_url)')
      .eq('group_id', group.id);
    const list = (data || [])
      .map((r) => ({ ...r.profiles, last_read_at: r.last_read_at, role: r.role }))
      .filter((m) => m.id);
    membersRef.current = list;
    setMembers(list);
    // If this person was removed from the group while it was open, close it
    if (data && list.length > 0 && !list.some((m) => m.id === user.id)) onBack();
  }

  async function loadGroupSettings() {
    const { data } = await supabase
      .from('chat_groups')
      .select('disappearing_seconds')
      .eq('id', group.id)
      .single();
    setDisappearingSeconds(data?.disappearing_seconds || 0);
  }

  async function markRead() {
    await markGroupRead(group.id);
  }

  const isAdmin = members.find((m) => m.id === user.id)?.role === 'admin';
  const isCreator = group.created_by === user.id;

  async function changeRole(memberId, role) {
    setPanelError('');
    const { error } = await supabase
      .from('chat_group_members')
      .update({ role })
      .eq('group_id', group.id)
      .eq('user_id', memberId);
    if (error) setPanelError(error.message);
    loadMembers();
  }

  async function removeMember(member) {
    if (!window.confirm(`Remove ${member.username} from this group?`)) return;
    setPanelError('');
    const { error } = await supabase
      .from('chat_group_members')
      .delete()
      .eq('group_id', group.id)
      .eq('user_id', member.id);
    if (error) setPanelError(error.message);
    loadMembers();
  }

  async function leaveGroup() {
    if (!window.confirm('Leave this group? You will stop receiving its messages.')) return;
    const { error } = await supabase
      .from('chat_group_members')
      .delete()
      .eq('group_id', group.id)
      .eq('user_id', user.id);
    if (error) setPanelError(error.message);
    else onBack();
  }

  async function deleteGroup() {
    if (!window.confirm('Delete this group for everyone? All of its messages will be removed. This cannot be undone.')) return;
    const { error } = await supabase.from('chat_groups').delete().eq('id', group.id);
    if (error) setPanelError(error.message);
    else onBack();
  }

  async function openAddMembers() {
    setPanelError('');
    const { data, error } = await supabase
      .from('chat_friendships')
      .select(
        `requester_id, addressee_id,
         requester:chat_profiles!chat_friendships_requester_id_fkey(id, username, avatar_url),
         addressee:chat_profiles!chat_friendships_addressee_id_fkey(id, username, avatar_url)`
      )
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
    if (error) {
      setPanelError(error.message);
      return;
    }
    const memberIds = new Set(members.map((m) => m.id));
    const friends = (data || [])
      .map((row) => (row.requester_id === user.id ? row.addressee : row.requester))
      .filter((f) => f && !memberIds.has(f.id));
    setAddCandidates(friends);
  }

  async function addMember(friend) {
    setPanelError('');
    const { error } = await supabase
      .from('chat_group_members')
      .insert({ group_id: group.id, user_id: friend.id });
    if (error) {
      setPanelError(error.message);
      return;
    }
    setAddCandidates((list) => (list || []).filter((f) => f.id !== friend.id));
    loadMembers();
  }

  async function updateDisappearing(seconds) {
    setDisappearingSeconds(seconds);
    await supabase.from('chat_groups').update({ disappearing_seconds: seconds || null }).eq('id', group.id);
  }

  function handleTextChange(e) {
    const value = e.target.value;
    setText(value);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: user.id, username: profile?.username || 'Someone' },
    });

    const lastWord = value.split(/\s/).pop();
    if (lastWord.startsWith('@') && lastWord.length >= 1) {
      setMentionQuery(lastWord.slice(1).toLowerCase());
    } else {
      setMentionQuery(null);
    }
  }

  function pickMention(username) {
    setText((t) => {
      const parts = t.split(/\s/);
      parts[parts.length - 1] = `@${username} `;
      return parts.join(' ');
    });
    setMentionQuery(null);
  }

  async function sendMessage(e) {
    e?.preventDefault();
    const content = text.trim();
    if (!content) return;
    setText('');
    setReplyingTo(null);
    setMentionQuery(null);

    const mentionedIds = members
      .filter((m) => new RegExp(`@${m.username}\\b`, 'i').test(content))
      .map((m) => m.id);

    const expiresAt = disappearingSeconds
      ? new Date(Date.now() + disappearingSeconds * 1000).toISOString()
      : null;

    await sendViaOutbox(
      supabase,
      user.id,
      'chat_group_messages',
      {
        group_id: group.id,
        sender_id: user.id,
        content,
        reply_to_id: replyingTo?.id ?? null,
        mentions: mentionedIds,
        expires_at: expiresAt,
      },
      content
    );
  }

  async function sendAttachmentMessage({ attachment_url, attachment_type, attachment_name }) {
    const expiresAt = disappearingSeconds
      ? new Date(Date.now() + disappearingSeconds * 1000).toISOString()
      : null;
    await sendViaOutbox(
      supabase,
      user.id,
      'chat_group_messages',
      {
        group_id: group.id,
        sender_id: user.id,
        attachment_url,
        attachment_type,
        attachment_name,
        expires_at: expiresAt,
      },
      attachment_type === 'image' ? '📷 Photo' : attachment_type === 'gif' ? 'GIF' : `📎 ${attachment_name || 'Attachment'}`
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
    await sendAttachmentMessage({
      attachment_url: pub.publicUrl,
      attachment_type: file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file',
      attachment_name: file.name,
    });
    setUploading(false);
    setUploadName('');
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
    await sendAttachmentMessage({
      attachment_url: pub.publicUrl,
      attachment_type: 'audio',
      attachment_name: `Voice message (${duration}s)`,
    });
    setUploading(false);
  }

  async function handleGifSelect(url) {
    setShowGifPicker(false);
    await sendAttachmentMessage({ attachment_url: url, attachment_type: 'gif', attachment_name: 'GIF' });
  }

  async function handleEdit(messageId, newContent) {
    await supabase
      .from('chat_group_messages')
      .update({ content: newContent, edited_at: new Date().toISOString() })
      .eq('id', messageId);
  }

  async function handleDelete(messageId) {
    await supabase.from('chat_group_messages').update({ deleted_at: new Date().toISOString() }).eq('id', messageId);
  }

  async function handleTogglePin(message) {
    await supabase
      .from('chat_group_messages')
      .update({ pinned_at: message.pinned_at ? null : new Date().toISOString() })
      .eq('id', message.id);
  }

  async function handleReact(messageId, emoji) {
    const existing = (reactionsByMessage[messageId] || []).find(
      (r) => r.user_id === user.id && r.emoji === emoji
    );
    if (existing) {
      await supabase.from('chat_group_message_reactions').delete().eq('id', existing.id);
    } else {
      await supabase
        .from('chat_group_message_reactions')
        .insert({ message_id: messageId, user_id: user.id, emoji });
    }
  }

  function insertEmoji(emoji) {
    setText((t) => t + emoji);
    setShowEmojiPicker(false);
  }

  const typingNames = Object.values(typingUsers);
  const memberUsernames = members.map((m) => m.username);
  const mentionSuggestions =
    mentionQuery !== null
      ? members.filter((m) => m.id !== user.id && m.username.toLowerCase().startsWith(mentionQuery))
      : [];

  const pinnedMessage =
    [...messages].reverse().find((m) => m.pinned_at && !m.deleted_at) ?? fetchedPinned;

  const lastMessage = messages[messages.length - 1];
  const seenByCount =
    lastMessage && lastMessage.sender_id === user.id
      ? members.filter((m) => m.id !== user.id && m.last_read_at >= lastMessage.created_at).length
      : null;

  return (
    <div className="chat-window">
      <div className="chat-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="chat-header-name" onClick={() => setShowMembers((s) => !s)}>
          <div>👥 {group.name}</div>
          <div className="chat-header-sub">
            {typingNames.length > 0 ? `${typingNames.join(', ')} typing...` : `${members.length} members`}
          </div>
        </div>
        <button
          className="chat-settings-btn"
          onClick={() => joinCall(group, 'audio')}
          disabled={!!activeCall}
          aria-label="Group voice call"
         
        >
          📞
        </button>
        <button
          className="chat-settings-btn"
          onClick={() => joinCall(group, 'video')}
          disabled={!!activeCall}
          aria-label="Group video call"
         
        >
          🎥
        </button>
      </div>

      {showMembers && (
        <div className="group-members-panel">
          {members.map((m) => {
            const memberIsCreator = m.id === group.created_by;
            return (
              <div key={m.id} className="group-member-row">
                <Avatar url={m.avatar_url} name={m.username} size={26} />
                <span className="group-member-name">{m.username}</span>
                {m.role === 'admin' && (
                  <span className="role-tag">{memberIsCreator ? 'Creator' : 'Admin'}</span>
                )}
                {isAdmin && m.id !== user.id && !memberIsCreator && (
                  <span className="member-actions">
                    <button
                      type="button"
                      className="member-action-btn"
                      onClick={() => changeRole(m.id, m.role === 'admin' ? 'member' : 'admin')}
                    >
                      {m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                    </button>
                    <button type="button" className="member-action-btn danger" onClick={() => removeMember(m)}>
                      Remove
                    </button>
                  </span>
                )}
              </div>
            );
          })}
          {panelError && <p className="error-text small">{panelError}</p>}
          {isAdmin && (
            <div className="group-add-members">
              {addCandidates === null ? (
                <button type="button" className="member-action-btn" onClick={openAddMembers}>
                  ＋ Add members
                </button>
              ) : (
                <>
                  <div className="group-add-header">
                    <span>Add friends</span>
                    <button type="button" className="member-action-btn" onClick={() => setAddCandidates(null)}>
                      Done
                    </button>
                  </div>
                  {addCandidates.length === 0 && <p className="dim small">All your friends are already in this group.</p>}
                  {addCandidates.map((f) => (
                    <div key={f.id} className="group-member-row">
                      <Avatar url={f.avatar_url} name={f.username} size={26} />
                      <span className="group-member-name">{f.username}</span>
                      <button type="button" className="member-action-btn" onClick={() => addMember(f)}>
                        Add
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          <div className="group-danger-row">
            {isCreator ? (
              <button type="button" className="member-action-btn danger" onClick={deleteGroup}>
                Delete group
              </button>
            ) : (
              <button type="button" className="member-action-btn danger" onClick={leaveGroup}>
                Leave group
              </button>
            )}
          </div>
          <div className="disappearing-row">
            <span>⏱ Disappearing messages</span>
            <select
              aria-label="Disappearing messages timer"
              value={disappearingSeconds}
              disabled={!isAdmin}
              onChange={(e) => updateDisappearing(Number(e.target.value))}
            >
              {DISAPPEAR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {pinnedMessage && (
        <div className="pinned-banner">
          <span className="pinned-text">📌 {pinnedMessage.content || pinnedMessage.attachment_name || 'Pinned message'}</span>
          <button onClick={() => handleTogglePin(pinnedMessage)}>Unpin</button>
        </div>
      )}

      <div className="chat-messages" ref={listRef}>
        {hasMore && (
          <button type="button" className="load-older-btn" onClick={loadOlder} disabled={loadingOlder}>
            {loadingOlder ? 'Loading…' : 'Load earlier messages'}
          </button>
        )}
        {messages.map((m, idx) => {
          const isMine = m.sender_id === user.id;
          const quoted = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
          const isLastOfMine = isMine && idx === messages.length - 1;
          return (
            <div key={m.id} className={`bubble-row ${isMine ? 'mine' : 'theirs'}`}>
              <div
                className={`bubble-stack${menuMsgId === m.id ? ' menu-open' : ''}`}
                onMouseEnter={canHover ? () => setMenuMsgId(m.id) : undefined}
                onMouseLeave={canHover ? () => setMenuMsgId((id) => (id === m.id ? null : id)) : undefined}
                onClick={
                  canHover
                    ? undefined
                    : (e) => {
                        if (e.target.closest('a, button, input, audio')) return;
                        setMenuMsgId((id) => (id === m.id ? null : m.id));
                      }
                }
              >
                {menuMsgId === m.id && !m.deleted_at && (
                  <div className="bubble-hover-actions">
                    {REACTION_EMOJIS.slice(0, 3).map((e) => (
                      <button key={e} onClick={() => handleReact(m.id, e)} title="React">
                        {e}
                      </button>
                    ))}
                    <button onClick={() => setReplyingTo(m)} title="Reply">
                      ↩
                    </button>
                    <button onClick={() => setForwardingMessage(m)} title="Forward">
                      ➡️
                    </button>
                    <button onClick={() => handleTogglePin(m)} title={m.pinned_at ? 'Unpin' : 'Pin'}>
                      📌
                    </button>
                    {isMine && m.content && (
                      <button
                        onClick={() => {
                          const next = prompt('Edit message', m.content);
                          if (next && next.trim()) handleEdit(m.id, next.trim());
                        }}
                        title="Edit"
                      >
                        ✏️
                      </button>
                    )}
                    {isMine && (
                      <button onClick={() => handleDelete(m.id)} title="Delete">
                        🗑
                      </button>
                    )}
                  </div>
                )}
              <div className={`bubble ${isMine ? 'mine' : 'theirs'}`}>
                {!isMine && <div className="group-sender-name">{m.sender?.username}</div>}
                {quoted && (
                  <div className="bubble-quote">
                    <span className="bubble-quote-text">
                      {quoted.deleted_at ? 'Message deleted' : quoted.content || quoted.attachment_name}
                    </span>
                  </div>
                )}
                {!m.deleted_at && m.attachment_type === 'image' && (
                  <a href={m.attachment_url} target="_blank" rel="noopener noreferrer">
                    <img src={m.attachment_url} alt={m.attachment_name} className="message-image" />
                  </a>
                )}
                {!m.deleted_at && m.attachment_type === 'gif' && (
                  <img src={m.attachment_url} alt="GIF" className="message-image" />
                )}
                {!m.deleted_at && m.attachment_type === 'file' && (
                  <a href={m.attachment_url} target="_blank" rel="noopener noreferrer" className="message-file">
                    📄 {m.attachment_name}
                  </a>
                )}
                {m.deleted_at ? (
                  <div className="bubble-text deleted-text">This message was deleted</div>
                ) : (
                  m.content && (
                    <div className="bubble-text">
                      {highlightMentions(m.content, memberUsernames).map((part) => {
                        if (part.type === 'mention') {
                          return (
                            <span key={part.key} className="mention-tag">
                              {part.text}
                            </span>
                          );
                        }
                        return linkifyParts(part.text).map((p, j) =>
                          p.type === 'link' ? (
                            <a key={`${part.key}-${j}`} href={p.text} target="_blank" rel="noopener noreferrer">
                              {p.text}
                            </a>
                          ) : (
                            <span key={`${part.key}-${j}`}>{p.text}</span>
                          )
                        );
                      })}
                    </div>
                  )
                )}
                <div className="bubble-meta">
                  <span>{formatMessageTime(m.created_at)}</span>
                  {m.edited_at && !m.deleted_at && <span className="edited-tag">edited</span>}
                  {m.expires_at && !m.deleted_at && (
                    <span className="edited-tag" title="Disappearing message">
                      ⏱
                    </span>
                  )}
                </div>

                {(reactionsByMessage[m.id] || []).length > 0 && (
                  <div className="reaction-chips">
                    {Object.entries(
                      (reactionsByMessage[m.id] || []).reduce((acc, r) => {
                        if (!acc[r.emoji]) acc[r.emoji] = { count: 0, mine: false };
                        acc[r.emoji].count += 1;
                        if (r.user_id === user.id) acc[r.emoji].mine = true;
                        return acc;
                      }, {})
                    ).map(([emoji, info]) => (
                      <button
                        key={emoji}
                        className={`reaction-chip ${info.mine ? 'mine' : ''}`}
                        onClick={() => handleReact(m.id, emoji)}
                      >
                        {emoji} {info.count}
                      </button>
                    ))}
                  </div>
                )}

                {isLastOfMine && seenByCount !== null && (
                  <div className="seen-by-text">{seenByCount > 0 ? `Seen by ${seenByCount}` : 'Sent'}</div>
                )}

              </div>
              </div>
            </div>
          );
        })}
        {pendingHere.map((p) => <PendingBubble key={p.id} item={p} userId={user.id} />)}
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

      {mentionSuggestions.length > 0 && (
        <div className="mention-suggestions">
          {mentionSuggestions.map((m) => (
            <button key={m.id} type="button" onClick={() => pickMention(m.username)}>
              <Avatar url={m.avatar_url} name={m.username} size={22} />
              {m.username}
            </button>
          ))}
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
          placeholder="Message the group... (@ to mention)"
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
    </div>
  );
}
