import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  Check,
  Plus,
  Minus,
  Heart,
  Wallet,
  Lightbulb,
  ExternalLink,
  ArrowRight,
  Activity,
} from 'lucide-react';
import exampleImg from '../../Example.png';
import { ApiService } from '../../services/api';
import {
  getRecentRooms,
  removeRecentRoom,
  getLastUsername,
  RecentRoom,
} from '../../services/recentRooms';
import {
  navLinks,
  techStack,
  roadmapItems,
  timelineEvents,
  donationCards,
  SUPPORT_PLANS,
  planPaymentUrl,
  features,
  faqs,
  KOFI_URL,
  PAYPAL_URL,
  TimelineEvent,
} from './homeData';
import { RecentRooms } from './RecentRooms';
import { PremiumPurchase } from './PremiumPurchase';
import { CreateRoomModal, JoinRoomModal, TimelineModal } from './HomeModals';
import {
  formatDemoAvailability,
  isDemoMode,
  type DemoAvailability,
} from '../../shared/demo';

interface HomeProps {
  initialRoomCode?: string | null;
  onJoinRoom: (code: string, name: string) => void;
  onRoomCreated: (roomId: string, hostName: string, hostSecret: string) => void;
  onReconnectHost: (roomId: string, hostName: string) => void;
}

/**
 * Home: composición landing + modales (lógica movida verbatim desde pages/Home.tsx).
 */
