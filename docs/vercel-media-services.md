# Servicios de música y Drive sin Render

El proyecto Vercel debe usar `frontend` como Root Directory. Las funciones de
`frontend/api` se despliegan junto a Vite, sin iniciar el backend de salas.

En las variables de entorno del proyecto Vercel, configura `YOUTUBE_API_KEY`
con una clave habilitada para YouTube Data API v3. No uses el prefijo `VITE_`:
esta clave solo debe estar disponible en la función del servidor. Aplica la
variable a los entornos necesarios y realiza un nuevo despliegue.

- `GET /api/youtube/status`: indica si hay una clave configurada, sin revelarla.
- `GET /api/youtube/search?q=consulta`: busca y devuelve `{ tracks: [...] }`.
- `GET /api/proxy?url=URL_DE_DESCARGA_DRIVE`: entrega rangos de hasta 4 MiB.

La búsqueda de la plataforma usa el dominio de la web, incluso si
`VITE_API_URL` apunta a Render. Los proveedores de sala registrados en Render
siguen dependiendo de ese servidor; para independencia usa Servicio de la plataforma.
En desarrollo, Vite conserva su proxy `/api` al backend local; las funciones se
verifican directamente con las pruebas o mediante `vercel dev`.

En modo anfitrión, Drive usa el proxy de Vercel. Con servidor externo se usa su
proxy mientras esté disponible; si falla se cambia al auxiliar de Vercel.
Los archivos `blob:` y enlaces HTTPS ordinarios permanecen directos.

El proxy solo acepta HTTPS de los dominios públicos de descarga de Drive y
valida cada redirección. No envía cookies ni credenciales del usuario. Puede
resolver el formulario público de confirmación de descarga, pero no elimina
restricciones de permisos, cuota, archivos privados ni bloqueos de Google.

Estos servicios consumen cuota de YouTube y transferencia/ejecución de Vercel;
no garantizan uso ilimitado gratuito. Las películas no se almacenan en Vercel.
Las reglas SPA excluyen `/api/` para evitar devolver `index.html` a estas peticiones.
