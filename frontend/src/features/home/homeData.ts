import {
  Zap,
  Mic,
  PartyPopper,
  MessageCircle,
  ShieldCheck,
  Clock,
  Upload,
  Check,
  Atom,
  Braces,
  Server,
  Radio,
  Network,
  Database,
  MonitorPlay,
  FolderUp,
  Heart,
  Wallet,
  WandSparkles,
} from 'lucide-react';

/**
 * Datos estáticos del Home (movidos verbatim desde pages/Home.tsx, sin lógica).
 */

export const KOFI_URL =
  (import.meta.env.VITE_KOFI_URL as string | undefined)?.trim() || '';
export const PAYPAL_URL =
  (import.meta.env.VITE_PAYPAL_URL as string | undefined)?.trim() || '';

export const navLinks = [
  { href: '#funciones', label: 'Funciones' },
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#tecnologias', label: 'Tecnologías' },
  { href: '#roadmap', label: 'Lo que viene' },
  { href: '#donaciones', label: 'Donaciones' },
  { href: '#faq', label: 'FAQ' },
];

export const techStack = [
  { icon: Atom, name: 'React 18', role: 'Interfaz de usuario' },
  { icon: Braces, name: 'TypeScript', role: 'Tipado estático' },
  { icon: Zap, name: 'Vite', role: 'Compilación y HMR' },
  { icon: Server, name: 'Node.js + Express', role: 'API REST y subidas' },
  { icon: Radio, name: 'Socket.IO', role: 'Eventos en tiempo real' },
  { icon: Network, name: 'WebRTC', role: 'Audio y video P2P' },
  { icon: Database, name: 'MongoDB + Mongoose', role: 'Persistencia de salas' },
  { icon: MonitorPlay, name: 'hls.js', role: 'Streaming HLS adaptativo' },
  { icon: FolderUp, name: 'Multer', role: 'Subida de archivos' },
];

export const roadmapItems = [
  {
    title: 'Aplicación móvil (PWA)',
    desc: 'Instalable en el teléfono con notificaciones y modo sin conexión.',
    status: 'Planeado',
  },
  {
    title: 'Subtítulos y pistas de audio',
    desc: 'Cargar .srt junto al archivo y elegir idioma por participante.',
    status: 'Planeado',
  },
  {
    title: 'Listas de reproducción',
    desc: 'Cola de varios archivos que el anfitrión reproduce en orden.',
    status: 'En estudio',
  },
  {
    title: 'Salas con contraseña',
    desc: 'Acceso cerrado además del código y de la aprobación de entrada.',
    status: 'Planeado',
  },
  {
    title: 'Moderación avanzada',
    desc: 'Silencios globales, expulsión rápida y desactivación de reacciones.',
    status: 'En estudio',
  },
];

export const timelineEvents = [
  {
    date: 'Sept 2026',
    title: 'Inicio del proyecto',
    desc: 'Nace la idea para ver contenido audiovisual a distancia con amigos y familia, superando limitaciones de calidad y retrasos de apps tradicionales. Se inicia el monorepo con Express, Socket.IO, React, Vite y TypeScript.',
    status: 'Completado',
    tone: 'done' as const,
  },
  {
    date: 'Sept 2026',
    title: 'Sincronización y comunicación en vivo',
    desc: 'Reproducción sincronizada por WebSockets para ver contenido al mismo tiempo, junto a chat en vivo y videollamadas WebRTC de baja latencia entre participantes.',
    status: 'Completado',
    tone: 'done' as const,
  },
  {
    date: 'Oct 2026',
    title: 'Salas con aprobación y control del anfitrión',
    desc: 'Sistema de control para el creador: aprobación de solicitudes de entrada, permisos individuales de participantes, reacciones flotantes animadas y cierre automático por inactividad.',
    status: 'Completado',
    tone: 'done' as const,
  },
  {
    date: 'Oct 2026',
    title: 'Rediseño del Home',
    desc: 'Renovación completa de la página principal: catálogo de tecnologías, línea de tiempo histórica, roadmap interactivo de funciones, vías de donación y pie de página completo.',
    status: 'Completado',
    tone: 'done' as const,
  },
  {
    date: 'Oct 2026',
    title: 'PWA, subtítulos y optimización continua',
    desc: 'Evolución a Progressive Web App (PWA) instalable, soporte para subtítulos externos .srt y mejoras continuas de baja latencia y compresión.',
    status: 'En curso',
    tone: 'wip' as const,
  },
];

