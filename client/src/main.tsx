import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { SocketProvider } from './context/SocketContext.tsx';
import { TerminalRecordingProvider } from './context/TerminalRecordingContext.tsx';
import './index.css';

const envMatch = window.location.pathname.match(/^\/(local|vps)/);
const basename = envMatch ? envMatch[0] : '';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <SocketProvider>
          <TerminalRecordingProvider>
            <App />
          </TerminalRecordingProvider>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
