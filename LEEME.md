# LAGUÍA Fantasy v2 · Entrega

## Un solo HTML para toda la interfaz

`public/index.html` incluye el CSS, JavaScript, imagen de estadio y una copia inicial de estadísticas públicas. Puedes abrirlo para explorar la demo. Los retratos oficiales y las fuentes se descargan de sus proveedores.

Para datos en vivo, tus ligas y el login, sirve el HTML junto al servidor HTTPS. El servidor es necesario para proteger los tokens; no basta con subir un HTML a un hosting estático.

## Vercel

1. Extrae el ZIP y despliega esta carpeta con Vercel. `vercel.json` configura `public/` como directorio estático y `api/[...route].js` atiende las rutas de un nivel y `api/auth/start.js` registra el inicio de sesión. No hay dependencias de producción.
2. Añade `SESSION_SECRET` en las variables de entorno de producción. Usa un valor aleatorio de al menos 32 bytes y mantenlo secreto. Puedes generar uno en tu ordenador con `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
3. Vuelve a desplegar tras configurar el secreto. Comprueba que `/api/health` indica `"authConfigured": true`. Abre la URL, conecta tu cuenta y elige una liga. Para editar la interfaz, modifica únicamente `public/index.html`.

## Cloudflare Workers

También se incluye `cloudflare-worker.js`, que sirve el mismo HTML y sus endpoints sin archivos estáticos adicionales. Configura `SESSION_SECRET` como secreto del Worker y usa HTTPS. Esta copia no incluye el ZIP de descarga dentro de sí misma.

## Cómo funciona el acceso

El acceso abre la página oficial de LALIGA. Conserva el flujo de la web original: el cliente nativo redirige a `authredirect://com.lfp.laligafantasy`. Copia esa URL final con `code` y `state`, y pégala en el formulario. El servidor valida el estado, canjea el código con PKCE y comprueba el acceso a la API. El primer acceso se recomienda desde ordenador, porque el móvil puede abrir la app oficial.

Al marcar «Recordarme durante 7 días», la cookie dura como máximo una semana. Los tokens se cifran con AES-GCM, las cookies son HttpOnly/Secure/SameSite y la autorización se renueva al usar la app cuando va a caducar. Una revocación o caducidad del permiso de LALIGA obliga a conectar de nuevo. No podemos garantizar siete días si el proveedor deja de admitir la renovación. Sin «Recordarme», la sesión dura hasta 24 horas.

Cambiar `SESSION_SECRET` invalida las sesiones existentes. Cerrar sesión borra las cookies de este navegador; no cierra otras sesiones de tu cuenta LALIGA. Los tokens no se entregan al JavaScript y la contraseña no se solicita en esta web.

## Funciones incluidas

Inicio de sesión → tus ligas → resumen; plantilla y optimizador de siete formaciones con jugadores fijados; guardado del once tras confirmación; catálogo y mercado de tu liga; comparador; seguimiento; probabilidades; detalles y estadísticas por jornada; histórico de valor cuando está disponible; calculadora de pujas sin envío; clasificación y plantillas rivales; calendario y exportación ICS; radar por eficiencia, racha y titularidad; asistente con cálculos de alineaciones, fichajes, ventas y riesgos; avisos dentro de la app; exportación del plan de jornada.

El asistente usa un motor estadístico local, no una API de lenguaje. La proyección base combina 60% media de temporada y 40% últimas cinco jornadas, ajustadas por titularidad. No garantiza resultados. La demo identifica sus ligas, saldo y clasificación como ejemplos. No se envían pujas, ventas ni clausulazos desde el simulador. Seguimiento y preferencias se guardan en este navegador; no hay notificaciones con la aplicación cerrada.

## Fuentes y límites de validación

Se verificaron conexiones al catálogo, la jornada y las probabilidades: API de LALIGA Fantasy (`fantasy-api.llt-services.com/api`) y endpoint público de titularidad de la web original (`laguia-fantasy.vercel.app/api/titularidad`, basado en FútbolFantasy). Esta última es una dependencia de la web original, no una API oficial documentada de FútbolFantasy. Si falta un dato, se muestra como desconocido. Se indica fecha/jornada de las fuentes y se excluyen probabilidades de otra jornada al calcular proyecciones.

29 pruebas automatizadas cubren el motor, navegación con DOM simulado, código OAuth, renovación, cookie de siete días, revocación, propiedad del equipo y guardado del once. El login completo y la renovación con una cuenta real están pendientes de que el titular conecte su cuenta. No se hizo QA visual en navegador porque el entorno no tenía esa herramienta disponible.

Herramienta independiente, sin afiliación oficial con LALIGA ni FútbolFantasy. Las APIs no documentadas pueden cambiar. Foto del estadio: Unsplash (photo-1522778119026-d647f0596c20).
