import React, { useState, useEffect, useRef } from "react";
import {
  Loader2,
  Video,
  Zap,
  Mic,
  PartyPopper,
  MessageCircle,
  ShieldCheck,
  Clock,
  Upload,
  Check,
  History,
  Crown,
  User,
  Plus,
  Minus,
  Heart,
  ExternalLink,
  Wallet,
  Lightbulb,
  Atom,
  Braces,
  Server,
  Radio,
  Network,
  Database,
  MonitorPlay,
  FolderUp,
  ArrowRight,
  WandSparkles,
} from "lucide-react";
import exampleImg from "../Example.png";
import { ApiService } from "../services/api";
import {
  getRecentRooms,
  removeRecentRoom,
  getLastUsername,
  RecentRoom,
} from "../services/recentRooms";
import { useSwipeDown } from "../hooks/useSwipeDown";
import { usePresence } from "../hooks/usePresence";
import { SheetHandle } from "../components/SheetHandle";

/**
 * Enlaces de donaciones.
 * Se configuran en `frontend/.env` (ver `frontend/.env.example`):
 *   VITE_PATREON_URL=https://www.patreon.com/tu_usuario
 *   VITE_PAYPAL_URL=https://www.paypal.com/paypalme/tu_usuario
 * Si están vacíos, las tarjetas se muestran como "Próximamente" (no clicables).
 */
const PATREON_URL =
  (import.meta.env.VITE_PATREON_URL as string | undefined)?.trim() || "";
const PAYPAL_URL =
  (import.meta.env.VITE_PAYPAL_URL as string | undefined)?.trim() || "";

