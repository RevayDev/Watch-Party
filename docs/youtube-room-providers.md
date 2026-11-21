# Búsqueda de YouTube por sala

Configuración → YouTube permite elegir entre el servicio de la plataforma y un proveedor registrado para la sala. Reproducir enlaces usa el iframe oficial y no necesita una API key. Buscar videos públicos sí usa YouTube Data API v3.

## Servicio de la plataforma

Configura `YOUTUBE_API_KEY` en el backend. El cliente usa `GET /api/youtube/search?q=...` y nunca recibe esa clave. `GET /api/youtube/status` informa únicamente si hay una clave configurada.

## Proveedor de la sala

El anfitrión puede registrar una API key de YouTube Data API o un endpoint propio con token Bearer opcional. La credencial se envía al backend mediante `POST /api/youtube/providers`. Se conserva solo en memoria, durante seis horas, y se pierde al reiniciar el backend.

El registro devuelve una referencia aleatoria de búsqueda y una credencial de revocación separada. Solo la referencia se guarda en `settings.youtubeProvider` y se replica a los participantes. La clave del proveedor no entra en los ajustes, sockets, snapshots ni respuestas de consulta de configuración. La referencia permite buscar y no permite leer la clave original. La credencial de revocación permanece en el almacenamiento de sesión del navegador que hizo el registro.

Las búsquedas envían la referencia en `Authorization: Bearer <referencia>`. Una referencia vencida devuelve 410 y requiere volver a registrar el proveedor. La selección y la referencia sobreviven al relevo de anfitrión; la credencial original sigue en el backend hasta su vencimiento. Este servicio de búsqueda requiere que el backend esté disponible incluso para salas coordinadas entre navegadores.

Los registros son inmutables: cambiar una clave crea otro registro. Volver a la plataforma revoca el registro anterior si se hace desde la sesión del navegador que lo creó. Los demás registros vencen automáticamente. Solo el anfitrión puede cambiar la referencia compartida de la sala.

## Endpoint propio

El administrador debe incluir su origen HTTPS exacto en `YOUTUBE_SEARCH_PROVIDER_ORIGINS`, separado por comas. No se aceptan URLs con credenciales, parámetros o fragmentos. El backend no sigue redirecciones y limita la llamada a cinco segundos. No registres endpoints externos no confiables.

El endpoint recibe `GET <endpoint>?q=<consulta>`, con `Authorization: Bearer <token>` si se registró un token. Debe devolver:

```json
{"tracks":[{"id":"PW6ZSzdjrlo","name":"Canción","artists":"Canal"}]}
```

Se aceptan hasta 50 resultados con IDs de YouTube de 11 caracteres. El backend reconstruye miniaturas y enlaces de YouTube, sin reenviar URLs arbitrarias del proveedor. Las búsquedas y los registros tienen límites por IP. La memoria admite como máximo 1.000 registros vigentes.

Documentación oficial: [Autenticación de YouTube Data API](https://developers.google.com/youtube/data/guides/authentication).
