import { lazy, Suspense, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useOutboxFlusher } from '../hooks/useOutbox.js';
import FriendRequests from '../components/FriendRequests.jsx';
import FriendsList from '../components/FriendsList.jsx';
import SearchFriends from '../components/SearchFriends.jsx';
import ChatWindow from '../components/ChatWindow.jsx';
const SettingsModal = lazy(() => import('../components/SettingsModal.jsx'));
const ProfileModal = lazy(() => import('../components/ProfileModal.jsx'));
const CallHistoryModal = lazy(() => import('../components/CallHistoryModal.jsx'));
import GroupsList from '../components/GroupsList.jsx';
import GroupChatWindow from '../components/GroupChatWindow.jsx';
import Avatar from '../components/Avatar.jsx';
import StatusBar from '../components/StatusBar.jsx';
const GlobalSearchModal = lazy(() => import('../components/GlobalSearchModal.jsx'));

export default function Dashboard() {
  const { user, profile, signOut } = useAuth();
  const [activeFriend, setActiveFriend] = useState(null);
  const [activeGroup, setActiveGroup] = useState(null);
  // Bump this to force FriendsList / FriendRequests / GroupsList to refetch
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showCallHistory, setShowCallHistory] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);

  useOutboxFlusher(user?.id);

  const activeChat = activeFriend || activeGroup;
  // On mobile, "chat-open" swaps from the friends list to the full-screen
  // chat window. On desktop this class has no visual effect (see CSS).
  const shellClass = `app-shell${activeChat ? ' chat-open' : ''}`;

  function selectFriend(f) {
    setActiveGroup(null);
    setActiveFriend(f);
  }

  function selectGroup(g) {
    setActiveFriend(null);
    setActiveGroup(g);
  }

  return (
    <div className={shellClass}>
      <aside className="sidebar">
        <h1 className="sr-only">Dragon Chat</h1>
        <div className="sidebar-header">
          <div className="brand">
            <img src="/logo.png" alt="Dragon Chat" className="brand-logo" />
            <span className="brand-name">Dragon Chat</span>
          </div>
          <div className="sidebar-header-actions">
            <button className="settings-btn" onClick={() => setShowGlobalSearch(true)} aria-label="Search everything">
              🔍
            </button>
            <button className="settings-btn" onClick={() => setShowCallHistory(true)} aria-label="Call history">
              📞
            </button>
            <button className="settings-btn" onClick={() => setShowSettings(true)} aria-label="App settings">
              ⚙️
            </button>
            <button className="logout-btn" onClick={signOut}>
              Log out
            </button>
          </div>
        </div>

        <button className="me-row me-row-clickable" onClick={() => setShowProfile(true)}>
          <Avatar url={profile?.avatar_url} name={profile?.username} size={28} />
          <span>{profile?.username ?? 'you'}</span>
        </button>

        <StatusBar />

        <SearchFriends onRequestSent={bump} />
        <FriendRequests refreshKey={refreshKey} onChange={bump} />
        <FriendsList
          refreshKey={refreshKey}
          activeFriendId={activeFriend?.id}
          onSelectFriend={selectFriend}
        />
        <GroupsList refreshKey={refreshKey} activeGroupId={activeGroup?.id} onSelectGroup={selectGroup} />
      </aside>

      <main className="chat-area">
        {activeFriend ? (
          <ChatWindow friend={activeFriend} onBack={() => setActiveFriend(null)} />
        ) : activeGroup ? (
          <GroupChatWindow group={activeGroup} onBack={() => setActiveGroup(null)} />
        ) : (
          <div className="center-screen dim">Select a friend or group to start chatting</div>
        )}
      </main>

      <Suspense fallback={null}>
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
        {showCallHistory && <CallHistoryModal onClose={() => setShowCallHistory(false)} />}
        {showGlobalSearch && (
          <GlobalSearchModal
            onClose={() => setShowGlobalSearch(false)}
            onOpenFriend={selectFriend}
            onOpenGroup={selectGroup}
          />
        )}
      </Suspense>
    </div>
  );
}
