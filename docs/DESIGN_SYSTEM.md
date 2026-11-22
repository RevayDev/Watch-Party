# Watch Party: sistema de diseño compartido

## Objetivo y dirección
Una misma interfaz para Home, salas con backend y salas del anfitrión. El transporte cambia los datos y las capacidades disponibles, nunca el tema o los controles. Producto: ver videos, conversar y escuchar música con amigos. Carácter: cercano, nocturno y discreto. Mundo: una sala de cine compartida. Momentos: el video, la portada y las cámaras aportan el color. Firma: el índigo identifica la acción principal o la reproducción activa.

## Investigación de la interfaz existente
Auditoría del código y de las capturas del usuario; revisión visual local del panel con 20 resultados. No se introduce otra marca ni una dependencia visual.

| Área | Hallazgo | Decisión |
| --- | --- | --- |
| Home | Botones de navegación y hero con reglas propias, tamaños y radios distintos | Button y ActionLink con variantes compartidas; conservar la composición del hero |
| Sala | Controles definidos en varios archivos con estilos en línea | Button compartido; mantener redondos solo los controles de llamada/reproducción |
| Música | Acciones de ventana mezcladas con transporte; listas y formularios compiten | Ampliar y detener junto a metadatos; una zona desplazable y un pie opaco |
| Configuración | Separador lateral innecesario y variable de fondo inexistente | Espaciado separa navegación y contenido; superficies con tokens definidos |
| Formularios | Inputs, selects, textarea y rangos dispersos | Field, Select, TextArea y Range con la misma paleta, foco y estados |
| Popups | Ventanas ya comparten BottomSheet; menús aún tienen superficies independientes | Conservar BottomSheet y centralizar superficies pequeñas en Popover |
| Backend/anfitrión | Ya comparten RoomHeader, RoomControls, RoomDrawer y RoomSettingsModal | Migrar esas piezas, sin bifurcar estilos por proveedor |

## Tokens y reglas
Fuente Outfit existente. Fondos: --color-bg-main #080c14, --color-bg-input #0f1624, --color-bg-card-solid #111827. Acción: --color-primary #6366f1; hover --color-primary-dark #4f46e5; foco --color-primary-light #818cf8. Texto principal --color-text-main; secundario --color-muted-light. Bordes --color-border, finos, sin resplandor. Peligro se reserva para detener/eliminar/salir.

Espaciado: 4, 8, 12, 16, 24 y 32 px. Controles de texto 40 px, compactos 32 px; iconos 36 px y controles principales 44 px. Radios: controles 8 px, tarjetas 12 px, ventanas 20–24 px. Iconos Lucide de 16–20 px. Foco visible de 2 px y offset de 2 px. Evitar cambios de tamaño en hover. Respetar reduced-motion.

## Contrato de componentes
- Button: primary, secondary, ghost, danger, icon y unstyled; tamaños sm, md y lg. Reenvía ref y props nativas; mantiene submit, disabled y eventos. Unstyled existe para los controles especializados de video/llamada, no para botones nuevos de formularios.
- ActionLink: las mismas variantes para navegación real mediante href.
- Field, Select y TextArea: elementos nativos con foco, colores y estados compartidos. Checkbox/radio y archivos conservan sus interacciones nativas.
- Range: progreso calculado a partir de min, max y value; misma pista y thumb para volumen y posición.
- Surface: tarjeta con borde, fondo y radio comunes; sin lógica de negocio.
- Popover: superficie anclada; cierre opcional por Escape/clic exterior, restaura foco al cerrar por teclado. El contenido conserva botones y enlaces nativos.
- AccordionTrigger: botón controlado con expanded y controls; no incluye enlaces ni otros botones en su interior.
- BottomSheet: ventana/drawer existente con foco, Escape y scroll lock. keepMounted solo cuando debe sobrevivir un reproductor.

## Migración
Los elementos interactivos de src pasan a los componentes compartidos conservando clases de composición, refs, tipos y handlers. Las clases antiguas se mantienen como hooks de estructura y para pruebas; la apariencia de las acciones estándar procede del sistema. Las tarjetas de Home y configuración usan Surface. Las ventanas continúan usando BottomSheet. Los menús de compartir y de música usan Popover. No agregar una implementación especial para Render o anfitrión.

## Verificación y mantenimiento
TypeScript, pruebas del frontend y build. Revisar Home, música con lista larga, configuración y una anchura móvil. Confirmar que añadir limpia la búsqueda, cerrar música no destruye el iframe y las acciones existentes siguen funcionando. No cambiar sincronización, permisos, proveedores o red al migrar diseño. Para nuevas pantallas importar desde shared/components/ui y usar tokens; no inventar colores, botones o popups locales.

