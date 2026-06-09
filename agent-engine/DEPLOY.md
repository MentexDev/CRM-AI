# 🚀 Desplegar el motor agéntico

El motor es una API FastAPI ([server.py](server.py)) que corre el Crew. La UI React
lo consume por HTTP. Cloudflare Workers **no sirve** (es JS, no corre Python): hace
falta un host Python. Aquí van tres caminos.

## Contrato de la API

| Método | Ruta | Body / Resp |
|--------|------|-------------|
| `GET`  | `/health` | `{ ok, model, active_runs }` |
| `POST` | `/runs` | body `{ "directive": "..." }` → `{ run_id, status: "running" }` |
| `GET`  | `/runs/{run_id}` | `{ status: running\|done\|error, result?, error? }` |

Auth opcional: si defines `ENGINE_API_KEY`, todas las llamadas exigen la cabecera
`X-Engine-Key: <esa key>`.

### Variables de entorno (en el host)
```
OPENROUTER_API_KEY   = sk-or-v1-...
MODEL                = openrouter/meta-llama/llama-3.3-70b-instruct
SUPABASE_URL         = https://ccaufudzkgvrdxwmazwk.supabase.co
SUPABASE_ANON_KEY    = sb_publishable_...
NINA_BRAND_ID        = ac009239-c8ca-4b45-99ad-6a804419836c
ENGINE_API_KEY       = (inventa un secreto largo; la UI lo envía en X-Engine-Key)
```

---

## Opción A · Railway (la más simple, recomendada)
No requiere Docker. Detecta Python solo.

1. Sube `agent-engine/` a un repo de GitHub (o usa el monorepo y pon *Root Directory* = `agent-engine`).
2. En **railway.app** → *New Project* → *Deploy from GitHub repo*.
3. En *Variables*, pega las del bloque de arriba.
4. Railway usa [railway.json](railway.json) / [Procfile](Procfile) y te da una URL pública
   (`https://<algo>.up.railway.app`). Verifica `GET /health`.

## Opción B · Fly.io
Usa Docker ([Dockerfile](Dockerfile) + [fly.toml](fly.toml)).
```bash
cd agent-engine
fly launch --no-deploy            # edita el nombre de app si lo pide
fly secrets set OPENROUTER_API_KEY=... MODEL=... SUPABASE_URL=... \
               SUPABASE_ANON_KEY=... NINA_BRAND_ID=... ENGINE_API_KEY=...
fly deploy
fly open                          # abre la URL; prueba /health
```

## Opción C · VPS propio (el camino "infra propia" de Diego)
```bash
# en el VPS (Ubuntu): instala Docker, clona el repo
cd agent-engine
cp .env.example .env && nano .env     # completa las variables
docker build -t crm-engine .
docker run -d --env-file .env -p 8000:8000 --restart unless-stopped crm-engine
# detrás de Nginx + certbot para HTTPS en tu dominio
```

---

## Cómo lo llama la UI React (ejemplo)
```js
const ENGINE = import.meta.env.VITE_ENGINE_URL          // p.ej. https://...railway.app
const KEY    = import.meta.env.VITE_ENGINE_KEY          // == ENGINE_API_KEY

// 1) lanzar una corrida
const { run_id } = await fetch(`${ENGINE}/runs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Engine-Key': KEY },
  body: JSON.stringify({ directive: 'Impulsa NINA para el Día de la Madre' }),
}).then(r => r.json())

// 2) sondear hasta que termine
async function poll() {
  const run = await fetch(`${ENGINE}/runs/${run_id}`, {
    headers: { 'X-Engine-Key': KEY },
  }).then(r => r.json())
  if (run.status === 'running') return setTimeout(poll, 3000)
  console.log(run.status === 'done' ? run.result : run.error)
}
poll()
```

## Notas de producción
- **Persistencia de corridas:** híbrida — memoria (rápido para el polling) + Supabase
  (tabla `agent_runs` vía Edge Function `agent-run`). Si el motor reinicia, `GET /runs/{id}`
  cae a la BD; las corridas y su historial sobreviven. Una corrida `running` más vieja
  que 15 min se asume caída (el motor reinició a mitad).
- Restringe `allow_origins` del CORS al dominio real de la UI.
- (Opcional) modelo más fuerte en tool-calling vía `MODEL` (p.ej. `openrouter/anthropic/claude-sonnet-4.5`).
