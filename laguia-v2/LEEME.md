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

- **Resumen** avisa al entrar en una liga con recompensa diaria disponible y permite reclamarla desde la propia app. El servidor envía el cobro, comprueba el estado y el saldo antes y después, y muestra cuántas monedas se han recogido. En móvil también puedes abrir la app oficial desde el aviso.
- **Mi plantilla** permite cambiar entre forma, valor, jornadas, próximo rival, nacionalidad, pie dominante, goles, tarjetas, minutos, balón parado, jerarquía y situación de mercado. El escudo identifica el blindaje activo y el botón de blindar lleva al flujo de anuncios de LALIGA Fantasy.
- **Mercado de mi liga** permite pujar por los jugadores libres y hacer ofertas por los de otros equipos. Las operaciones pasan por una confirmación de importe.
- **Rivales** abre el perfil del mánager en un cuadro central con clasificación, puntos, valor y plantilla. Las cláusulas muestran su precio y protección. Antes de pagar una cláusula, el servidor comprueba el propietario, el importe y el saldo.
- **Asistente** reúne seis acciones por botones. Puedes preparar el once, buscar fichajes en el mercado y las cláusulas, calcular ventas, revisar riesgos y sus recambios, comprobar blindajes y comparar jugadores.
- También se incluyen optimizador y guardado del once, comparador, seguimiento, histórico de valor, simulador de presupuesto, calendario ICS, radar y exportación del plan de jornada.

El asistente usa un motor estadístico local. La proyección base combina 60% media de temporada y 40% últimas cinco jornadas, ajustadas por titularidad. La demo identifica sus ligas, saldo y clasificación como ejemplos. El simulador calcula presupuestos y las operaciones reales pasan por una confirmación. Asistente, Resumen y Radar usan el mercado y la plantilla de la liga activa para las recomendaciones. El seguimiento y los avisos descartados se guardan en este navegador por cuenta y liga. Los avisos se actualizan al consultar la aplicación.

## Fuentes y límites de validación

El catálogo, los datos de liga y las operaciones usan la API de LALIGA Fantasy (`fantasy-api.llt-services.com/api`). La titularidad usa el endpoint público de la web original (`laguia-fantasy.vercel.app/api/titularidad`). Las estadísticas ampliadas se consultan en las alineaciones públicas de FútbolFantasy y se vinculan por equipo y nombre. Los campos sin coincidencia aparecen con un guion. Se indica fecha/jornada de las fuentes y se excluyen probabilidades de otra jornada al calcular proyecciones.

Las operaciones de mercado, cláusulas y recompensas se probaron con datos de una liga simulada. La vista de plantilla y los perfiles se comprobaron en Chromium de escritorio y móvil.

Herramienta independiente, sin afiliación oficial con LALIGA ni FútbolFantasy. Las APIs no documentadas pueden cambiar. Foto del estadio: Unsplash (photo-1522778119026-d647f0596c20).

Ejecuta `node --test` para verificar los contratos de mercado, cláusulas y estadísticas públicas sin usar una liga real.
