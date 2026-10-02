import React, { useState, useEffect } from 'react';
import { Home } from './pages/Home';
import { CreateRoom } from './pages/CreateRoom';
import { Room } from './pages/Room';
import { ApiService } from './services/api';
import { saveRecentRoom, removeRecentRoom } from './services/recentRooms';
import { NotificationProvider, notify } from './services/notifications';

type ViewState = 'home' | 'create' | 'room';

export const App: React.FC = () => {
  const [view, setView] = useState<ViewState>('home');
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [isHost, setIsHost] = useState<boolean>(false);

  // Parse URL if roomId query exists or restore active session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setCurrentRoomId(roomParam.toUpperCase());
    }
  }, []);

  const handleBackToHome = () => {
    window.history.pushState({}, '', window.location.pathname);
    setView('home');
    setCurrentRoomId(null);
  };

  const handleRoomCreated = (roomId: string, hostName: string, _hostSecret: string) => {
    // Persist host session
    localStorage.setItem('watchparty_host_session', JSON.stringify({ roomId, hostName }));
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
      localStorage.removeItem('watchparty_host_session');
      removeRecentRoom(roomId);
      notify('error', `La sala ${roomId} ya no existe o fue eliminada. Crea una nueva sala.`, 'Sala no disponible');
      return;
    }
    localStorage.setItem('watchparty_host_session', JSON.stringify({ roomId, hostName }));
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

      {view === 'create' && (
        <CreateRoom
          onBack={handleBackToHome}
          onRoomCreated={handleRoomCreated}
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
      </div>
    </NotificationProvider>
  );
};
export default App;
