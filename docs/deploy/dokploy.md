# Despliegue de DrawDB en Dokploy

El frontend y la API comparten un dominio. El proxy envía `/` al contenedor web y conserva las rutas `/api` y `/socket.io` al enviarlas al backend. Configura HTTPS para ese dominio.

Los nombres de servicio, puerto y rutas de la API siguen el contrato de Task 9; esa imagen y sus migraciones Prisma aún deben estar disponibles antes de completar el despliegue.

## 1. Preparar la base de datos existente

En el Postgres que ya está desplegado en Dokploy, abre una consola `psql` como `postgres` y ejecuta el SQL equivalente a `create-db.sh`. Sustituye `PASSWORD_SEGURA` por una contraseña fuerte y guarda el mismo valor para `DATABASE_URL`:

```sql
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'drawdb', 'PASSWORD_SEGURA')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'drawdb') \gexec

SELECT format('CREATE DATABASE %I OWNER %I', 'drawdb', 'drawdb')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'drawdb') \gexec
```

Conecta el servicio de backend a la red Docker del Postgres y usa en `DATABASE_URL` su hostname interno y puerto, por ejemplo `postgresql://drawdb:PASSWORD_SEGURA@<host-interno>:5432/drawdb`. No publiques otro Postgres para esta app.

## 2. Crear la app `drawdb-api`

Crea una aplicación Compose desde el fork de `drawdb-server` cuando Task 9 esté listo. Usa el compose y Dockerfile de ese repositorio, conectado tanto a la red de Dokploy como a la red del Postgres existente. El contenedor escucha en el puerto `5000`.

Configura estas variables en Dokploy; reemplaza cada valor de ejemplo por el real:

```dotenv
DATABASE_URL=postgresql://drawdb:PASSWORD_SEGURA@<host-interno>:5432/drawdb
APP_URL=https://<dominio>
PORT=5000
NODE_ENV=production
ALLOWED_EMAIL_DOMAINS=example.com
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<contraseña-fuerte-del-superadmin>
MAIL_HOST=smtp.hostinger.com
MAIL_PORT=465
MAIL_SECURE=true
MAIL_USERNAME=<buzon-de-hostinger>
MAIL_PASSWORD=<contraseña-de-aplicacion-del-buzon>
MAIL_FROM=drawDB <buzon-de-hostinger>
```

`ALLOWED_EMAIL_DOMAINS` acepta dominios separados por comas. `ADMIN_EMAIL` debe ser el correo del superadmin. Usa un buzón creado en Hostinger y su contraseña de aplicación para SMTP.

Task 9 ejecutará `prisma migrate deploy` antes de iniciar el servidor. La imagen del backend debe incluir `prisma/migrations`; no ejecutes scripts SQL de migración antiguos.

## 3. Enrutar la API y Socket.IO

En el dominio `https://<dominio>`, crea las rutas al servicio `drawdb-api`, puerto `5000`:

| Ruta         | Servicio     | Puerto | Ajustes                                  |
| ------------ | ------------ | -----: | ---------------------------------------- |
| `/api`       | `drawdb-api` | `5000` | Conserva el prefijo `/api`               |
| `/socket.io` | `drawdb-api` | `5000` | Conserva el prefijo y habilita WebSocket |

Verifica que `/api` y `/socket.io` tengan prioridad efectiva mayor que la ruta general `/`; el orden en que creas las rutas no garantiza esa prioridad. No elimines ni reescribas los prefijos al enviar las solicitudes al backend. Habilita HTTPS para el dominio.

## 4. Crear la app `drawdb-web`

Crea una aplicación Compose desde este fork y selecciona `compose.dokploy.yaml`. El compose construye la imagen con el `Dockerfile` del repositorio, expone el puerto `80` dentro de Docker y conecta el servicio a la red externa `dokploy-network`.

En el mismo dominio, dirige `/` al servicio `drawdb-web`, puerto `80`, y habilita HTTPS. El runtime del contenedor ya configura la API como `/api`, así que no hace falta definir `VITE_BACKEND_URL`.

## 5. Comprobar el despliegue

1. Abre `https://<dominio>/api/health` y confirma que responde el backend.
2. Inicia sesión con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
3. Abre el mismo proyecto en dos navegadores, con dos cuentas distintas, y comprueba que los cambios y la presencia de ambos usuarios se actualizan en tiempo real.

Estas comprobaciones describen las rutas previstas por Task 9; ejecútalas cuando la imagen del backend esté desplegada.

## 6. Desarrollo local

Usa el Postgres compartido definido en Task 1. Desde `../shared-postgres`, inicia el contenedor y crea las bases local y de pruebas:

```bash
docker compose up -d
./create-db.sh drawdb drawdb drawdb_local
./create-db.sh drawdb_test drawdb drawdb_local
```

Reutiliza el contenedor Mailpit existente `policlinico_mailpit`. Si está detenido, inícialo con `docker start policlinico_mailpit`. Desde el host, SMTP está disponible en `localhost:1026` y la interfaz web en `http://localhost:8026`.

