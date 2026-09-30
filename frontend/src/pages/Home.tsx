import React, { useState, useEffect } from 'react';
import { 
  Video, Sparkles, X, Loader2, Link2, Plus, LogIn, 
  Tv, MessageSquare, Mic, ShieldCheck, Zap, Heart, CheckCircle2, ChevronDown, ChevronUp
} from 'lucide-react';
import exampleImg from '../Example.png';
import { ApiService } from '../services/api';

interface HomeProps {
  initialRoomCode?: string | null;
  onJoinRoom: (code: string, name: string) => void;
  onRoomCreated: (roomId: string, hostName: string, hostSecret: string) => void;
  onReconnectHost: (roomId: string, hostName: string) => void;
}

export const Home: React.FC<HomeProps> = ({ initialRoomCode, onJoinRoom, onRoomCreated, onReconnectHost }) => {
  // Join Room Form state
  const [roomCode, setRoomCode] = useState(initialRoomCode || '');
  const [userName, setUserName] = useState('');
  const [error, setError] = useState('');
  const [savedHostSession, setSavedHostSession] = useState<{ roomId: string; hostName: string } | null>(null);

  // Popups state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(Boolean(initialRoomCode));

  // Create room modal form state
  const [createHostName, setCreateHostName] = useState('');
  const [isTemporary, setIsTemporary] = useState(true);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Update roomCode and show modal if initialRoomCode changes
  useEffect(() => {
    if (initialRoomCode) {
      setRoomCode(initialRoomCode);
      setShowJoinModal(true);
    }
  }, [initialRoomCode]);

  // FAQ accordion state
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('watchparty_host_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.roomId && parsed.hostName) {
          setSavedHostSession(parsed);
        }
      }
    } catch {
      // Ignore parse error
    }
  }, []);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim() || !userName.trim()) {
      setError('Ingresa tu nombre y código');
      return;
    }
    setError('');
    setShowJoinModal(false);
    onJoinRoom(roomCode.trim().toUpperCase(), userName.trim());
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createHostName.trim()) {
      setCreateError('Por favor ingresa tu nombre');
      return;
    }

    try {
      setCreateLoading(true);
      setCreateError('');
      const data = await ApiService.createRoom(createHostName.trim(), isTemporary);
      setShowCreateModal(false);
      onRoomCreated(data.roomId, data.hostName, data.hostSecret);
    } catch (err: any) {
      setCreateError(err.message || 'Error al conectar con el servidor.');
    } finally {
      setCreateLoading(false);
    }
  };

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const faqs = [
    {
      q: '¿Cómo funciona la sincronización de video?',
      a: 'El anfitrión tiene el control del reproductor. Cada vez que reproduce, pausa o adelanta la película, se envía una señal en milisegundos mediante WebSockets para que todos los espectadores vean exactamente el mismo frame sin desfases.'
    },
    {
      q: '¿Necesito instalar algún programa o extensión?',
      a: 'No, Watch Party funciona 100% en el navegador web (Chrome, Firefox, Edge, Safari y navegadores móviles) sin extensiones, descargas ni registros obligatorios.'
    },
    {
      q: '¿Qué formatos de video son compatibles?',
      a: 'Puedes subir archivos de video locales en formatos populares como MP4, WebM, MKV, entre otros, disfrutando de reproducción fluida y de alta calidad.'
    },
    {
      q: '¿Cómo funcionan la voz y las cámaras?',
      a: 'Utilizamos tecnología WebRTC punto a punto (P2P), lo que garantiza audio y video en tiempo real de baja latencia sin saturar servidores externos.'
    }
  ];

  return (
    <div className="home-hero-layout">
      {/* Top Tagline */}
      <div className="home-hero-badge">
        <Sparkles size={14} />
        <span>CINE • SERIES • VIDEOS EN TIEMPO REAL</span>
      </div>

      {/* Main Two-Column Container (Text + Actions on Left, Showcase Image on Right) */}
      <div className="home-hero-grid">
        {/* Left Column: Title, Subtitle, Reconnect banner & Action Buttons */}
        <div className="home-hero-left">
          <h1 className="home-hero-title">
            Cine en grupo,&nbsp;<span className="home-hero-title--accent">sin importar la distancia</span>
          </h1>

          <p className="home-hero-desc">
            Sincroniza películas, series y videos con videollamada HD, chat interactivo en tiempo real y reacciones flotantes al instante.
          </p>

          {/* Reconnect notice if host */}
          {savedHostSession && (
            <div className="home-reconnect-card">
              <div className="home-reconnect-card__left">
                <div className="home-reconnect-card__icon-wrap">
                  <span>👑</span>
                </div>
                <div className="home-reconnect-card__text">
                  <div className="home-reconnect-card__title">
                    Tu sala activa: <span className="home-reconnect-card__code">{savedHostSession.roomId}</span>
                  </div>
                  <div className="home-reconnect-card__subtitle">
                    Anfitrión: <strong>{savedHostSession.hostName}</strong>
                  </div>
                </div>
              </div>
              <div className="home-reconnect-card__actions">
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('watchparty_host_session');
                    setSavedHostSession(null);
                  }}
                  className="home-reconnect-card__dismiss-btn"
                  title="Descartar sala"
                >
                  <X size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => onReconnectHost(savedHostSession.roomId, savedHostSession.hostName)}
                  className="home-reconnect-card__enter-btn"
                >
                  Reingresar
                </button>
              </div>
            </div>
          )}

          {/* Clean Action Buttons (Create Popup trigger + Join Popup trigger) */}
          <div className="home-hero-actions">
            <button
              type="button"
              onClick={() => { setShowCreateModal(true); setCreateError(''); }}
              className="home-hero-btn home-hero-btn--primary"
            >
              <Video size={18} />
              <span>Crear una sala de cine</span>
            </button>

            <button
              type="button"
              onClick={() => { setShowJoinModal(true); setError(''); }}
              className="home-hero-btn home-hero-btn--secondary"
            >
              <Link2 size={18} />
              <span>Unirse a una sala</span>
            </button>
          </div>

          {/* Highlights Mini List */}
          <div className="home-hero-highlights">
            <div className="home-highlight-item">
              <CheckCircle2 size={16} className="text-primary-color" />
              <span>Sin registro previo</span>
            </div>
            <div className="home-highlight-item">
              <CheckCircle2 size={16} className="text-primary-color" />
              <span>Audio y video WebRTC</span>
            </div>
            <div className="home-highlight-item">
              <CheckCircle2 size={16} className="text-primary-color" />
              <span>Sincronización milimétrica</span>
            </div>
          </div>
        </div>

        {/* Right Column: Reference Showcase Frame (Example.png) */}
        <div className="home-hero-right">
          <div className="home-showcase-frame">
            <img
              src={exampleImg}
              alt="Watch Party Experiencia en Vivo"
              className="home-showcase-img"
            />
            <div className="home-showcase-overlay" />
          </div>
        </div>
      </div>

      {/* ── SECTION: Características Destacadas (Features) ── */}
      <section className="home-section">
        <div className="home-section__header">
          <span className="home-section__badge">Potencia y Simplicidad</span>
          <h2 className="home-section__title">Todo lo que necesitas para una noche de cine perfecta</h2>
          <p className="home-section__subtitle">
            Diseñado para ofrecer una experiencia fluida e inmersiva sin complicaciones técnicas.
          </p>
        </div>

        <div className="home-features-grid">
          <div className="home-feature-card">
            <div className="home-feature-icon-wrap" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
              <Zap size={24} />
            </div>
            <h3 className="home-feature-title">Sincronización Ultra Rápida</h3>
            <p className="home-feature-desc">
              Reproduce, pausa o adelanta. Todos los miembros de la sala verán el cambio de manera sincronizada y simultánea.
            </p>
          </div>

          <div className="home-feature-card">
            <div className="home-feature-icon-wrap" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
              <Mic size={24} />
            </div>
            <h3 className="home-feature-title">Voz y Video en Vivo</h3>
            <p className="home-feature-desc">
              Habla con tus amigos mediante micrófonos y cámaras WebRTC de alta calidad mientras disfrutan de la película.
            </p>
          </div>

          <div className="home-feature-card">
            <div className="home-feature-icon-wrap" style={{ background: 'rgba(236, 72, 153, 0.15)', color: '#f472b6' }}>
              <Heart size={24} />
            </div>
            <h3 className="home-feature-title">Reacciones Flotantes</h3>
            <p className="home-feature-desc">
              Expresa tus emociones con emojis animados flotantes sobre la pantalla que todos pueden ver en tiempo real.
            </p>
          </div>

          <div className="home-feature-card">
            <div className="home-feature-icon-wrap" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' }}>
              <MessageSquare size={24} />
            </div>
            <h3 className="home-feature-title">Chat en Directo</h3>
            <p className="home-feature-desc">
              Comparte comentarios, bromas y opiniones al instante mediante el panel lateral integrado de mensajería.
            </p>
          </div>

          <div className="home-feature-card">
            <div className="home-feature-icon-wrap" style={{ background: 'rgba(14, 165, 233, 0.15)', color: '#38bdf8' }}>
              <Tv size={24} />
            </div>
            <h3 className="home-feature-title">Sube tus Propios Videos</h3>
            <p className="home-feature-desc">
              Sube tus películas y videos directamente a la sala con barra de progreso y streaming optimizado.
            </p>
          </div>

          <div className="home-feature-card">
            <div className="home-feature-icon-wrap" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' }}>
              <ShieldCheck size={24} />
            </div>
            <h3 className="home-feature-title">Salas Privadas y Seguras</h3>
            <p className="home-feature-desc">
              Acceso mediante códigos únicos de sala. Tú decides a quién invitar y gestionas los permisos de anfitrión.
            </p>
          </div>
        </div>
      </section>

      {/* ── SECTION: Cómo Funciona (Steps) ── */}
      <section className="home-section home-section--steps">
        <div className="home-section__header">
          <span className="home-section__badge">Paso a Paso</span>
          <h2 className="home-section__title">¿Cómo empezar en menos de 1 minuto?</h2>
          <p className="home-section__subtitle">
            Tan fácil como crear, compartir el código y empezar a disfrutar.
          </p>
        </div>

        <div className="home-steps-grid">
          <div className="home-step-card">
            <div className="home-step-number">01</div>
            <h4 className="home-step-title">Crea tu Sala</h4>
            <p className="home-step-desc">
              Haz clic en "Crear una sala de cine", pon tu nombre y obtendrás un código único para tu sesión.
            </p>
          </div>

          <div className="home-step-card">
            <div className="home-step-number">02</div>
            <h4 className="home-step-title">Invita a tus Amigos</h4>
            <p className="home-step-desc">
              Comparte el código de la sala o el enlace directo para que tus invitados se unan con un solo clic.
            </p>
          </div>

          <div className="home-step-card">
            <div className="home-step-number">03</div>
            <h4 className="home-step-title">Sube y Disfruta</h4>
            <p className="home-step-desc">
              Carga tu archivo de video o película, activa tu cámara o micrófono y dale al Play juntos.
            </p>
          </div>
        </div>
      </section>

      {/* ── SECTION: Preguntas Frecuentes (FAQ) ── */}
      <section className="home-section">
        <div className="home-section__header">
          <span className="home-section__badge">Dudas Comunes</span>
          <h2 className="home-section__title">Preguntas Frecuentes</h2>
          <p className="home-section__subtitle">
            Resolvemos las preguntas más habituales sobre el funcionamiento de la plataforma.
          </p>
        </div>

        <div className="home-faq-list">
          {faqs.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div 
                key={idx} 
                className={`home-faq-item ${isOpen ? 'home-faq-item--open' : ''}`}
                onClick={() => toggleFaq(idx)}
              >
                <div className="home-faq-question">
                  <span>{faq.q}</span>
                  {isOpen ? <ChevronUp size={20} className="home-faq-icon" /> : <ChevronDown size={20} className="home-faq-icon" />}
                </div>
                {isOpen && (
                  <div className="home-faq-answer">
                    <p>{faq.a}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── SECTION: CTA Final ── */}
      <section className="home-cta-banner">
        <div className="home-cta-content">
          <h2 className="home-cta-title">¿Listo para tu próxima función?</h2>
          <p className="home-cta-desc">Crea una sala ahora mismo y reúne a tus amigos sin costo ni registros.</p>
          <div className="home-cta-actions">
            <button
              type="button"
              onClick={() => { setShowCreateModal(true); setCreateError(''); }}
              className="home-hero-btn home-hero-btn--primary"
            >
              <Video size={18} />
              <span>Crear sala ahora</span>
            </button>
            <button
              type="button"
              onClick={() => { setShowJoinModal(true); setError(''); }}
              className="home-hero-btn home-hero-btn--secondary"
            >
              <Link2 size={18} />
              <span>Ingresar con código</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── Modal Pop-up: Crear Nueva Sala ── */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-card host-exit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-card__header">
              <div className="host-exit-modal__title-wrap">
                <div className="host-exit-modal__icon-badge" style={{ background: 'rgba(99, 102, 241, 0.15)', borderColor: 'rgba(99, 102, 241, 0.35)' }}>
                  <Plus size={18} color="#818cf8" />
                </div>
                <h3 className="host-exit-modal__title">Crear una nueva sala</h3>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="meet-drawer__close-btn" title="Cerrar">
                <X size={18} />
              </button>
            </div>

            <p className="host-exit-modal__desc">
              Tú serás el anfitrión (Host) y tendrás el control inicial de la sincronización del video y los controles de reproducción.
            </p>

            {createError && (
              <div style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '1rem', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '0.65rem 0.85rem', borderRadius: '10px' }}>
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit}>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-group__label" style={{ color: '#cbd5e1', fontWeight: 600 }}>Tu nombre como Anfitrión</label>
                <input
                  type="text"
                  className="form-group__input"
                  placeholder="Ej. Roberto"
                  value={createHostName}
                  onChange={(e) => setCreateHostName(e.target.value)}
                  disabled={createLoading}
                  autoFocus
                  required
                />
              </div>

              {/* Modo de sala: Temporal vs Guardar Video */}
              <div className="form-group" style={{ marginBottom: '1.25rem', background: 'rgba(255, 255, 255, 0.04)', padding: '0.85rem', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f3f4f6' }}>
                    {isTemporary ? '⚡ Sala Temporal' : '💾 Sala Persistente'}
                  </span>
                  <label className="part-switch" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={isTemporary}
                      onChange={(e) => setIsTemporary(e.target.checked)}
                    />
                    <span className="part-slider" />
                  </label>
                </div>
                <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: 0, lineHeight: 1.4 }}>
                  {isTemporary
                    ? 'Al cerrar la sala se borra el video y la sala automáticamente (ideal para videos pesados o funciones rápidas).'
                    : 'El video se conserva subido en el servidor para futuras sesiones.'}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="host-exit-modal__cancel-btn"
                  style={{ marginTop: 0, flex: 1 }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={createLoading}
                  style={{ flex: 1.4, padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)' }}
                >
                  {createLoading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Creando...
                    </>
                  ) : (
                    <>
                      <Video size={18} />
                      Iniciar sala
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal Pop-up: Unirse a Sala ── */}
      {showJoinModal && (
        <div className="modal-overlay" onClick={() => setShowJoinModal(false)}>
          <div className="modal-card host-exit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-card__header">
              <div className="host-exit-modal__title-wrap">
                <div className="host-exit-modal__icon-badge" style={{ background: 'rgba(99, 102, 241, 0.15)', borderColor: 'rgba(99, 102, 241, 0.35)' }}>
                  <Link2 size={18} color="#818cf8" />
                </div>
                <h3 className="host-exit-modal__title">
                  {initialRoomCode ? `Unirse a la sala ${roomCode}` : 'Unirse a una sala'}
                </h3>
              </div>
              <button onClick={() => setShowJoinModal(false)} className="meet-drawer__close-btn" title="Cerrar">
                <X size={18} />
              </button>
            </div>

            <p className="host-exit-modal__desc">
              {initialRoomCode
                ? `Ingresa tu nombre de usuario para unirte de inmediato a la sala ${roomCode}.`
                : 'Ingresa tu nombre y el código de sala que te compartió el anfitrión.'}
            </p>

            {error && (
              <div style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '1rem', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '0.65rem 0.85rem', borderRadius: '10px' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleJoinSubmit}>
              <div className="form-group" style={{ marginBottom: initialRoomCode ? '1.25rem' : '0.85rem' }}>
                <label className="form-group__label" style={{ color: '#cbd5e1', fontWeight: 600 }}>Tu nombre de usuario</label>
                <input
                  type="text"
                  className="form-group__input"
                  placeholder="Ej. Roberto"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {!initialRoomCode && (
                <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                  <label className="form-group__label" style={{ color: '#cbd5e1', fontWeight: 600 }}>Código de sala</label>
                  <input
                    type="text"
                    className="form-group__input"
                    placeholder="Ej. 8FK29X"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    maxLength={8}
                    style={{ textTransform: 'uppercase' }}
                    required
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="host-exit-modal__cancel-btn"
                  style={{ marginTop: 0, flex: 1 }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  style={{ flex: 1.4, padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)' }}
                >
                  <LogIn size={18} />
                  Entrar a la sala
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <footer className="home-footer">
        <div className="home-footer__inner">
          <div className="home-footer__brand">
            <Video size={20} color="#818cf8" />
            <span>Watch Party</span>
          </div>
          <p className="home-footer__tagline">
            Más que ver películas, es compartir momentos. Sincronización en tiempo real y videollamada HD.
          </p>
          <div className="home-ref-footer-text">
            © {new Date().getFullYear()} Watch Party • Diseñado con ❤️ para ver cine juntos.
          </div>
        </div>
      </footer>
    </div>
  );
};