export type TimelineEvent = (typeof timelineEvents)[number];

export const donationCards = [
  {
    id: 'kofi',
    icon: Heart,
    title: 'Ko-fi',
    desc: 'Apoya el proyecto con una aportación para pagar el servidor y priorizar nuevas funciones.',
    cta: 'Apoyar en Ko-fi',
    url: KOFI_URL,
    tone: 'rose' as const,
  },
  {
    id: 'paypal',
    icon: Wallet,
    title: 'PayPal',
    desc: 'Una aportación única y sin compromiso para mantener el proyecto vivo.',
    cta: 'Donar con PayPal',
    url: PAYPAL_URL,
    tone: 'blue' as const,
  },
  {
    id: 'roadmap',
    icon: WandSparkles,
    title: 'Lo que queremos construir',
    desc: 'Revisa el roadmap y decide qué función desarrollamos a continuación.',
    cta: 'Ver lo que viene',
    url: '#roadmap',
    tone: 'amber' as const,
  },
];

export const features = [
  {
    icon: Zap,
    title: 'Sincronización en Tiempo Real',
    desc: 'Reproduce, pausa o adelanta. Todos los miembros de la sala ven el cambio de manera sincronizada y simultánea, sin desfases.',
  },
  {
    icon: Mic,
    title: 'Voz y Video en Vivo',
    desc: 'Habla con tus amigos mediante micrófonos y cámaras WebRTC de alta calidad mientras disfrutan del mismo archivo multimedia.',
  },
  {
    icon: PartyPopper,
    title: 'Reacciones Flotantes',
    desc: 'Expresa tus emociones con emojis animados flotando sobre la pantalla, visibles para todos en tiempo real.',
  },
  {
    icon: MessageCircle,
    title: 'Chat en Directo',
    desc: 'Comparte comentarios, bromas y opiniones al instante mediante el panel lateral integrado de mensajería.',
  },
  {
    icon: Upload,
    title: 'Sube tus Archivos Multimedia',
    desc: 'Carga tus propios videos desde el dispositivo o pega un enlace, con barra de progreso y streaming optimizado.',
  },
  {
    icon: ShieldCheck,
    title: 'Salas Privadas con Aprobación',
    desc: 'Acceso mediante códigos únicos y solicitud de entrada: el anfitrión aprueba o rechaza a cada invitado antes de entrar.',
  },
  {
    icon: Clock,
    title: 'Salas Temporales o Persistentes',
    desc: 'Elige si la sala se borra al cerrarse (ideal para archivos pesados) o si se conserva para futuras sesiones.',
  },
  {
    icon: Check,
    title: 'Control del Anfitrión',
    desc: 'Gestiona permisos, silencia participantes, transfiere el rol y define un temporizador de cierre automático para la sala.',
  },
];

export const faqs = [
  {
    q: '¿Cómo funciona la sincronización de video?',
    a: 'El anfitrión tiene el control del reproductor. Cada vez que reproduce, pausa o adelanta el archivo, se envía una señal en milisegundos mediante WebSockets para que todos los espectadores vean exactamente el mismo frame sin desfases.',
  },
  {
    q: '¿Necesito instalar algún programa o extensión?',
    a: 'No, Watch Party funciona 100% en el navegador web (Chrome, Firefox, Edge, Safari y navegadores móviles) sin extensiones, descargas ni registros obligatorios.',
  },
  {
    q: '¿Qué formatos de video son compatibles?',
    a: 'Puedes subir archivos de video locales en formatos populares como MP4, WebM, MKV, entre otros, disfrutando de reproducción fluida y de alta calidad.',
  },
  {
    q: '¿Cómo funcionan la voz y las cámaras?',
    a: 'Utilizamos tecnología WebRTC punto a punto (P2P), lo que garantiza audio y video en tiempo real de baja latencia sin saturar servidores externos.',
  },
];