En `drawdb-server`, copia `.env.sample` a `.env` y ajusta los valores locales: `DATABASE_URL=postgresql://drawdb:drawdb_local@localhost:5432/drawdb`, `APP_URL=http://localhost:5173`, los dominios permitidos, un superadmin de desarrollo y `MAIL_HOST=localhost`, `MAIL_PORT=1026`, `MAIL_SECURE=false`. Con `APP_URL` en HTTP, la cookie de sesión no usa el atributo `Secure`. Si el checkout está limpio y no tiene `node_modules`, instala las dependencias con `npm ci`; aplica luego las migraciones Prisma antes de arrancar el backend:

```bash
cd ../drawdb-server
cp .env.sample .env
# Solo en un checkout limpio o sin node_modules:
npm ci
npm run migrate
npm run dev
```

En otra terminal, desde este repositorio, instala dependencias con `npm ci` si hace falta y ejecuta `npm run dev`. Vite sirve el frontend en `http://localhost:5173` y proxya `/api` y `/socket.io` al backend local en el puerto `5000`; ambas rutas conservan el mismo origen para el navegador.

## 7. Asistente de IA para diagramas (LiteLLM)

El asistente de IA es opcional y está **deshabilitado por defecto** (`AI_ENABLED=false`). Todas las llamadas a LiteLLM ocurren exclusivamente desde `drawdb-api`; el frontend nunca recibe credenciales ni URLs internas del proxy.

### 7.1 Variables de entorno en `drawdb-api`

Añade las variables en los secretos del servicio `drawdb-api` en Dokploy (nunca en `drawdb-web` ni en archivos versionados):

```dotenv
AI_ENABLED=false
LITELLM_BASE_URL=https://<tu-proxy-litellm>
LITELLM_API_KEY=<clave-secreta-litellm>
LITELLM_MODEL=gemini-4-argon
AI_ALLOWED_MODELS=gemini-4-argon,gemini-3.8-flash,gemini-pro-latest,gemma-4-26b-a4b-it
AI_MODEL_CAPABILITIES={"gemini-4-argon":{"chat":true,"tools":true,"json":true,"stream":true,"contextWindow":1048576,"maxOutputTokens":65536}}
AI_CATALOG_TTL_MS=60000
AI_CATALOG_REFRESH_MIN_MS=10000
AI_GENERATION_TIMEOUT_MS=60000
AI_MAX_ROUNDS=12
AI_MAX_PROPOSAL_OPS=500
AI_MAX_CONTEXT_BYTES=204800
AI_MAX_MESSAGE_CHARS=8000
AI_MAX_RECENT_MESSAGES=20
AI_MAX_ACTIVE_PER_USER=1
AI_MAX_ACTIVE_GLOBAL=4
AI_RATE_LIMIT_USER_PER_MIN=10
AI_RATE_LIMIT_PROJECT_PER_MIN=30
```

### 7.2 Prueba de conexión frente a prueba de capacidades de propuestas

Una respuesta de texto simple (`CONEXION_OK`) solo demuestra conectividad básica de chat, **no** soporte de herramientas (`tools`) ni de esquema JSON (`response_format`) para propuestas.

Antes de habilitar propuestas para un alias en `AI_MODEL_CAPABILITIES` o activar `AI_ENABLED=true`:

1. Aplica la migración Prisma (`npm run migrate` / `prisma migrate deploy`), que añade `SnapshotKind.pre_ai_apply` y las tablas `ai_conversations`, `ai_messages`, `ai_proposals` y `ai_generations`.
2. Ejecuta desde el contenedor o entorno de `drawdb-api` el script de verificación con mensajes sintéticos (sin pasar claves por argumentos de CLI):
   ```bash
   npx ts-node scripts/ai-capabilities.ts gemini-4-argon gemini-3.8-flash
   ```
3. Habilita `"tools": true` o `"json": true` únicamente en los alias verificados. Los modelos con capacidades desconocidas (`null`) o de solo conversación siguen disponibles para explicar el esquema, pero la interfaz bloquea la generación de propuestas y no cambia de modelo silenciosamente ante errores.

### 7.3 Topología de una sola instancia, retención y desactivación

- **Instancia única de colaboración**: `RoomManager` y `ProjectQueue` serializan en memoria las ediciones manuales de Socket.IO, las restauraciones de historial, el guardado diferido y la confirmación atómica de propuestas de IA. Mantén `drawdb-api` con **una sola réplica** activa.
- **Retención y privacidad**:
  - Las conversaciones y propuestas pendientes son privadas por usuario y proyecto.
  - Las propuestas pendientes caducan a las **24 horas**; conversaciones inactivas y propuestas no aplicadas se podan a los **30 días**.
  - Cada propuesta aplicada crea obligatoriamente una copia previa `pre_ai_apply` en el historial compartido del proyecto (conservada **30 días**). Eliminar una conversación privada borra sus mensajes y propuestas pendientes, pero **conserva** los snapshots `pre_ai_apply` ya creados en el historial del proyecto.
- **Desactivación / Rollback**:
  - Cambia `AI_ENABLED=false` y reinicia `drawdb-api` para desactivar inmediatamente las rutas `/api/projects/:id/ai/*` (`503 ai_disabled`) y ocultar el asistente sin afectar el editor, la colaboración ni el historial.