export const Home: React.FC<HomeProps> = ({
  initialRoomCode,
  onJoinRoom,
  onRoomCreated,
  onReconnectHost,
}) => {
  // Join Room Form state
  const [roomCode, setRoomCode] = useState(initialRoomCode || '');
  const [userName, setUserName] = useState('');
  const [error, setError] = useState('');
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);
  const [isUrlInvite, setIsUrlInvite] = useState(Boolean(initialRoomCode));

  // Popups state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(Boolean(initialRoomCode));

  // Create room modal form state
  const [createHostName, setCreateHostName] = useState('');
  const [isTemporary, setIsTemporary] = useState(true);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Demo gratuita: tras VITE_DEMO_MODE (default true en `demo-free`).
  // Con `false` todo lo demo (badge, contador, avisos) desaparece.
  const demo = isDemoMode();
  // Solo conteos (roomsUsed/roomsTotal/roomsAvailable). Si la lectura falla,
  // queda en null y el contador se oculta sin romper el Home.
  const [demoAvailability, setDemoAvailability] = useState<DemoAvailability | null>(null);

  const refreshDemoAvailability = async () => {
    try {
      setDemoAvailability(await ApiService.getDemoAvailability());
    } catch {
      setDemoAvailability(null);
    }
  };

  useEffect(() => {
    if (!demo) return;
    let cancelled = false;
    ApiService.getDemoAvailability()
      .then((a) => {
        if (!cancelled) setDemoAvailability(a);
      })
      .catch(() => {
        if (!cancelled) setDemoAvailability(null);
      });
    return () => {
      cancelled = true;
    };
  }, [demo]);

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
  const [timelineEvent, setTimelineEvent] = useState<TimelineEvent | null>(
    null,
  );
  // Keep the last opened event so the sheet renders while its exit animation plays
  const lastTimelineRef = useRef<TimelineEvent | null>(null);
  if (timelineEvent) lastTimelineRef.current = timelineEvent;
  const timelineView = timelineEvent ?? lastTimelineRef.current;

  useEffect(() => {
    setRecentRooms(getRecentRooms());
  }, []);

  const handleEnterRecentRoom = (room: RecentRoom) => {
    if (room.role === 'host') {
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

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim() || !userName.trim()) {
      setError('Ingresa tu nombre y el código de la sala');
      return;
    }
    setError('');
    setShowJoinModal(false);
    onJoinRoom(roomCode.trim().toUpperCase(), userName.trim());
    // Demo: re-lee la disponibilidad tras unirse (si falla, se oculta solo).
    if (demo) {
      void refreshDemoAvailability();
    }
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
      const data = await ApiService.createRoom(
        createHostName.trim(),
        isTemporary,
      );
      setShowCreateModal(false);
      // Demo: re-lee la disponibilidad tras crear (si falla, se oculta solo).
      // Nota: el backend responde 429 con el texto EXACTO del límite cuando
      // la demo llega a 5 salas; aquí se muestra `err.message` tal cual.
      if (demo) {
        void refreshDemoAvailability();
      }
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

  const handleRoadmapShortcut = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const roadmap = document.getElementById('roadmap');
    if (!roadmap) return;

    roadmap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    roadmap.setAttribute('tabindex', '-1');
    roadmap.focus({ preventScroll: true });
  };

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
                setError('');
              }}
            >
              Unirse
            </button>
            <button
              type="button"
              className="home-nav__btn home-nav__btn--primary"
              onClick={() => {
                setShowCreateModal(true);
                setCreateError('');
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
          <div className="home-hero-badge" aria-label="Plataforma libre y en tiempo real">
            <span className="home-hero-badge__dot" aria-hidden="true" />
            <span>100% Libre • Sin registros • Audio y Video HD en vivo</span>
          </div>

          {demo && (
            <span
              className="home-section__badge home-demo-badge"
              data-testid="demo-badge"
            >
              Demo gratuita
            </span>
          )}
          {/* Demo: los vídeos van por enlace externo (Drive); la subida de
              archivos está deshabilitada. Entrada por código sin cambios. */}
          {demo && (
            <aside
              className="home-future-note"
              aria-label="Vídeos por enlace en la demo"
              data-testid="demo-drive-notice"
            >
              <ExternalLink size={18} strokeWidth={2.2} aria-hidden="true" />
              <p>
                En esta demo los vídeos se comparten con un{' '}
                <strong>enlace externo (por ejemplo, Google Drive)</strong>:
                pega el enlace en la sala para reproducirlo juntos.
              </p>
            </aside>
          )}
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
                setCreateError('');
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
                setError('');
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

          {/* Demo: contador de salas (solo conteos, sin códigos ni lista).
              Si la lectura falla, no se renderiza nada (no rompe el Home). */}
          {demo && demoAvailability && (
            <p
              className="home-demo-counter"
              role="status"
              data-testid="demo-availability"
            >
              <Activity size={16} strokeWidth={2.4} aria-hidden="true" />
              <span>{formatDemoAvailability(demoAvailability)}</span>
            </p>
          )}
        </div>

        {/* Right Column: Reference Showcase Frame (Example.png) */}
        <div className="home-hero-right">
          <div className="home-showcase-frame">
            <img
              src={exampleImg}
              alt="Watch Party Experiencia en Vivo"
              className="home-showcase-img"
              loading="lazy"
              decoding="async"
            />
            <div className="home-showcase-overlay" />
          </div>
        </div>
      </div>

      {/* Historial de salas recientes: ancho completo, bajo el texto y la imagen */}
      <RecentRooms
        recentRooms={recentRooms}
        onEnter={handleEnterRecentRoom}
        onRemove={handleRemoveRecentRoom}
      />

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
                  event.tone === 'wip'
                    ? 'home-timeline__item--now'
                    : 'home-timeline__item--past'
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
                      className={`home-status ${item.status === 'En estudio' ? 'home-status--wip' : ''}`}
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
                    className={`home-status ${item.status === 'En estudio' ? 'home-status--wip' : ''}`}
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
                className={`home-faq-item ${isOpen ? 'home-faq-item--open' : ''}`}
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
                setCreateError('');
              }}
              className="home-hero-btn home-hero-btn--primary"
            >
              <span>Crear sala ahora</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowJoinModal(true);
                setError('');
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
            const isExternal = card.url.startsWith('http');
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
                  {isReady ? card.cta : 'Próximamente'}
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
                onClick={card.id === 'roadmap' ? handleRoadmapShortcut : undefined}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
              >
                {content}
              </a>
            );
          })}
        </div>
      </section>

      {/* ── SECTION: Planes de apoyo (pago único) ── */}
      <section className="home-section home-plans" id="planes">
        <div className="home-section__header">
          <span className="home-section__badge">Planes de apoyo</span>
          <h2 className="home-section__title">Impulsa Watch Party con un pago único</h2>
          <p className="home-section__subtitle">
            Sin suscripciones ni anuncios. Eliges un plan, pagas una sola vez
            por PayPal y lo recaudado cubre servidor, almacenamiento y desarrollo.
          </p>
        </div>

        <div className="home-plans-grid">
          {SUPPORT_PLANS.map((plan) => {
            const Icon = plan.icon;
            const url = planPaymentUrl(plan);
            const isReady = Boolean(url);
            return (
              <article
                key={plan.id}
                className={`home-plan-card${plan.highlighted ? ' home-plan-card--highlighted' : ''}${!isReady ? ' home-plan-card--pending' : ''}`}
              >
                {plan.badge && (
                  <span className="home-plan-card__badge">{plan.badge}</span>
                )}
                <span
                  className={`home-donate-card__icon home-donate-card__icon--${plan.tone}`}
                  aria-hidden="true"
                >
                  <Icon size={20} strokeWidth={2} />
                </span>
                <h3 className="home-plan-card__name">{plan.name}</h3>
                <p className="home-plan-card__price">
                  ${plan.amount}
                  <span className="home-plan-card__currency"> {plan.currency} · pago único</span>
                </p>
                <p className="home-donate-card__desc">{plan.tagline}</p>
                <ul className="home-plan-card__perks">
                  {plan.perks.map((perk) => (
                    <li key={perk}>
                      <Check size={14} className="text-primary-color" aria-hidden="true" />
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
                {isReady ? (
                  <a
                    className="home-hero-btn home-hero-btn--primary home-plan-card__cta"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>{plan.cta}</span>
                    <ExternalLink size={14} />
                  </a>
                ) : (
                  <span className="home-plan-card__cta-pending">
                    Próximamente — configura VITE_PAYPAL_URL
                  </span>
                )}
              </article>
            );
          })}
        </div>

        <PremiumPurchase />
      </section>

      {/* ── Modal Pop-up: Crear Nueva Sala ── */}
      <CreateRoomModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        hostName={createHostName}
        setHostName={setCreateHostName}
        isTemporary={isTemporary}
        setIsTemporary={setIsTemporary}
        loading={createLoading}
        error={createError}
        onSubmit={handleCreateSubmit}
      />

      {/* ── Modal Pop-up: Unirse a Sala ── */}
      <JoinRoomModal
        open={showJoinModal}
        onClose={() => setShowJoinModal(false)}
        roomCode={roomCode}
        setRoomCode={setRoomCode}
        userName={userName}
        setUserName={setUserName}
        error={error}
        isUrlInvite={isUrlInvite}
        setIsUrlInvite={setIsUrlInvite}
        onSubmit={handleJoinSubmit}
      />

      {timelineView && (
        <TimelineModal
          open={Boolean(timelineEvent)}
          event={timelineView}
          onClose={() => setTimelineEvent(null)}
        />
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
                {KOFI_URL && (
                  <a
                    className="home-footer__social-link"
                    href={KOFI_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Heart size={14} strokeWidth={2.2} />
                    Ko-fi
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
              <a className="home-footer__link" href="#planes">
                Planes de apoyo
              </a>
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
                  setCreateError('');
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
                  setError('');
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

export default Home;