const navLinks = [
  { href: "#funciones", label: "Funciones" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#tecnologias", label: "Tecnologías" },
  { href: "#roadmap", label: "Lo que viene" },
  { href: "#donaciones", label: "Donaciones" },
  { href: "#faq", label: "FAQ" },
];

const techStack = [
  { icon: Atom, name: "React 18", role: "Interfaz de usuario" },
  { icon: Braces, name: "TypeScript", role: "Tipado estático" },
  { icon: Zap, name: "Vite", role: "Compilación y HMR" },
  { icon: Server, name: "Node.js + Express", role: "API REST y subidas" },
  { icon: Radio, name: "Socket.IO", role: "Eventos en tiempo real" },
  { icon: Network, name: "WebRTC", role: "Audio y video P2P" },
  { icon: Database, name: "MongoDB + Mongoose", role: "Persistencia de salas" },
  { icon: MonitorPlay, name: "hls.js", role: "Streaming HLS adaptativo" },
  { icon: FolderUp, name: "Multer", role: "Subida de archivos" },
];

const roadmapItems = [
  {
    title: "Aplicación móvil (PWA)",
    desc: "Instalable en el teléfono con notificaciones y modo sin conexión.",
    status: "Planeado",
  },
  {
    title: "Subtítulos y pistas de audio",
    desc: "Cargar .srt junto al archivo y elegir idioma por participante.",
    status: "Planeado",
  },
  {
    title: "Listas de reproducción",
    desc: "Cola de varios archivos que el anfitrión reproduce en orden.",
    status: "En estudio",
  },
  {
    title: "Salas con contraseña",
    desc: "Acceso cerrado además del código y de la aprobación de entrada.",
    status: "Planeado",
  },
  {
    title: "Moderación avanzada",
    desc: "Silencios globales, expulsión rápida y desactivación de reacciones.",
    status: "En estudio",
  },
];

const timelineEvents = [
  {
    date: "Sept 2026",
    title: "Inicio del proyecto",
    desc: "Nace la idea para ver contenido audiovisual a distancia con amigos y familia, superando limitaciones de calidad y retrasos de apps tradicionales. Se inicia el monorepo con Express, Socket.IO, React, Vite y TypeScript.",
    status: "Completado",
    tone: "done" as const,
  },
  {
    date: "Sept 2026",
    title: "Sincronización y comunicación en vivo",
    desc: "Reproducción sincronizada por WebSockets para ver contenido al mismo tiempo, junto a chat en vivo y videollamadas WebRTC de baja latencia entre participantes.",
    status: "Completado",
    tone: "done" as const,
  },
  {
    date: "Oct 2026",
    title: "Salas con aprobación y control del anfitrión",
    desc: "Sistema de control para el creador: aprobación de solicitudes de entrada, permisos individuales de participantes, reacciones flotantes animadas y cierre automático por inactividad.",
    status: "Completado",
    tone: "done" as const,
  },
  {
    date: "Oct 2026",
    title: "Rediseño del Home",
    desc: "Renovación completa de la página principal: catálogo de tecnologías, línea de tiempo histórica, roadmap interactivo de funciones, vías de donación y pie de página completo.",
    status: "Completado",
    tone: "done" as const,
  },
  {
    date: "Oct 2026",
    title: "PWA, subtítulos y planes de mantenimiento",
    desc: "Evolución a Progressive Web App (PWA) instalable, soporte para subtítulos externos .srt y definición de planes de apoyo para servidores y almacenamiento.",
    status: "En curso",
    tone: "wip" as const,
  },
];

const donationCards = [
  {
    id: "patreon",
    icon: Heart,
    title: "Patreon",
    desc: "Apoyo mensual recurrente para pagar el servidor y priorizar nuevas funciones.",
    cta: "Apoyar en Patreon",
    url: PATREON_URL,
    tone: "rose" as const,
  },
  {
    id: "paypal",
    icon: Wallet,
    title: "PayPal",
    desc: "Una aportación única y sin compromiso para mantener el proyecto vivo.",
    cta: "Donar con PayPal",
    url: PAYPAL_URL,
    tone: "blue" as const,
  },
  {
    id: "roadmap",
    icon: WandSparkles,
    title: "Lo que queremos construir",
    desc: "Revisa el roadmap y decide qué función desarrollamos a continuación.",
    cta: "Ver lo que viene",
    url: "#roadmap",
    tone: "amber" as const,
  },
];

const features = [
  {
    icon: Zap,
    title: "Sincronización en Tiempo Real",
    desc: "Reproduce, pausa o adelanta. Todos los miembros de la sala ven el cambio de manera sincronizada y simultánea, sin desfases.",
  },
  {
    icon: Mic,
    title: "Voz y Video en Vivo",
    desc: "Habla con tus amigos mediante micrófonos y cámaras WebRTC de alta calidad mientras disfrutan del mismo archivo multimedia.",
  },
  {
    icon: PartyPopper,
    title: "Reacciones Flotantes",
    desc: "Expresa tus emociones con emojis animados flotando sobre la pantalla, visibles para todos en tiempo real.",
  },
  {
    icon: MessageCircle,
    title: "Chat en Directo",
    desc: "Comparte comentarios, bromas y opiniones al instante mediante el panel lateral integrado de mensajería.",
  },
  {
    icon: Upload,
    title: "Sube tus Archivos Multimedia",
    desc: "Carga tus propios videos desde el dispositivo o pega un enlace, con barra de progreso y streaming optimizado.",
  },
  {
    icon: ShieldCheck,
    title: "Salas Privadas con Aprobación",
    desc: "Acceso mediante códigos únicos y solicitud de entrada: el anfitrión aprueba o rechaza a cada invitado antes de entrar.",
  },
  {
    icon: Clock,
    title: "Salas Temporales o Persistentes",
    desc: "Elige si la sala se borra al cerrarse (ideal para archivos pesados) o si se conserva para futuras sesiones.",
  },
  {
    icon: Check,
    title: "Control del Anfitrión",
    desc: "Gestiona permisos, silencia participantes, transfiere el rol y define un temporizador de cierre automático para la sala.",
  },
];

interface HomeProps {
  initialRoomCode?: string | null;
  onJoinRoom: (code: string, name: string) => void;
  onRoomCreated: (roomId: string, hostName: string, hostSecret: string) => void;
  onReconnectHost: (roomId: string, hostName: string) => void;
}

export const Home: React.FC<HomeProps> = ({
  initialRoomCode,
  onJoinRoom,
  onRoomCreated,
  onReconnectHost,
}) => {
  // Join Room Form state
  const [roomCode, setRoomCode] = useState(initialRoomCode || "");
  const [userName, setUserName] = useState("");
  const [error, setError] = useState("");
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);
  const [isUrlInvite, setIsUrlInvite] = useState(Boolean(initialRoomCode));

  // Popups state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(Boolean(initialRoomCode));
  // Swipe-down-to-dismiss for the phone sheets
  const createSheetRef = useSwipeDown<HTMLDivElement>(
    () => setShowCreateModal(false),
    showCreateModal,
  );
  const joinSheetRef = useSwipeDown<HTMLDivElement>(
    () => setShowJoinModal(false),
    showJoinModal,
  );
  // Exit animations for the pop-up modals
  const createPresence = usePresence(showCreateModal);
  const joinPresence = usePresence(showJoinModal);

  // Create room modal form state
  const [createHostName, setCreateHostName] = useState("");
  const [isTemporary, setIsTemporary] = useState(true);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");

  // Update roomCode and show modal if initialRoomCode changes
  useEffect(() => {
    if (initialRoomCode) {
      setRoomCode(initialRoomCode);
      setIsUrlInvite(true);
      setShowJoinModal(true);
    }
  }, [initialRoomCode]);

  // FAQ accordion state
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [timelineEvent, setTimelineEvent] = useState<
    (typeof timelineEvents)[number] | null
  >(null);
  const timelineSheetRef = useSwipeDown<HTMLElement>(
    () => setTimelineEvent(null),
    Boolean(timelineEvent),
  );
  // Keep the last opened event so the sheet renders while its exit animation plays
  const timelinePresence = usePresence(Boolean(timelineEvent));
  const lastTimelineRef = useRef<(typeof timelineEvents)[number] | null>(null);
  if (timelineEvent) lastTimelineRef.current = timelineEvent;
  const timelineView = timelineEvent ?? lastTimelineRef.current;

  useEffect(() => {
    if (!timelineEvent) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTimelineEvent(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [timelineEvent]);

  useEffect(() => {
    setRecentRooms(getRecentRooms());
  }, []);

  const handleEnterRecentRoom = (room: RecentRoom) => {
    if (room.role === "host") {
      onReconnectHost(room.roomId, room.hostName);
      return;
    }
    const lastUsername = getLastUsername();
    if (lastUsername) {
      onJoinRoom(room.roomId, lastUsername);
      return;
    }
    setRoomCode(room.roomId);
    setIsUrlInvite(true);
    setShowJoinModal(true);
  };

  const handleRemoveRecentRoom = (roomId: string) => {
    removeRecentRoom(roomId);
    setRecentRooms(getRecentRooms());
  };

  const formatRelativeTime = (ts: number): string => {
    const diff = Date.now() - ts;
    if (diff < 0) return "ahora mismo";
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "ahora mismo";
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "ayer";
    if (days < 7) return `hace ${days} días`;
    return new Date(ts).toLocaleDateString([], {
      day: "2-digit",
      month: "short",
    });
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim() || !userName.trim()) {
      setError("Ingresa tu nombre y el código de la sala");
      return;
    }
    setError("");
    setShowJoinModal(false);
    onJoinRoom(roomCode.trim().toUpperCase(), userName.trim());
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createHostName.trim()) {
      setCreateError("Por favor ingresa tu nombre");
      return;
    }

    try {
      setCreateLoading(true);
      setCreateError("");
      const data = await ApiService.createRoom(
        createHostName.trim(),
        isTemporary,
      );
      setShowCreateModal(false);
      onRoomCreated(data.roomId, data.hostName, data.hostSecret);
    } catch (err: any) {
      setCreateError(err.message || "Error al conectar con el servidor.");
    } finally {
      setCreateLoading(false);
    }
  };

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const handleRoadmapShortcut = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const roadmap = document.getElementById("roadmap");
    if (!roadmap) return;

    roadmap.scrollIntoView({ behavior: "smooth", block: "start" });
    roadmap.setAttribute("tabindex", "-1");
    roadmap.focus({ preventScroll: true });
  };

  const faqs = [
    {
      q: "¿Cómo funciona la sincronización de video?",
      a: "El anfitrión tiene el control del reproductor. Cada vez que reproduce, pausa o adelanta el archivo, se envía una señal en milisegundos mediante WebSockets para que todos los espectadores vean exactamente el mismo frame sin desfases.",
    },
    {
      q: "¿Necesito instalar algún programa o extensión?",
      a: "No, Watch Party funciona 100% en el navegador web (Chrome, Firefox, Edge, Safari y navegadores móviles) sin extensiones, descargas ni registros obligatorios.",
    },
    {
      q: "¿Qué formatos de video son compatibles?",
      a: "Puedes subir archivos de video locales en formatos populares como MP4, WebM, MKV, entre otros, disfrutando de reproducción fluida y de alta calidad.",
    },
    {
      q: "¿Cómo funcionan la voz y las cámaras?",
      a: "Utilizamos tecnología WebRTC punto a punto (P2P), lo que garantiza audio y video en tiempo real de baja latencia sin saturar servidores externos.",
    },
  ];

  return (
    <div className="home-hero-layout" id="top">
      {/* ── Top Navigation ── */}
      <nav className="home-nav">
        <div className="home-nav__inner">
          <a className="home-nav__brand" href="#top">
            <span className="home-nav__logo" aria-hidden="true">
              <Video size={17} />
            </span>
            Watch Party
          </a>

          <div className="home-nav__links">
            {navLinks.map((link) => (
              <a key={link.href} className="home-nav__link" href={link.href}>
                {link.label}
              </a>
            ))}
          </div>

          <div className="home-nav__actions">
            <button
              type="button"
              className="home-nav__btn home-nav__btn--ghost"
              onClick={() => {
                setShowJoinModal(true);
                setIsUrlInvite(false);
                setError("");
              }}
            >
              Unirse
            </button>
            <button
              type="button"
              className="home-nav__btn home-nav__btn--primary"
              onClick={() => {
                setShowCreateModal(true);
                setCreateError("");
              }}
            >
              Crear sala
            </button>
          </div>
        </div>
      </nav>

      {/* Main Two-Column Container (Text + Actions on Left, Showcase Image on Right) */}
      <div className="home-hero-grid">
        {/* Left Column: Title, Subtitle, Reconnect banner & Action Buttons */}
        <div className="home-hero-left">
          <aside className="home-future-note" aria-label="Planes futuros">
            <Lightbulb size={18} strokeWidth={2.2} aria-hidden="true" />
            <p>
              A futuro se agregarán <strong>planes de apoyo</strong> para
              mantener el proyecto: servidor, almacenamiento y desarrollo de
              nuevas funciones.
            </p>
          </aside>

          <h1 className="home-hero-title">
            Tus videos,&nbsp;
            <span className="home-hero-title--accent">
              dondequiera que estén
            </span>
          </h1>

          <p className="home-hero-desc">
            Sincroniza tus archivos multimedia con videollamada HD, chat
            interactivo en tiempo real y reacciones flotantes al instante.
          </p>

          {/* Clean Action Buttons (Create Popup trigger + Join Popup trigger) */}
          <div className="home-hero-actions">
            <button
              type="button"
              onClick={() => {
                setShowCreateModal(true);
                setCreateError("");
              }}
              className="home-hero-btn home-hero-btn--primary"
            >
              <span>Crear una sala multimedia</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowJoinModal(true);
                setIsUrlInvite(false);
                setError("");
              }}
              className="home-hero-btn home-hero-btn--secondary"
            >
              <span>Unirse a una sala</span>
            </button>
          </div>

          {/* Highlights Mini List */}
          <div className="home-hero-highlights">
            <div className="home-highlight-item">
              <Check size={15} className="text-primary-color" />
              <span>Sin registro previo</span>
            </div>
            <div className="home-highlight-item">
              <Check size={15} className="text-primary-color" />
              <span>Audio y video WebRTC</span>
            </div>
            <div className="home-highlight-item">
              <Check size={15} className="text-primary-color" />
              <span>Aprobación de entrada</span>
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

      {/* Historial de salas recientes: ancho completo, bajo el texto y la imagen */}
      <div className="home-recent-card">
        <div className="home-recent-card__header">
          <span className="home-recent-card__title">
            <History size={15} strokeWidth={2.2} />
            Salas recientes
          </span>
          <span className="home-recent-card__hint">
            {recentRooms.length > 0
              ? "Entra de nuevo con un clic"
              : "Todavía sin historial"}
          </span>
        </div>

        {recentRooms.length === 0 ? (
          <div className="home-recent-empty">
            <span className="home-recent-empty__icon" aria-hidden="true">
              <History size={20} strokeWidth={1.8} />
            </span>
            <p className="home-recent-empty__title">No hay salas recientes</p>
            <p className="home-recent-empty__desc">
              Crea una sala o únete con un código: aparecerá aquí para entrar
              con un clic.
            </p>
          </div>
        ) : (
          <ul className="home-recent-list">
            {recentRooms.map((room) => (
              <li key={room.roomId} className="home-recent-item">
                <span
                  className={`home-recent-item__avatar home-recent-item__avatar--${room.role}`}
                  aria-hidden="true"
                >
                  {(room.hostName || "?").trim().charAt(0).toUpperCase()}
                </span>
                <div className="home-recent-item__info">
                  <div className="home-recent-item__top">
                    <span className="home-recent-item__code">
                      {room.roomId}
                    </span>
                    <span
                      className={`home-recent-item__role home-recent-item__role--${room.role}`}
                    >
                      {room.role === "host" ? (
                        <Crown size={11} strokeWidth={2.4} />
                      ) : (
                        <User size={11} strokeWidth={2.4} />
                      )}
                      {room.role === "host" ? "Anfitrión" : "Invitado"}
                    </span>
                  </div>
                  <span className="home-recent-item__meta">
                    {room.hostName} · {formatRelativeTime(room.lastJoined)}
                  </span>
                </div>
                <div className="home-recent-item__actions">
                  <button
                    type="button"
                    className="home-recent-item__enter-btn"
                    onClick={() => handleEnterRecentRoom(room)}
                  >
                    Entrar
                  </button>
                  <button
                    type="button"
                    className="home-recent-item__remove-btn"
                    title="Quitar de la lista"
                    aria-label={`Quitar la sala ${room.roomId} de la lista`}
                    onClick={() => handleRemoveRecentRoom(room.roomId)}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── SECTION: Características Destacadas (Features) ── */}
      <section className="home-section" id="funciones">
        <div className="home-section__header">
          <span className="home-section__badge">Potencia y Simplicidad</span>
          <h2 className="home-section__title">
            Todo lo que necesitas para ver archivos en grupo
          </h2>
          <p className="home-section__subtitle">
            Diseñado para ofrecer una experiencia fluida e inmersiva sin
            complicaciones técnicas.
          </p>
        </div>

        <div className="home-features-grid">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div className="home-feature-card" key={feature.title}>
                <span className="home-feature-icon" aria-hidden="true">
                  <Icon size={22} strokeWidth={2} />
                </span>
                <h3 className="home-feature-title">{feature.title}</h3>
                <p className="home-feature-desc">{feature.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── SECTION: Cómo Funciona (Steps) ── */}
      <section className="home-section home-section--steps" id="como-funciona">
        <div className="home-section__header">
          <span className="home-section__badge">Paso a Paso</span>
          <h2 className="home-section__title">
            ¿Cómo empezar en menos de 1 minuto?
          </h2>
          <p className="home-section__subtitle">
            Tan fácil como crear, compartir el código y empezar a disfrutar.
          </p>
        </div>

        <div className="home-steps-grid">
          <div className="home-step-card">
            <div className="home-step-number">01</div>
            <h4 className="home-step-title">Crea tu Sala</h4>
            <p className="home-step-desc">
              Haz clic en "Crear una sala multimedia", pon tu nombre y obtendrás
              un código único para tu sesión.
            </p>
          </div>

          <div className="home-step-card">
            <div className="home-step-number">02</div>
            <h4 className="home-step-title">Invita a tus Amigos</h4>
            <p className="home-step-desc">
              Comparte el código de la sala o el enlace directo para que tus
              invitados se unan con un solo clic.
            </p>
          </div>

          <div className="home-step-card">
            <div className="home-step-number">03</div>
            <h4 className="home-step-title">Sube y Disfruta</h4>
            <p className="home-step-desc">
              Carga tu archivo multimedia o pega un enlace, activa tu cámara o
              micrófono y dale al Play juntos.
            </p>
          </div>
        </div>
      </section>

      {/* ── SECTION: Tecnologías ── */}
      <section className="home-section" id="tecnologias">
        <div className="home-section__header">
          <span className="home-section__badge">Bajo el Capó</span>
          <h2 className="home-section__title">
            Tecnologías con las que está hecho
          </h2>
          <p className="home-section__subtitle">
            Sin dependencias propietarias ni plugins: solo estándares abiertos
            del navegador y un backend en Node.js.
          </p>
        </div>

        <div className="home-tech-grid">
          {techStack.map((tech) => {
            const Icon = tech.icon;
            return (
              <div className="home-tech-card" key={tech.name}>
                <span className="home-tech-card__icon" aria-hidden="true">
                  <Icon size={19} strokeWidth={2} />
                </span>
                <div className="home-tech-card__body">
                  <span className="home-tech-card__name">{tech.name}</span>
                  <span className="home-tech-card__role">{tech.role}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── SECTION: Línea de Tiempo ── */}
      <section className="home-section" id="timeline">
        <div className="home-section__header">
          <span className="home-section__badge">Historia</span>
          <h2 className="home-section__title">Línea de tiempo</h2>
          <p className="home-section__subtitle">
            Del primer commit a la plataforma actual: lo que ya está hecho y lo
            que estamos construyendo.
          </p>
        </div>

        <div className="home-timeline-scroll">
          <ol className="home-timeline">
            {timelineEvents.map((event) => (
              <li
                className={`home-timeline__item ${
                  event.tone === "wip"
                    ? "home-timeline__item--now"
                    : "home-timeline__item--past"
                }`}
                key={event.title}
              >
                <div className="home-timeline__head">
                  <span className="home-timeline__date">{event.date}</span>
                  <span className={`home-status home-status--${event.tone}`}>
                    {event.status}
                  </span>
                </div>
                <div className="home-timeline__track" aria-hidden="true">
                  <span
                    className={`home-timeline__dot home-timeline__dot--${event.tone}`}
                  />
                </div>
                <button
                  type="button"
                  className={`home-timeline__body home-timeline__body--${event.tone}`}
                  onClick={() => setTimelineEvent(event)}
                  aria-label={`Ver detalles de ${event.title}`}
                >
                  <span className="home-timeline__title">{event.title}</span>
                  <span className="home-timeline__desc">{event.desc}</span>
                  <span className="home-timeline__more">
                    Ver detalles
                    <ArrowRight size={13} strokeWidth={2.4} />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── SECTION: Roadmap (Lo que viene) ── */}
      <section className="home-section" id="roadmap">
        <div className="home-section__header">
          <span className="home-section__badge">Roadmap</span>
          <h2 className="home-section__title">Lo que queremos construir</h2>
          <p className="home-section__subtitle">
            Tu aporte y tus comentarios deciden el orden de esta lista.
          </p>
        </div>

        <div className="home-table-wrap">
          <table className="home-table">
            <thead>
              <tr>
                <th scope="col">Función</th>
                <th scope="col">Estado</th>
                <th scope="col">Descripción</th>
              </tr>
            </thead>
            <tbody>
              {roadmapItems.map((item) => (
                <tr key={item.title}>
                  <td className="home-table__name">{item.title}</td>
                  <td>
                    <span
                      className={`home-status ${item.status === "En estudio" ? "home-status--wip" : ""}`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="home-table__desc">{item.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Tarjetas automáticas para móvil */}
          <div className="home-roadmap-cards">
            {roadmapItems.map((item) => (
              <div className="home-roadmap-card" key={item.title}>
                <div className="home-roadmap-card__top">
                  <h4 className="home-roadmap-card__title">{item.title}</h4>
                  <span
                    className={`home-status ${item.status === "En estudio" ? "home-status--wip" : ""}`}
                  >
                    {item.status}
                  </span>
                </div>
                <p className="home-roadmap-card__desc">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION: Preguntas Frecuentes (FAQ) ── */}
      <section className="home-section" id="faq">
        <div className="home-section__header">
          <span className="home-section__badge">Dudas Comunes</span>
          <h2 className="home-section__title">Preguntas Frecuentes</h2>
          <p className="home-section__subtitle">
            Resolvemos las preguntas más habituales sobre el funcionamiento de
            la plataforma.
          </p>
        </div>

        <div className="home-faq-list">
          {faqs.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={idx}
                className={`home-faq-item ${isOpen ? "home-faq-item--open" : ""}`}
                onClick={() => toggleFaq(idx)}
              >
                <div className="home-faq-question">
                  <span>{faq.q}</span>
                  <span className="home-faq-icon">
                    {isOpen ? <Minus size={18} /> : <Plus size={18} />}
                  </span>
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
          <h2 className="home-cta-title">¿Listo para tu próxima sesión?</h2>
          <p className="home-cta-desc">
            Crea una sala ahora mismo y reúne a tus amigos sin costo ni
            registros.
          </p>
          <div className="home-cta-actions">
            <button
              type="button"
              onClick={() => {
                setShowCreateModal(true);
                setCreateError("");
              }}
              className="home-hero-btn home-hero-btn--primary"
            >
              <span>Crear sala ahora</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowJoinModal(true);
                setError("");
              }}
              className="home-hero-btn home-hero-btn--secondary"
            >
              <span>Ingresar con código</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── SECTION: Donaciones ── */}
      <section className="home-section home-donate" id="donaciones">
        <div className="home-section__header">
          <span className="home-section__badge">Apóyanos</span>
          <h2 className="home-section__title">Apoya el proyecto</h2>
          <p className="home-section__subtitle">
            Watch Party es gratuito y sin anuncios. Tu aporte ayuda a pagar el
            servidor y a desarrollar las funciones del roadmap.
          </p>
        </div>

        <div className="home-donate-grid">
          {donationCards.map((card) => {
            const Icon = card.icon;
            const isExternal = card.url.startsWith("http");
            const isReady = Boolean(card.url);

            const content = (
              <>
                <span
                  className={`home-donate-card__icon home-donate-card__icon--${card.tone}`}
                  aria-hidden="true"
                >
                  <Icon size={20} strokeWidth={2} />
                </span>
                <span className="home-donate-card__title">{card.title}</span>
                <span className="home-donate-card__desc">{card.desc}</span>
                <span className="home-donate-card__cta">
                  {isReady ? card.cta : "Próximamente"}
                  {isReady &&
                    (isExternal ? (
                      <ExternalLink size={14} />
                    ) : (
                      <ArrowRight size={14} />
                    ))}
                </span>
              </>
            );

            if (!isReady) {
              return (
                <div
                  key={card.id}
                  className="home-donate-card home-donate-card--pending"
                  aria-disabled="true"
                >
                  {content}
                </div>
              );
            }

            return (
              <a
                key={card.id}
                className="home-donate-card"
                href={card.url}
                onClick={card.id === "roadmap" ? handleRoadmapShortcut : undefined}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
              >
                {content}
              </a>
            );
          })}
        </div>
      </section>

      {/* ── Modal Pop-up: Crear Nueva Sala ── */}
      {createPresence.shown && (
        <div
          className={`modal-overlay ${createPresence.closing ? "modal-overlay--closing" : ""}`}
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className={`modal-card host-exit-modal ${createPresence.closing ? "modal-card--closing" : ""}`}
            ref={createSheetRef}
            onClick={(e) => e.stopPropagation()}
          >
            <SheetHandle onClose={() => setShowCreateModal(false)} />
            <div className="modal-card__header">
              <h3 className="host-exit-modal__title">Crear una nueva sala</h3>
            </div>

            <p className="host-exit-modal__desc">
              Tú serás el anfitrión (Host) y tendrás el control inicial de la
              sincronización del video y los controles de reproducción.
            </p>

            {createError && (
              <div
                style={{
                  color: "#f87171",
                  fontSize: "0.85rem",
                  marginBottom: "1rem",
                  background: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  padding: "0.65rem 0.85rem",
                  borderRadius: "10px",
                }}
              >
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit}>
              <div className="form-group" style={{ marginBottom: "1rem" }}>
                <label
                  className="form-group__label"
                  style={{ color: "#cbd5e1", fontWeight: 600 }}
                >
                  Tu nombre como Anfitrión
                </label>
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
              <div
                className="form-group"
                style={{
                  marginBottom: "1.25rem",
                  background: "rgba(255, 255, 255, 0.04)",
                  padding: "0.85rem",
                  borderRadius: "10px",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "0.4rem",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.88rem",
                      fontWeight: 600,
                      color: "#f3f4f6",
                    }}
                  >
                    {isTemporary ? "⚡ Sala Temporal" : "💾 Sala Persistente"}
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
                <p
                  style={{
                    fontSize: "0.78rem",
                    color: "#9ca3af",
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {isTemporary
                    ? "Al cerrar la sala se borra el video y la sala automáticamente (ideal para videos pesados o funciones rápidas)."
                    : "El video se conserva subido en el servidor para futuras sesiones."}
                </p>
              </div>

              <div style={{ display: "flex", gap: "0.75rem" }}>
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
                  style={{
                    flex: 1.4,
                    padding: "0.75rem 1rem",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  {createLoading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Creando...
                    </>
                  ) : (
                    "Iniciar sala"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal Pop-up: Unirse a Sala ── */}
      {joinPresence.shown && (
        <div
          className={`modal-overlay ${joinPresence.closing ? "modal-overlay--closing" : ""}`}
          onClick={() => setShowJoinModal(false)}
        >
          <div
            className={`modal-card host-exit-modal ${joinPresence.closing ? "modal-card--closing" : ""}`}
            ref={joinSheetRef}
            onClick={(e) => e.stopPropagation()}
          >
            <SheetHandle onClose={() => setShowJoinModal(false)} />
            <div className="modal-card__header">
              <h3 className="host-exit-modal__title">
                {isUrlInvite && roomCode
                  ? `Unirse a la sala ${roomCode}`
                  : "Unirse a una sala"}
              </h3>
            </div>

            <p className="host-exit-modal__desc">
              {isUrlInvite && roomCode
                ? `Ingresa tu nombre de usuario para unirte de inmediato a la sala ${roomCode}.`
                : "Ingresa tu nombre y el código de 6 u 8 caracteres que te compartió el anfitrión."}
            </p>

            {error && (
              <div
                style={{
                  color: "#f87171",
                  fontSize: "0.85rem",
                  marginBottom: "1rem",
                  background: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  padding: "0.65rem 0.85rem",
                  borderRadius: "10px",
                }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleJoinSubmit}>
              <div
                className="form-group"
                style={{
                  marginBottom: isUrlInvite && roomCode ? "1.25rem" : "0.85rem",
                }}
              >
                <label
                  className="form-group__label"
                  style={{ color: "#cbd5e1", fontWeight: 600 }}
                >
                  Tu nombre de usuario
                </label>
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

              {(!isUrlInvite || !roomCode) && (
                <div className="form-group" style={{ marginBottom: "1.25rem" }}>
                  <label
                    className="form-group__label"
                    style={{ color: "#cbd5e1", fontWeight: 600 }}
                  >
                    Código de sala
                  </label>
                  <input
                    type="text"
                    className="form-group__input"
                    placeholder="Ej. 8FK29X"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    maxLength={8}
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      fontWeight: 700,
                    }}
                    required
                  />
                </div>
              )}

              {isUrlInvite && roomCode && (
                <div style={{ marginBottom: "1rem", textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsUrlInvite(false);
                      setRoomCode("");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#818cf8",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Usar otro código de sala
                  </button>
                </div>
              )}

              <div style={{ display: "flex", gap: "0.75rem" }}>
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
                  style={{
                    flex: 1.4,
                    padding: "0.75rem 1rem",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  Entrar a la sala
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {timelinePresence.shown && timelineView && (
        <div
          className={`modal-overlay ${timelinePresence.closing ? "modal-overlay--closing" : ""}`}
          onClick={() => setTimelineEvent(null)}
        >
          <section
            className={`modal-card timeline-modal ${timelinePresence.closing ? "modal-card--closing" : ""}`}
            ref={timelineSheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Detalle: ${timelineView.title}`}
            onClick={(event) => event.stopPropagation()}
          >
            <SheetHandle onClose={() => setTimelineEvent(null)} />
            <div className="timeline-modal__meta">
              <span className="home-timeline__date">{timelineView.date}</span>
              <span className={`home-status home-status--${timelineView.tone}`}>
                {timelineView.status}
              </span>
            </div>
            <h3 className="timeline-modal__title">{timelineView.title}</h3>
            <p className="timeline-modal__desc">{timelineView.desc}</p>
            <button
              type="button"
              className="btn btn--primary timeline-modal__action"
              onClick={() => setTimelineEvent(null)}
              autoFocus
            >
              Entendido
            </button>
          </section>
        </div>
      )}

      {/* ── Footer ── */}
      <footer className="home-footer">
        <div className="home-footer__inner">
          <div className="home-footer__top">
            <div className="home-footer__col home-footer__col--brand">
              <div className="home-footer__brand">
                <Video size={20} color="#818cf8" />
                <span>Watch Party</span>
              </div>
              <p className="home-footer__tagline">
                Sincroniza tus archivos multimedia con videollamada HD, chat y
                reacciones en tiempo real.
              </p>
              <div className="home-footer__social">
                {PATREON_URL && (
                  <a
                    className="home-footer__social-link"
                    href={PATREON_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Heart size={14} strokeWidth={2.2} />
                    Patreon
                  </a>
                )}
                {PAYPAL_URL && (
                  <a
                    className="home-footer__social-link"
                    href={PAYPAL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Wallet size={14} strokeWidth={2.2} />
                    PayPal
                  </a>
                )}
                <a className="home-footer__social-link" href="#donaciones">
                  <Lightbulb size={14} strokeWidth={2.2} />
                  Donaciones
                </a>
              </div>
            </div>

            <div className="home-footer__col">
              <h4 className="home-footer__heading">Producto</h4>
              <a className="home-footer__link" href="#funciones">
                Funciones
              </a>
              <a className="home-footer__link" href="#como-funciona">
                Cómo funciona
              </a>
              <a className="home-footer__link" href="#tecnologias">
                Tecnologías
              </a>
            </div>

            <div className="home-footer__col">
              <h4 className="home-footer__heading">Comunidad</h4>
              <a className="home-footer__link" href="#roadmap">
                Lo que viene
              </a>
              <a className="home-footer__link" href="#timeline">
                Línea de tiempo
              </a>
              <a className="home-footer__link" href="#faq">
                Preguntas frecuentes
              </a>
              <a className="home-footer__link" href="#donaciones">
                Apoyar el proyecto
              </a>
            </div>

            <div className="home-footer__col home-footer__col--actions">
              <h4 className="home-footer__heading">Acceso rápido</h4>
              <button
                type="button"
                className="home-footer__action"
                onClick={() => {
                  setShowCreateModal(true);
                  setCreateError("");
                }}
              >
                Crear una sala
              </button>
              <button
                type="button"
                className="home-footer__action"
                onClick={() => {
                  setShowJoinModal(true);
                  setIsUrlInvite(false);
                  setError("");
                }}
              >
                Unirse con código
              </button>
            </div>
          </div>

          <div className="home-footer__bottom">
            <span>
              © {new Date().getFullYear()} Watch Party • Hecho con React,
              TypeScript y WebRTC.
            </span>
            <span className="home-footer__legal">
              Watch Party no provee contenido: los archivos los suben y
              gestionan sus propios usuarios.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};
