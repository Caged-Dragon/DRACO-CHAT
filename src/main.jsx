import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import { PresenceProvider } from './contexts/PresenceContext.jsx';
import { ChatPrefsProvider } from './contexts/ChatPrefsContext.jsx';
import { UnreadProvider } from './contexts/UnreadContext.jsx';
import { CallProvider } from './contexts/CallContext.jsx';
import { GroupCallProvider } from './contexts/GroupCallContext.jsx';
import { StatusProvider } from './contexts/StatusContext.jsx';
import { installErrorReporter } from './utils/errorReporter.js';
import './styles.css';
import './layout.css';
import './chat-ui.css';

installErrorReporter();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <PresenceProvider>
          <ChatPrefsProvider>
          <UnreadProvider>
            <CallProvider>
              <GroupCallProvider>
                <StatusProvider>
                  <App />
                </StatusProvider>
              </GroupCallProvider>
            </CallProvider>
          </UnreadProvider>
          </ChatPrefsProvider>
        </PresenceProvider>
      </ThemeProvider>
    </AuthProvider>
  </React.StrictMode>
);
