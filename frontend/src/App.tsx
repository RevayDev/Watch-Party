import React, { useState, useEffect, useCallback } from 'react';
import { Home } from './features/home/Home';
import { Room } from './features/room/Room';
import { StatusPage } from './features/status/StatusPage';
import { AdminPage } from './features/admin/AdminPage';
import { ApiService } from './services/api';
import { saveRecentRoom, removeRecentRoom } from './services/recentRooms';
import { NotificationProvider, notify } from './services/notifications';
import { STORAGE_KEYS } from './shared/constants';
import { saveHostSession } from './shared/utils';

type ViewState = 'home' | 'room' | 'status' | 'admin';

/** Ruta manual (sin router): `/status`, `/admin`, `?room=` o `/`. */
function routeFromLocation(): { view: ViewState; roomId: string | null } {
  if (typeof window === 'undefined') return { view: 'home', roomId: null };
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  if (path === '/status') return { view: 'status', roomId: null };
  if (path === '/admin') return { view: 'admin', roomId: null };
  const roomParam = new URLSearchParams(window.location.search).get('room');
  return { view: 'home', roomId: roomParam ? roomParam.toUpperCase() : null };
}

export const App: React.FC = () => {
  const [view, setView] = useState<ViewState>('home');
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [isHost, setIsHost] = useState<boolean>(false);

  // Parse URL if roomId query exists or restore active session.
  // También respeta rutas manuales `/status` y `/admin` (con popstate).
  useEffect(() => {
    const applyRoute = () => {
      const route = routeFromLocation();
      if (route.view === 'status' || route.view === 'admin') {
        setView(route.view);
        setCurrentRoomId(null);
        return;
      }
      if (route.roomId) setCurrentRoomId(route.roomId);
    };
    applyRoute();
    window.addEventListener('popstate', applyRoute);
    return () => window.removeEventListener('popstate', applyRoute);
  }, []);

  const navigate = useCallback((path: '/' | '/status' | '/admin') => {
    window.history.pushState({}, '', path);
    if (path === '/status') {
      setView('status');
      setCurrentRoomId(null);
    } else if (path === '/admin') {
      setView('admin');
      setCurrentRoomId(null);
    } else {
      setView('home');
      setCurrentRoomId(null);
    }
  }, []);

  const handleBackToHome = () => {
    navigate('/');
  };

  const handleRoomCreated = (roomId: string, hostName: string, hostSecret: string) => {
    // Persist host session (incluye hostSecret para los endpoints/emits privilegiados)
    saveHostSession(roomId, hostName, hostSecret);
    saveRecentRoom(roomId, hostName, 'host');
    setCurrentRoomId(roomId);
    setCurrentUserName(hostName);
    setIsHost(true);
    setView('room');
    window.history.pushState({}, '', `?room=${roomId}`);
  };

  const handleReconnectHost = async (roomId: string, hostName: string) => {
    // Verify the room still exists before entering (it may have been deleted)
    try {
      await ApiService.getRoom(roomId);
    } catch {
      localStorage.removeItem(STORAGE_KEYS.HOST_SESSION);
      removeRecentRoom(roomId);
      notify('error', `La sala ${roomId} ya no existe o fue eliminada. Crea una nueva sala.`, 'Sala no disponible');
      return;
    }
    // (preserva el hostSecret ya guardado para esa sala, si existe)
    saveHostSession(roomId, hostName);
    saveRecentRoom(roomId, hostName, 'host');
    setCurrentRoomId(roomId);
    setCurrentUserName(hostName);
    setIsHost(true);
    setView('room');
    window.history.pushState({}, '', `?room=${roomId}`);
  };

  const handleJoinRoom = async (roomId: string, userName: string) => {
    try {
      await ApiService.joinRoom(roomId, userName);
      saveRecentRoom(roomId, userName, 'guest');
      setCurrentRoomId(roomId);
      setCurrentUserName(userName);
      setIsHost(false);
      setView('room');
      window.history.pushState({}, '', `?room=${roomId}`);
    } catch (err: any) {
      notify('error', err.message || 'No se pudo unir a la sala', 'Error al unirse');
    }
  };

  return (
    <NotificationProvider>
      <div className="app">
      {view === 'home' && (
        <Home
          initialRoomCode={currentRoomId}
          onJoinRoom={handleJoinRoom}
          onRoomCreated={handleRoomCreated}
          onReconnectHost={handleReconnectHost}
        />
      )}

      {view === 'room' && currentRoomId && (
        <Room
          roomId={currentRoomId}
          userName={currentUserName || 'Invitado'}
          isHost={isHost}
          onLeave={handleBackToHome}
        />
      )}

      {view === 'status' && <StatusPage onBack={handleBackToHome} />}

      {view === 'admin' && <AdminPage onBack={handleBackToHome} />}
      </div>
    </NotificationProvider>
  );
};
export default App;
