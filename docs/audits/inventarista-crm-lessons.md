# Auditoría C-A-R — Inventarista CRM (reporte diario de ventas SuiteCRM)

Fecha: 2026-06-17 · Feature: agente que cada 7am Colombia deja en el chat las ventas
del SuiteCRM de Jeans Colombianos. Auditoría adversarial multi-agente (6 dimensiones ×
verificación escéptica). **50 hallazgos crudos → 32 confirmados (2 CRIT + 18 IMP), 12 refutados.**

## CRIT (corrupción silenciosa de datos)

1. **Lectura con `redirect:'follow'` → "$0 sin ventas" falso.** El fetch de lectura no
   fijaba `redirect:'manual'`; si la sesión/período caía, el CRM respondía 301→login y
   `fetch` seguía hasta una página de login (200) sin filas → `parseInvoiceRows`=[] →
   `break` → `getSales` devolvía 0 facturas como si fuera un día sin ventas.
   **Causa raíz (constructor):** se asumió que "0 filas" siempre significa "0 ventas".
   **Fix:** `redirect:'manual'` en lecturas; lanzar si status 3xx o `looksLikeLogin(html)`;
   distinguir "list view vacío legítimo" de "no es el list view" (si `totalCount>0` pero 0
   filas → error de parseo). Tests: login→lanza, 3xx→lanza.

2. **Login validado solo por presencia de PHPSESSID.** SugarCRM setea PHPSESSID al
   renderizar el form de login, así que credenciales malas "pasaban".
   **Fix:** `isLoginFailureRedirect()` mira el `action` real del Location. 
   **Sub-lección (meta):** el primer fix tenía un FALSO POSITIVO — el login EXITOSO
   redirige a `DefinirPeriodo` con `return_action=Login` como parámetro, y el regex
   `/action=Login/` lo marcaba como fallo. Lo cazó el **test en vivo** (no los unитarios).
   Lección: anclar matches de querystring (`[?&]action=`), y un detector de "fallo de auth"
   debe excluir explícitamente el redirect de éxito.

## IMP destacados

- **`last_7_days` abarcaba 8 días** (bogotaDate(7)..bogotaDate(0), ambos inclusive). Fix:
  bogotaDate(7)..bogotaDate(1) = 7 días terminando ayer; etiqueta y spec alineados.
- **Período bloqueado + rango cross-mes** → total incompleto en silencio. Fix:
  `periodWarning()` avisa cuando el rango sale del mes vigente (día 1, semanas a caballo).
- **Parseo frágil:** fila truncada por `</tr>` de tablas anidadas (segmentar por inicio de
  ListRow), gate que exigía `field="name"` (relajado a checkbox `mass[]`), `totalCount`
  atado a la palabra "de" (tolerante a "of"/idioma), montos contables `($50)` que sumaban
  positivo (signo negativo), entidades HTML sin decodificar.
- **Sin timeout en fetch** (convención del repo: `AbortSignal.timeout`). Añadido a todos.
- **Cron sin idempotencia** (header decía "Idempotente" falsamente): doble disparo =
  conversaciones duplicadas. Fix: guard "¿ya reporté hoy?" por `metadata.source` + día Bogota.
- **Burbuja de usuario falsa:** el prompt disparador se pintaba como mensaje del usuario.
  Fix: `Agents.jsx` trata `source==='scheduled_report'` como nota de sistema (igual que
  `approval_resume`).
- **Prompt-injection:** nombres de cliente/sucursal (datos no confiables del CRM) entran al
  LLM. Fix: saneo en `cell()`, acote de longitud, refuerzo en el system prompt.

## Verificado contra la DB (no concluible desde el código)
- Visibilidad RLS: el agente (brand_id null) y sus mensajes SON visibles; la conversación
  (created_by/brand null) se ve por `is_junta()` → Brandon (junta) la ve. Patrón ya usado
  por el agente `contador`. Aceptable; un `member` no la vería.
- `provider=openrouter`/`moonshotai/kimi-k2.6` y el secreto `crm_ai_service_role_key` existen
  (los usan agentes vivos + el heartbeat).

## Meta-lecciones para el próximo sprint
1. Toda integración HTTP scrapeada: **distinguir "vacío legítimo" de "página equivocada"**
   ANTES de aceptar 0 resultados. Es el bug #1 de scrapers.
2. Aritmética de fechas con rangos inclusivos: escribir PRIMERO el test del span (N días).
3. Detectores de fallo de auth: excluir el caso de éxito explícitamente; validar con el
   Location REAL observado, no con uno imaginado.
4. Un `fetch` sin `AbortSignal.timeout` es un cuelgue esperando ocurrir (convención del repo).

Build + audit en el mismo PR (entrelazados por la reescritura de `suitecrm.ts`). Tests:
`deno test --allow-env supabase/functions/_shared/suitecrm.test.ts` → 15 passed.
