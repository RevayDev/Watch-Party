/**
 * OpenAPI 3.0 de la API REST (fuente para Swagger UI en `/api/docs`).
 *
 * REGLA: si añades/cambias un endpoint en `routes/`, actualiza este archivo
 * en el mismo commit (el test `docs-openapi.test.ts` verifica que cada path
 * documentado responde de verdad).
 */

const HOST_HEADERS = [
  {
    name: 'x-leader-secret',
    in: 'header',
    required: false,
    description: 'Secreto del anfitrión (acciones privilegiadas).',
    schema: { type: 'string' },
  },
  {
    name: 'x-user-id',
    in: 'header',
    required: false,
    description: 'Identidad estable del navegador (anti-duplicados).',
    schema: { type: 'string' },
  },
  {
    name: 'x-user-name',
    in: 'header',
    required: false,
    description: 'Nombre visible del participante.',
    schema: { type: 'string' },
  },
];

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Watch Party API',
    version: '1.0.0',
    description:
      'Salas de video sincronizado: crear, unirse, configurar y reproducir juntos. ' +
      'El tiempo real (play/pausa/chat/voz) va por Socket.IO; aquí solo la API REST.',
  },
  tags: [
    { name: 'Salud', description: 'Liveness para probes.' },
    { name: 'Salas', description: 'Crear, ver, unirse, configurar y borrar salas.' },
    { name: 'Video', description: 'Subir, enlazar y reproducir video.' },
    { name: 'Demo', description: 'Disponibilidad de la demo gratuita.' },
    { name: 'Proxy', description: 'Proxy CORS para videos externos (HLS/Drive).' },
    { name: 'Admin', description: 'Panel de administración (ADMIN_TOKEN). Solo lectura + moderación.' },
    { name: 'Spotify', description: 'Música sincronizada: resolver enlaces y OAuth en servidor.' },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['Salud'],
        summary: 'Liveness mínimo',
        responses: {
          '200': {
            description: 'Servidor en pie.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' }, uptimeSec: { type: 'number' } },
                },
              },
            },
          },
        },
      },
    },
    '/api/rooms': {
      post: {
        tags: ['Salas'],
        summary: 'Crear una sala',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['leaderName'],
                properties: {
                  leaderName: { type: 'string', example: 'Ana' },
                  isTemporary: { type: 'boolean', default: true },
                  userId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Sala creada. ¡Guarda el leaderSecret!',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    roomId: { type: 'string', example: 'KX7Q2P' },
                    leaderName: { type: 'string' },
                    leaderSecret: { type: 'string' },
                    status: { type: 'string', example: 'waiting' },
                    isTemporary: { type: 'boolean' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '429': { $ref: '#/components/responses/DemoQuota' },
        },
      },
    },
    '/api/rooms/{roomId}': {
      get: {
        tags: ['Salas'],
        summary: 'Ver una sala (sin secretos)',
        parameters: [{ $ref: '#/components/parameters/RoomId' }],
        responses: {
          '200': {
            description: 'Datos públicos de la sala.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Room' } } },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['Salas'],
        summary: 'Borrar una sala (solo anfitrión)',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, ...HOST_HEADERS],
        responses: {
          '200': { description: 'Sala eliminada.' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/rooms/{roomId}/join': {
      post: {
        tags: ['Salas'],
        summary: 'Unirse a una sala',
        parameters: [{ $ref: '#/components/parameters/RoomId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userName'],
                properties: { userName: { type: 'string', example: 'Luis' }, userId: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'Sala (o `pendingApproval: true` si requiere aprobación: el socket la completa).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Room' } } },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '409': { description: 'Nombre en uso por otro participante.' },
          '429': { $ref: '#/components/responses/DemoQuota' },
        },
      },
    },
    '/api/rooms/{roomId}/settings': {
      patch: {
        tags: ['Salas'],
        summary: 'Cambiar ajustes (solo anfitrión)',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, ...HOST_HEADERS],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['settings'],
                properties: { settings: { $ref: '#/components/schemas/RoomSettings' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Ajustes aplicados.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/rooms/{roomId}/video': {
      post: {
        tags: ['Video'],
        summary: 'Subir video (anfitrión o co-anfitrión; deshabilitado en demo)',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, ...HOST_HEADERS],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { video: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Video guardado.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/rooms/{roomId}/video-url': {
      post: {
        tags: ['Video'],
        summary: 'Poner video por enlace Drive/HLS (anfitrión o co-anfitrión)',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, ...HOST_HEADERS],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url'],
                properties: { url: { type: 'string' }, title: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Video configurado.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/rooms/{roomId}/video/stream': {
      get: {
        tags: ['Video'],
        summary: 'Reproducir (206 con Range, o 302 al enlace externo)',
        parameters: [{ $ref: '#/components/parameters/RoomId' }],
        responses: {
          '206': { description: 'Fragmento del archivo.' },
          '302': { description: 'Redirección al video externo.' },
          '400': { description: 'Spotify se reproduce en el embed del cliente.' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/admin/rooms': {
      get: {
        tags: ['Admin'],
        summary: 'Listar salas activas (sin secretos)',
        parameters: [{ $ref: '#/components/parameters/AdminToken' }],
        responses: {
          '200': { description: 'Lista sanitizada de salas.' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '503': { description: 'Panel no configurado (falta ADMIN_TOKEN).' },
        },
      },
    },
    '/api/admin/rooms/{roomId}': {
      get: {
        tags: ['Admin'],
        summary: 'Detalle de sala (participantes, video, ajustes, solicitudes, expulsados)',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, { $ref: '#/components/parameters/AdminToken' }],
        responses: {
          '200': { description: 'Detalle sanitizado.' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['Admin'],
        summary: 'Cerrar sala (expulsa a todos y la elimina)',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, { $ref: '#/components/parameters/AdminToken' }],
        responses: {
          '200': { description: 'Sala cerrada.' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/admin/rooms/{roomId}/settings': {
      patch: {
        tags: ['Admin'],
        summary: 'Cambiar ajustes de sala (misma whitelist que el anfitrión)',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, { $ref: '#/components/parameters/AdminToken' }],
        responses: {
          '200': { description: 'Ajustes actualizados.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/admin/rooms/{roomId}/kick': {
      post: {
        tags: ['Admin'],
        summary: 'Expulsar o banear ({targetUserName|targetUserId, ban?})',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, { $ref: '#/components/parameters/AdminToken' }],
        responses: {
          '200': { description: 'Usuario expulsado.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/admin/rooms/{roomId}/unban': {
      post: {
        tags: ['Admin'],
        summary: 'Desbanear ({targetUserName|targetUserId})',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, { $ref: '#/components/parameters/AdminToken' }],
        responses: {
          '200': { description: 'Usuario desbaneado.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/admin/rooms/{roomId}/role': {
      post: {
        tags: ['Admin'],
        summary: 'Cambiar rol ({targetUserName, role: coleader|member})',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, { $ref: '#/components/parameters/AdminToken' }],
        responses: {
          '200': { description: 'Rol actualizado.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/admin/rooms/{roomId}/transfer-leader': {
      post: {
        tags: ['Admin'],
        summary: 'Traspasar liderazgo ({targetUserName|targetUserId})',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, { $ref: '#/components/parameters/AdminToken' }],
        responses: {
          '200': { description: 'Liderazgo transferido.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/admin/rooms/{roomId}/rename': {
      post: {
        tags: ['Admin'],
        summary: 'Renombrar participante ({oldName|targetUserId, newName})',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, { $ref: '#/components/parameters/AdminToken' }],
        responses: {
          '200': { description: 'Participante renombrado.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
          '409': { description: 'Nombre en uso.' },
        },
      },
    },
    '/api/admin/rooms/{roomId}/mute': {
      post: {
        tags: ['Admin'],
        summary: 'Silenciar ({kind: mic|camera, targetUserName?}: con objetivo o toda la sala)',
        parameters: [{ $ref: '#/components/parameters/RoomId' }, { $ref: '#/components/parameters/AdminToken' }],
        responses: {
          '200': { description: 'Orden de silencio emitida.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/spotify/resolve': {
      get: {
        tags: ['Spotify'],
        summary: 'Validar un enlace y obtener su embed (?url=)',
        responses: {
          '200': { description: '{kind, id, embedUrl}.' },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      },
    },
    '/api/spotify/status': {
      get: {
        tags: ['Spotify'],
        summary: 'Estado OAuth por sala (?roomId=): {configured, connected}',
        responses: {
          '200': { description: 'Estado.' },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      },
    },
    '/api/spotify/auth-url': {
      get: {
        tags: ['Spotify'],
        summary: 'URL de autorización OAuth (?roomId=)',
        responses: {
          '200': { description: '{authUrl}.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '503': { description: 'Spotify no configurado.' },
        },
      },
    },
    '/api/spotify/callback': {
      get: {
        tags: ['Spotify'],
        summary: 'Callback OAuth (?code=&state=roomId): guarda el token y redirige',
        responses: {
          '302': { description: 'Redirección a la sala.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '502': { description: 'Spotify rechazó el código.' },
        },
      },
    },
    '/api/spotify/disconnect': {
      post: {
        tags: ['Spotify'],
        summary: 'Olvidar el token de la sala ({roomId})',
        responses: {
          '200': { description: '{connected: false}.' },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      },
    },
    '/api/spotify/search': {
      get: {
        tags: ['Spotify'],
        summary: 'Buscar canciones (?q=&roomId=&limit=): client-credentials sin usuario',
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: true,
            description: 'Texto a buscar (2-80 caracteres).',
            schema: { type: 'string' },
          },
          {
            name: 'roomId',
            in: 'query',
            required: true,
            description: 'Sala (aplica los gates musicEnabled/musicAllowSearch).',
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Resultados (1-20, default 10).',
            schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
          },
        ],
        responses: {
          '200': { description: '{tracks: [{id, name, artists, albumArt, durationMs, uri, openUrl}]}.' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '502': { description: 'Spotify falló (upstream).' },
        },
      },
    },
    '/api/demo/availability': {
      get: {
        tags: ['Demo'],
        summary: 'Cuántas salas quedan libres (solo conteos)',
        responses: {
          '200': {
            description: 'Disponibilidad.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    roomsUsed: { type: 'number' },
                    roomsTotal: { type: 'number' },
                    roomsAvailable: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/proxy': {
      get: {
        tags: ['Proxy'],
        summary: 'Descarga un video externo evitando el bloqueo CORS',
        parameters: [
          {
            name: 'url',
            in: 'query',
            required: true,
            description: 'URL http(s) del video o playlist .m3u8.',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': { description: 'Contenido del video.' },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      },
    },
  },
  components: {
    parameters: {
      RoomId: {
        name: 'roomId',
        in: 'path',
        required: true,
        description: 'Código de 6 letras (ej. KX7Q2P).',
        schema: { type: 'string' },
      },
      AdminToken: {
        name: 'x-admin-token',
        in: 'header',
        required: true,
        description: 'Secreto del panel admin (o Authorization: Bearer).',
        schema: { type: 'string' },
      },
    },
    responses: {
      Unauthorized: {
        description: 'Token de administrador inválido o ausente.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      BadRequest: {
        description: 'Petición inválida.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'No existe.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'Sin permiso (no eres anfitrión o estás baneado).',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      DemoQuota: {
        description: 'Cuota demo: sala llena o tope de salas.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
      Participant: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          userId: { type: 'string' },
          isLeader: { type: 'boolean' },
          role: { type: 'string', enum: ['leader', 'coleader', 'member'] },
          joinedAt: { type: 'string', format: 'date-time' },
          device: { type: 'string' },
        },
      },
      RoomSettings: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          isTemporary: { type: 'boolean' },
          requireApproval: { type: 'boolean' },
          muteOnEntry: { type: 'boolean' },
          cameraOffOnEntry: { type: 'boolean' },
          timerMinutes: { type: 'number', nullable: true },
          timerEndsAt: { type: 'string', nullable: true },
        },
      },
      Video: {
        type: 'object',
        properties: {
          originalName: { type: 'string' },
          fileName: { type: 'string' },
          mimeType: { type: 'string' },
          sizeBytes: { type: 'number' },
          sourceType: { type: 'string', enum: ['file', 'url', 'hls', 'spotify'] },
          directUrl: { type: 'string' },
        },
      },
      Room: {
        type: 'object',
        properties: {
          roomId: { type: 'string' },
          leaderName: { type: 'string' },
          status: { type: 'string', enum: ['waiting', 'active', 'closed'] },
          isTemporary: { type: 'boolean' },
          settings: { $ref: '#/components/schemas/RoomSettings' },
          video: { $ref: '#/components/schemas/Video', nullable: true },
          participants: { type: 'array', items: { $ref: '#/components/schemas/Participant' } },
          pendingApproval: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
} as const;
