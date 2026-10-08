# Resiliencia WebRTC ante señal débil (estilo WhatsApp)

Rama: `feature/sync-fixes`. Objetivo: con poca señal la llamada **no se cae**;
se degrada por pasos y se recupera sola.

## Qué se hizo

1. **Socket.IO resiliente** (`frontend/src/services/socket.ts`): reconexión con
   backoff (1s→10s), reintentos infinitos y timeout de 20s. Un microcorte ya no
   saca de la sala (más la gracia de 20s del servidor que conserva el lugar).
2. **ICE restart automático** (`useWebRTC.ts`): peer en `failed` o colgado en
   `disconnected` +8s → re-oferta con backoff (2s→15s), hasta 3 intentos por
   peer; luego se suelta. Antes se borraba al primer fallo.
3. **Escalera de calidad** (`shared/webrtc-quality.ts`, niveles 0→3):
   - Nivel 1: bitrate capado a 300kbps.
   - Nivel 2: captura 320×240@15fps + 120kbps.
   - Nivel 3: solo audio (video pausado, llamada intacta).
   - Sube/baja de a un escalón cada ~6s con histéresis (sin parpadeos).
   - Todo sin renegociar (constraints, `track.enabled`, `setParameters`).
4. **Menos peticiones en mala señal**: heartbeat de posición 5s → 15s;
   aviso en sala "📶 Señal débil: video pausado, seguís con audio".
5. **Tests**: 13 nuevos en `tests/webrtc-quality.test.ts` (histeresis,
   backoff, parseo de `getStats`, escalera).

## Qué se espera que haga

- Con señal normal: todo igual que antes (nivel 0, 640×480, heartbeat 5s).
- Con señal pobre sostenida (~12s): baja a 300kbps, luego 320×240, luego
  solo-audio; el audio **nunca** se corta por este mecanismo.
- Al recuperarse: sube de a un escalón hasta nivel 0.
- Si un peer no se recupera tras 3 ICE restarts: se suelta solo ese peer.
- Cortes de red de segundos: Socket.IO reconecta solo y se reanuda.

## Límites conocidos (no se promete más)

- No mide ancho de banda real, solo RTT/pérdida por peer (peor caso manda).
- Con `heartbeatIntervalMs=15s` los reportes pueden expirar del consenso
  (TTL 12s); el fallback es el último snapshot: correcto y aceptado.
- Red totalmente caída >20s: el servidor te da por salido (gracia agotada);
  al volver reentrás y adoptás el tiempo de consenso.
- No se tocó: signaling, DataChannels, negociación inicial, UI de cámaras.
