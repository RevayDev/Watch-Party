# Documentación del Proyecto (Watch-Party)

## 1. Estado Actual (Commit / Snapshot)
- **Frontend**: React 18, Vite 6, TypeScript 5, Tailwind/BEM custom CSS (`index.css`).
- **Backend**: Node.js, Express, Socket.io (gestión de salas, WebRTC signaling, chat, sincronización de video y control de acceso de invitados).
- **Sistema Global de Hojas / Modales (`BottomSheet`)**:
  - Implementado mediante `BottomSheet.tsx` y el hook Pointer Events `useSheetDrag.ts`.
  - Soporta arrastre táctil con resistencia (rubber-band) y umbrales de cierre por velocidad o distancia, anclaje inferior en móviles (`max-width: 768px`) y modales centrados en escritorio.
  - Gestión automática de presencia, apilamiento (Stack para tecla Escape), bloqueo de scroll corporal (`scroll-lock` seguro) y trampa de foco (`focus trap`).

## 2. Mejoras Recientes (Solicitadas)
1. **Aceptación y Solicitudes en Teléfono**:
   - Reestructuración completa de las tarjetas en el panel de participantes.
   - El nombre, estado y botones de acción (Aceptar, Rechazar, Banear) se distribuyen verticalmente de forma limpia y fluida para evitar recortes horizontales o amontonamientos.
   - Tamaños táctiles cómodos y alineación moderna respetando la paleta de colores existente (`rgba(13, 19, 33, 0.98)`, bordes sutiles, radios de 12px/16px).
2. **Panel de Participantes**:
   - Uniformidad total con el sistema visual general (fondos semitransparentes con `backdrop-filter: blur`, radios consistentes, tipografía Outfit).
   - Espaciado optimizado en pantallas móviles.
3. **Eliminación del botón X**:
   - Eliminados por completo los botones de cierre "X" en la cabecera de Participantes, Ficha de Detalle de Usuario y Notificaciones Toast (el cierre se realiza mediante gestos de arrastre, toque fuera del backdrop o tecla Escape).
4. **Notificaciones**:
   - Mantenimiento del comportamiento funcional y visual actual.
   - Reubicación de la barra indicadora de tipo de notificación: ahora se encuentra en la **parte inferior** (borde inferior de 3px) y utiliza el color exacto correspondiente (`#34d399` para éxito, `#f87171` para error, `#fbbf24` para advertencia y `#60a5fa` para información).
5. **Responsive**:
   - Adaptación fluida y estructurada para teléfonos móviles y tablets, sin depender de recortes simples.

## 3. Próximos Pasos (Lo que hace falta)
- **Testing Automatizado**: Incorporar pruebas unitarias y de integración para los hooks de arrastre y componentes principales.
- **Optimización de Bundle**: Evaluar división de chunks (Code Splitting con Dynamic Imports) para reducir el tamaño del paquete principal (`index-BR29v2Mp.js`).
- **PWA (Progressive Web App)**: Añadir Service Worker para soporte offline básico y notificaciones push nativas en dispositivos móviles.
