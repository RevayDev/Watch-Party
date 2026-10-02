import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ApiService } from '../services/api';

interface CreateRoomProps {
  onBack: () => void;
  onRoomCreated: (roomId: string, hostName: string, hostSecret: string) => void;
}

export const CreateRoom: React.FC<CreateRoomProps> = ({ onBack, onRoomCreated }) => {
  const [hostName, setHostName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostName.trim()) {
      setError('Por favor ingresa tu nombre');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const data = await ApiService.createRoom(hostName.trim());
      onRoomCreated(data.roomId, data.hostName, data.hostSecret);
    } catch (err: any) {
      setError(err.message || 'Error al conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="card card--center">
        <button
          type="button"
          onClick={onBack}
          className="btn btn--secondary"
          style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', marginBottom: '1.5rem', alignSelf: 'flex-start' }}
        >
          Volver
        </button>

        <h2 style={{ marginBottom: '0.5rem', fontSize: '1.6rem' }}>Crear una nueva sala</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
          Tú serás el anfitrión (Host) y tendrás el control inicial de la reproducción.
        </p>

        {error && (
          <div style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginBottom: '1rem', background: 'rgba(239, 68, 68, 0.1)', padding: '0.6rem', borderRadius: '8px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-group__label">Tu nombre como Anfitrión</label>
            <input
              type="text"
              className="form-group__input"
              placeholder="Ej. Roberto"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn--primary btn--full"
            disabled={loading}
            style={{ marginTop: '1rem' }}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Creando sala...
              </>
            ) : (
              'Iniciar sala'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
