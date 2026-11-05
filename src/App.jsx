import { lazy, Suspense, useState } from 'react';
import { useAuth } from './contexts/AuthContext.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
import IncomingCallModal from './components/IncomingCallModal.jsx';
import ActiveCallScreen from './components/ActiveCallScreen.jsx';
import GroupCallScreen from './components/GroupCallScreen.jsx';
import InstallPrompt from './components/InstallPrompt.jsx';
import UpdatePrompt from './components/UpdatePrompt.jsx';
import MfaChallenge from './pages/MfaChallenge.jsx';
import { useModalA11y } from './hooks/useModalA11y.js';

export default function App() {
  const { user, loading, recoveryMode, mfaChecking, mfaRequired } = useAuth();
  useModalA11y();
  // Only relevant while logged out: show the marketing landing page
  // first, then move to the actual login/signup form once the visitor
  // taps a call-to-action.
  const [showAuth, setShowAuth] = useState(false);

  if (loading) {
    return <div className="center-screen">Loading...</div>;
  }

  // A password-reset email link logs the user in via a special "recovery"
  // session — intercept that before showing the normal dashboard so they
  // land on the "set a new password" screen instead.
  if (recoveryMode) {
    return (
      <Suspense fallback={<div className="center-screen">Loading...</div>}>
        <ResetPassword />
      </Suspense>
    );
  }

  // Logged in, but we're still checking whether a two-step code is needed
  if (user && mfaChecking) {
    return <div className="center-screen">Loading...</div>;
  }

  let content;
  if (user && mfaRequired) {
    content = <MfaChallenge />;
  } else if (user) {
    content = (
      <>
        <Dashboard />
        <IncomingCallModal />
        <ActiveCallScreen />
        <GroupCallScreen />
      </>
    );
  } else if (!showAuth) {
    content = <Landing onGetStarted={() => setShowAuth(true)} onLogin={() => setShowAuth(true)} />;
  } else {
    content = <Login onBackToLanding={() => setShowAuth(false)} />;
  }

  return (
    <>
      {content}
      {/* Shows on every screen — landing, login, or the app itself —
          once the browser signals the site is installable. */}
      <InstallPrompt />
      <UpdatePrompt />
    </>
  );
}