## Resultado de esta migración
154 botones, 38 inputs, 3 rangos, 15 superficies y 2 enlaces de acción migrados; los 3 popups existentes y el menú musical usan Popover. Home y música usan AccordionTrigger. Los estilos especializados de la llamada y del video se conservan mediante la variante unstyled y clases de composición, con foco compartido. La lógica de las capacidades del servidor sigue en cada adaptador.

Validación: 44 archivos de pruebas, 336 pruebas aprobadas y 8 omitidas existentes; TypeScript y build correctos. Revisión visual en Home, configuración y música de una sala del anfitrión, en escritorio y a 390 px. Se comprobó reproducción real de YouTube y posición de las acciones en la cabecera del reproductor. La paridad con backend se mantiene usando los mismos componentes y las pruebas existentes de ambos layouts.

## Barra y colaboración
En PC: comunicación a la izquierda, visibilidad centrada, características (música y pantalla) a la derecha, salida al final. Separar por espacio, no líneas. La selección de configuración se indica por superficie, sin barra lateral. Los drawers contienen su contenido con min-width/min-height 0 y mantienen sus esquinas; los formularios no sobrepasan las tarjetas. ConnectionCard presenta conexiones y errores con borde discontinuo.

Compartir pantalla usa el selector del navegador para pantalla, ventana o pestaña y usa una pista de video independiente de la cámara; el micrófono se conserva. La imagen compartida se muestra en el escenario principal, con audio remoto en su reproductor existente para evitar duplicados. No se captura audio del sistema. Al detener o salir se libera la captura y la cámara conserva su estado.

El propietario del servidor del navegador elige salir solo o cerrar para todos. La salida voluntaria espera un snapshot del sucesor; para archivos locales se exige una copia confirmada antes del relevo. Si no se confirma, conserva al usuario en la sala y ofrece reintentar. La selección, permisos y captura deben probarse entre dos navegadores/dispositivos reales además de los tests simulados.

La distribución de escritorio fija dispositivos a la izquierda y salida a la derecha; conversación/visibilidad y características forman dos grupos centrales separados. Los probadores locales también se abren con la flecha junto al icono de micrófono o cámara. El SDP reserva audio, cámara y pantalla en slots independientes, y la recepción separa ambos videos para evitar sustituir la cámara por la pantalla.

## Chat y confirmaciones de lectura
El envío y los botones de reacción usan controles cuadrados de esquinas suaves; el selector aparece separado de la barra. Responder permanece visible por mensaje y conserva una cita navegable. Los nuevos mensajes guardan fecha ISO desde el servidor/coordinador y se muestran en la hora local del receptor.
Cada lector ocupa solo un avatar bajo su último mensaje visto; la interfaz informa lectura cuando al menos el 60% del mensaje entra en el historial visible y la pestaña está activa. Render autentica al lector con su sesión y limita el ritmo; el anfitrión replica las posiciones en el snapshot para conservarlas en el relevo. Es una confirmación de visibilidad, no de atención humana.

## Acciones flotantes y mensajes
Las acciones Cambiar/Quitar del video viven en PlayerActionDock: se arrastran con el asa, admiten flechas de teclado y se pliegan hacia el borde derecho. No duplicar el botón flotante móvil. Los menús anclados se dibujan en un portal sobre el contenido (incluida pantalla completa), se ajustan al viewport y no dependen del overflow de la cola o del chat. El borrado musical solo aparece en el menú.

Los mensajes muestran responder/reaccionar y, para el autor, más opciones al pasar el ratón o enfocar; en móvil se ocultan y una pulsación larga de 500 ms abre responder, reaccionar y las opciones del autor. Mover el dedo más de 10 px, desplazar el chat o soltar antes cancela el gesto. Las reacciones se superponen al borde inferior de la burbuja sin ocupar la fila de acciones. Editar y eliminar están en ese menú. Las respuestas muestran el destinatario y la cita separada de la burbuja. Eliminar y reaccionar se validan en el backend/coordinador; los mensajes borrados conservan una marca para mantener citas y lecturas, y no pueden editarse después.

## Sala en móviles
Hasta 768 px, cabecera y barra inferior aprovechan el ancho con márgenes de 6 px. Los contadores de participantes y reloj se ocultan en la cabecera; Compartir conserva nombre accesible y muestra solo el icono hasta 420 px. Los menús de cabecera usan el portal anclado para no salir del viewport.
Los paneles de Sala usan altura automática con máximo 85dvh: una lista de un participante no ocupa toda la pantalla, y Música crece con los resultados manteniendo su pie visible y el listado desplazable. En búsqueda, portada y texto comparten fila y las acciones ocupan una fila horizontal de ancho completo. Revisión local a 320 y 390 px: cabecera y barra sin overflow; Participantes con una persona mide aproximadamente 263 px de alto.
