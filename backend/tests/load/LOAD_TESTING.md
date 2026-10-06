# LOAD_TESTING — Pruebas de carga del backend (SUBAGENTE 4)

Scripts reproducibles en `backend/tests/load/` (ESM puro, `node`, sin compilar;
no los recoge vitest: `include: tests/**/*.test.ts`):

| Script | Qué hace |
|---|---|
| `ramp.mjs` | Rampa HTTP 10→25→50→100 conns × 15 s (autocannon) contra `GET /api/health`, `/api/status`, `/api/demo/availability`. Para antes de tumbar (trips: errRate>5 %, p99>5000 ms, health caído). |
| `rooms-scenarios.mjs` | Escenarios R×U (default `all` = 1×10 / 5×10 / 10×10): crea salas (REST), une usuarios (REST), conecta sockets reales (`socket.io-client`: `join-room` + heartbeat 5 s + 3× `sync-video`), observa 20 s y limpia (leave + DELETE con `hostSecret`). Clasifica cada 429 en `demo-quota` vs `rate-limit` (ver `lib.mjs:classify429`) y reintenta 1 vez tras 65 s solo los del limitador IP. |
| `run-local.mjs` | Orquestador: levanta el servidor (`node_modules/tsx`, puerto 4100, `ADMIN_TOKEN=test-load-token`), corre escenarios y rampa en 2 fases — FREE (`DEMO_MODE=true`) y techo non-demo (`DEMO_MODE=false`) — y lo apaga. |
| `lib.mjs` | `waitForHealth`, `adminMetrics` (`/api/admin/metrics` con `LOAD_ADMIN_TOKEN`), `approxP95` (autocannon expone p90/p97_5: p95≈media de ambos), `classify429`, `cooldownLimiter`. |

```bash
cd backend
npm run load                  # todo local: escenarios + rampa, fases FREE y non-demo
npm run load:ramp -- --base=http://127.0.0.1:4100 --steps=10,25,50,100 --secs=15
npm run load:rooms -- --scenario=all --observe=20 --cooldown-ms=65000
```

## Contra qué entorno

1. **Local primero, siempre** (`run-local.mjs` solo habla a `127.0.0.1`).
2. **NUNCA contra producción sin aviso explícito**: Render Free es 1 instancia
   con CPU compartida; la rampa satura el `globalLimiter` y contamina métricas.
   Staging dedicado + ventana acordada + alguien mirando `GET /api/admin/metrics`.
3. Servidor medido con `tsx` (no `node dist/`): números comparables entre runs,
   NO cotas de producción.

## Cómo leer los resultados

- `non2xx` ≈ 30 % en rampa es **esperado**: todo sale de UNA IP y el
  `globalLimiter` (600 req/min/IP, `src/middleware/rate-limit.middleware.ts:71-75`)
  responde 429. Mide el techo anti-abuso single-IP, no el hardware. Lo invariante
  es `errores=0, timeouts=0, 5xx=0` y que la rampa **no** dispare los trips.
- En escenarios, `429demo` = cuota demo real (topes 5/5, mensajes de
  `src/config/demo-mode.ts`); `429limit` = limitador IP (artefacto del banco).
- `wsDisc` = desconexiones **espontáneas en ventana** (la limpieza propia se
  cuenta aparte: `wsDisconnectsOnCleanup`).
- `heap±MB` = `heapUsed` del proceso servidor antes→después (vía admin).
- `p95≈` = media(p90, p97_5) de autocannon (no expone p95 exacto).

## Resultados MEDIDOS en local — 2026-10-06 (PROBADO, no estimado)

Máquina: Windows, Node v24.18.0, servidor `tsx` puerto 4100, store en memoria
(sin Mongo; `database: disconnected`, modo soportado). autocannon 8.0.0,
socket.io-client 4.8.4. `LOAD_ADMIN_TOKEN=test-load-token`.

### Rampa HTTP (mezcla health/status/demo-availability)

| Fase | conns | req/s | p50 | p95≈ | p99 | transp. err/timeout | non2xx (4xx/5xx) |
|---|---|---|---|---|---|---|---|
| FREE (run 1) | 10 | 6120 | 1 ms | 2.5 ms | 6 ms | 0/0 | 30000 (29998/0) |
| FREE (run 1) | 25 | 6192 | 3 ms | 7 ms | 11 ms | 0/0 | 30950 (30950/0) |
| FREE (run 1) | 50 | 6202 | 7 ms | 13 ms | 18 ms | 0/0 | 30990 (30990/0) |
| FREE (run 1) | 100 | 6130 | 15 ms | 23.5 ms | 30 ms | 0/0 | 30009 (30009/0) |
| non-demo (run 2) | 10 | 897 | 10 ms | 20 ms | 30 ms | 0/0 | 3881 (3881/0) |
| non-demo (run 2) | 25 | 1064 | 22 ms | 45 ms | 62 ms | 0/0 | 5312 (5312/0) |
| non-demo (run 2) | 50 | 1056 | 46 ms | 79 ms | 108 ms | 0/0 | 5264 (5264/0) |
| non-demo (run 2) | 100 | 1184 | 86 ms | 140 ms | 165 ms | 0/0 | 5283 (5283/0) |
| non-demo fresco (run 3, servidor recién arrancado) | 10 | 1156 | 8 ms | 14 ms | 23 ms | 0/0 | 3253 (3253/0) |
| non-demo fresco (run 3) | 25 | 1284 | 15 ms | 41 ms | 61 ms | 0/0 | 4271 (4271/0) |
| non-demo fresco (run 3) | 50 | 1259 | 38 ms | 64.5 ms | 84 ms | 0/0 | 4596 (4596/0) |
| non-demo fresco (run 3) | 100 | 1447 | 71 ms | 105 ms | 127 ms | 0/0 | 4791 (4791/0) |

