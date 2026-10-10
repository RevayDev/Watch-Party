# Cinemática Interestellar — Funcionalidad

Secuencia cinematográfica que se muestra **dentro del reproductor** cuando la
sala hace la combinación de emojis. Todos ven lo mismo al mismo tiempo, como
con el video.

## 1. Disparo (combo)

- Si llegan **🪐 y ✨ de DOS usuarios distintos en ≤5 s**, se dispara la
  secuencia. Una sola vez por combinación (ventana con reinicio tras disparar).
- Con `visualEffects` en `false` no se dispara; las reacciones normales siguen.
- Detección: `checkInterstellarCombo` (`frontend/src/features/player/interstellar.ts`),
  alimentada por cada `reaction` en `useRoomSocket.ts`.

## 2. Qué se muestra (igual para todos)

- Quien completa el combo elige **3 frases al azar** (`pickAmbientQuotes`) y
  las emite al servidor (`cinematic-trigger`).
- El servidor deja pasar **solo la primera propuesta por sala (ventana 8 s)** y
  la reenvía (`chat-reactions.handler.ts` + `lastCinematicTrigger` en
  `socket-state.ts`): toda la sala recibe las **mismas 3 frases** (`comboId`).
- Las frases se reparten según la **duración real del audio**: una por tercio
  (subida 30 % → meseta 40 % → bajada 30 %). Sin metadatos, 10 s estimados.
- La **primera frase aparece enseguida** (fundido de entrada 1.4 s desde
  arriba, espejo de la salida que va hacia abajo); cada frase sale 1.2 s antes
  del cambio. La capa completa funde en 1.2 s al aparecer.
- Fondo `interstellar-background.png` (`frontend/public/`) con fundido lento
  (2.5 s) + degradado para legibilidad. Frase en tarjeta oscura translúcida.
- Audio `ambient-intro.mp3` (`frontend/public/audio/`), pico 0.22. Si el
  autoplay falla, **las frases salen igual sin sonido** (sin botones extra).

## 3. Video en pausa + Omitir compartido

- Al mostrarse, **la película se pausa** (con control se emite `pause` con el
  tiempo exacto; sin control solo en local). Al cerrarse se **reanuda solo si
  la cinemática la había pausado** (`VideoPlayer.tsx`, refs `cineHoldRef` /
  `cinePausedRef`; sin ecos duplicados).
- **Omitir la cierra para TODOS**: quien lo pulsa emite `cinematic-skip`, el
  servidor lo reenvía y cada sala cierra y reanuda su video. Al terminar sola
  no se emite nada (cada cliente termina en su reloj).
- Componente: `AmbientIntro.tsx` (`onDone(skipped)`), montado por `Room.tsx`
  dentro del `VideoPlayer` (`cinematicKey` + `cinematicQuotes`).

## 4. Textos, audio e imagen (dónde está cada cosa)

| Recurso | Archivo |
|---|---|
| Frases (10) + elección aleatoria | `frontend/src/features/player/interstellar.ts` → `AMBIENT_QUOTES`, `pickAmbientQuotes` |
| Componente de la secuencia | `frontend/src/features/room/components/AmbientIntro.tsx` |
| Trigger + skip compartido (front) | `useRoomSocket.ts` → `cineTrigger`, `cineDismissedId`, `dismissCinematic` |
| Trigger + skip compartido (back) | `chat-reactions.handler.ts` (`cinematic-trigger`, `cinematic-skip`) |
| Imagen de fondo | `frontend/public/interstellar-background.png` |
| Audio ambiental | `frontend/public/audio/ambient-intro.mp3` |
| Estilos | `index.css` (`.ambient-intro*`), `animations.css` (`ambientIn`, `ambientDrift`) |

## 5. Eventos socket

| Evento | Dirección | Payload |
|---|---|---|
| `cinematic-trigger` (emit) | cliente → servidor | `{ roomId, comboId, quotes[3], userName }` |
| `cinematic-trigger` (relay) | servidor → sala | `{ comboId, quotes[3], user }` (solo el primero en 8 s) |
| `cinematic-skip` (emit) | cliente → servidor | `{ roomId, comboId, userName }` |
| `cinematic-skip` (relay) | servidor → sala | `{ comboId, user }` (idempotente, sin ventana) |
