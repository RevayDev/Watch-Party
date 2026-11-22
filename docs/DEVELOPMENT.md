# Watch Party development

## Local setup and checks

Use Node 22.12+ on the Node 22 release line or Node 24 LTS. Run these commands from the repository root.

```sh
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm run dev
```

Open the frontend at `http://localhost:5173`. The backend listens on port 4000 by default. Copy the example environment files when changing ports, enabling optional integrations, or setting up a separate origin. After changing the backend port, update the frontend API and socket origins or the local Vite proxy target as appropriate.

```sh
npm --prefix frontend exec -- tsc --noEmit -p frontend/tsconfig.json
npm --prefix backend run lint
npm --prefix frontend run lint
npm run test
npm --prefix backend run build
npm --prefix frontend run build
npm start
```

Run the backend tests in an environment that allows loopback connections. For a focused change, pass a Vitest path, for example `npm --prefix frontend test -- tests/music-panel.test.tsx` or `npm --prefix backend test -- tests/chat-webrtc-relay.test.ts`. For load testing, see the [local load test notes](../backend/tests/load/LOAD_TESTING.md).

## Make a scoped change

1. Trace one existing user interaction through its component, transport entry point, and domain or service operation. Record its permission checks, response shape, and failure behavior.
2. Keep a feature-specific component under its feature directory. Follow `features/room/components/YouTubeSearch.tsx` for a view calling a client service. Extract a hook when timers, subscriptions, or browser resources have a lifecycle. Follow the cleanup patterns in `hooks/useWebRTC.ts`.
3. For REST, add a route to the corresponding router. Parse untrusted values at the boundary, as in `routes/youtube.routes.ts`. Use `safeParse` for expected validation failures and keep the endpoint's established status and error body. Narrow upstream responses before using them. [Zod basic usage](https://zod.dev/basics)
4. For Socket.IO, update the client and server together and keep authorization server-side. The WebRTC relay is an example of routing validation and membership checks. Keep media signaling payloads opaque to the relay.
5. Put room business rules in the domain or service that owns the state transition. Persist through the existing repository port. Reuse the current TypeScript types and derive types from schemas at boundaries when useful.
6. Test the original behavior and the regression. For React, cover the user interaction. For HTTP, check response status and body. For socket changes, verify event payloads and unauthorized cases.

Use English for new identifiers, technical comments, and documentation. Retain the existing user-facing language and visual behavior.

## Debug and deploy

To test browser hosting locally, open the creation dialog and choose the browser-host option. Share the complete invitation URL, including its fragment key, in another browser profile. Copy a small video, wait for confirmed replicas in server settings, then close the creator's tab. Check that another participant becomes the host, retains chat and playback state, and can admit a new guest through the original URL. Repeat on separate networks to verify connectivity beyond local ICE candidates.

The creation dialog checks `/api/health` with a bounded timeout. A failed check disables Render and selects browser hosting. A sleeping Render instance may become available after choosing to retry the check. The browser mode uses the public PeerJS signaling service by default. `VITE_PEER_HOST`, `VITE_PEER_PORT`, and `VITE_PEER_PATH` can point to an independently deployed TLS PeerServer. For microphone/camera across different phone and PC networks, configure `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` with short-lived TURN credentials. Those are public build settings; never place the coturn shared secret in them.

- **Two clients.** Join a room from separate browser profiles. Check admission, movie sync, music queue, chat, and microphone and camera. The personal device test checks capture locally. A real cross-network call is needed to verify TURN.
- **Storage.** The backend reads `MONGODB_URI` for Mongoose. Prisma mode uses `ROOM_STORE=prisma` with `DATABASE_URL` or the MongoDB fallback. Run `npm --prefix backend run db:push` for an intended Prisma schema deployment. Inspect startup logs to confirm the selected store.
- **External services.** Use the backend environment for `YOUTUBE_API_KEY`, `TURN_URLS`, `TURN_SHARED_SECRET`, `ADMIN_TOKEN`, or Spotify credentials. Vite variables are public build-time settings. Never place service secrets there. For Spotify, register the exact callback URL for each environment and configure `SPOTIFY_TOKEN_KEY` before enabling persistent tokens.
- **Hosted build.** The repository contains the backend Render manifest and frontend Vercel rewrite configuration. Set frontend API and socket origins to the deployed backend, `CLIENT_URL` to the frontend origin, and `ALLOWED_ORIGINS` for any additional approved origins. The backend health check is `/api/health`. Validate media permissions over HTTPS and check the deployment logs before opening rooms to users.