Rampa **completa sin trips en los 3 runs** (nunca se detuvo antes del escalón 100).
Run 1 vs runs 2–3 difieren en throughput (~6k vs ~1k req/s): el run 3 (servidor
fresco) reproduce al run 2, así que el run 1 fue la anomalía (hipótesis no
verificada: throttling térmico/CPU del portátil entre runs, o estado JIT de
`tsx`). Se reportan los tres; las conclusiones invariantes (0 errores de
transporte, 0 timeouts, 0 5xx hasta 100 conns) se sostienen en todos.

### Escenarios de salas (REST + WS real)

| Fase | Esc. | salas | joinOK | 429demo | join p50/p95 | WS conn | WS err/rej | WS disc. espont. | heap |
|---|---|---|---|---|---|---|---|---|---|
| FREE | 1×10 | 1/1 | 4 | 6 | 4/15 ms | 4 | 0/0 | 0 | 29→29 MB |
| FREE | 5×10 | 5/5 | 20 | 30 | 5/17 ms | 20 | 0/0 | 0 | 29→30 MB |
| FREE | 10×10 | 5/10 | 20 | 30 (+5 salas cap) | 9/18 ms | 20 | 0/0 | 0 | 30→32 MB |
| non-demo | 1×10 | 1/1 | 10 | 0 | 16/21 ms | 10 | 0/0 | 0 | 30→30 MB |
| non-demo | 5×10 | 5/5 | 50 | 0 | 8/17 ms | 50 | 0/0 | 0 | 30→33 MB |
| non-demo | 10×10 | 10/10 | 100 | 0 | 8/17 ms | 100 | 0/0 | 0 | 33→36 MB |

Lectura: en FREE la cuota 5 salas / 5 usuarios se impone exacta (1×10 → 4 joins
ok + 6 `room-full`; 10×10 → 5 salas + 5 `DEMO_ROOM_LIMIT` — nota: la fase FREE
corrió con el clasificador pre-fix y registró esos 5 como `429limit`; se
reclasifican a `demo-quota` porque con 5 salas vivas el 6.º create solo puede
ser `DEMO_ROOM_LIMIT` (mensaje con "demo"; el fix comprueba demo antes que
"límite"). La fase non-demo ya usó el clasificador corregido); en non-demo, en non-demo,
**100 usuarios WS concurrentes con tráfico sync/heartbeat, 0 errores, 0
desconexiones espontáneas**, heap +3 MB en el escenario mayor (sin fuga
aparente a esta escala). `serverConnectionsAfter` queda >0 unos segundos por la
gracia de desconexión de 20 s (diseño, no fuga). Los `429limit` intermedios
(join 30/min, create 15/min) se absorbieron con 1 cooldown de 65 s: son el
techo single-IP del banco, no del servidor.

### FREE vs PREMIUM (honestidad de alcance)

Hoy `DEMO_MODE` manda en runtime y `src/config/plans.ts` es **contrato futuro**:
en non-demo NO hay cuota de usuarios (el 10×10 mide Node+Socket.IO, no una cuota
premium real). `PREMIUM_ROOM_MAX_USERS=10` solo alimenta `getPremiumPlan()`.
Cuando pagos imponga cuotas premium, repetir el 10×10 con el plan aplicado.

### Re-medición 2026-10-06 (cuotas vigentes: demo 5/5)

Servidor propio en :4100 (el :4000 del usuario no se tocó). Escenarios demo:
1×10 → 4 joins OK + 6 `room-full`; 5×10 → 20 OK + 30 `room-full`;
10×10 → 5/10 salas (5 `DEMO_ROOM_LIMIT`); join p50 3–5 ms, p95 16–17 ms;
0 errores WS, 0 desconexiones espontáneas. Confirma que la cuota demo se
impone exacta bajo carga. 25×10/50×10 NO medidos (requieren entorno
dedicado y sortear el techo single-IP): quedan como ESTIMADO.

## Limitaciones conocidas (no invalidan, acotan)

- Single-IP: el `globalLimiter` recorta mucho antes que CPU/RAM.
- `tsx` en vez de build de producción; laptop Windows, sin Mongo.
- WS contra 1 instancia (el mutex demo y el store asumen 1 réplica en Free).
- `p95≈` interpolado; `cpuLoad1m` en Windows ≈ 0 (loadavg no aplica) → se
  reporta heap como señal principal de memoria.
