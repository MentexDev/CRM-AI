# Evals de los agentes

Batería de pruebas automáticas que verifican el **comportamiento** de los agentes del CRM
contra el runtime desplegado (`chat-with-agent`). Reemplaza el "probar a mano" de cada C-A-R
por algo repetible: detecta solo cuándo un agente "se daña" (provider caído, dejó de elegir
la herramienta correcta, dejó de producir un artefacto, etc.).

## Correr

```bash
node evals/run.mjs                 # todos los casos
node evals/run.mjs creador         # solo casos cuyo nombre/agente contenga "creador"
node evals/run.mjs --no-cleanup    # conserva las conversaciones creadas (para depurar)
```

Sale con código `0` si todo pasa y `1` si algo falla (sirve para CI / un futuro hook de deploy).

## Credenciales

En este orden:
1. `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` (ideal para CI).
2. Si no, las obtiene de la Management API con `SUPABASE_ACCESS_TOKEN` o `~/.supabase/access-token`.

Otras variables: `EVAL_USER_EMAIL` (usuario de prueba), `SUPABASE_PROJECT_REF` (proyecto).

## Cómo funciona

- Autentica al usuario de prueba sin `supabase-js` (Node 20 no trae WebSocket): `generate_link` (magiclink) → `verify` → JWT.
- Por cada caso: llama a `chat-with-agent`, lee los mensajes de la conversación y arma un *transcript*
  (`calledTools` desde `tool_calls[].function.name`, `artifacts` desde `data.kind` de los resultados, `reply`).
- Evalúa las aserciones del caso y reporta pass/fail.
- Borra las conversaciones efímeras al final (salvo `--no-cleanup`).

## Añadir casos

Edita [`cases.mjs`](./cases.mjs). Un caso:

```js
{
  name: 'creador-genera-documento',
  agent: 'creador-de-contenido',        // slug del agente
  message: 'Usa tu herramienta de documento para…',
  expect: [httpOk(), calledTool('draft_document'), producedArtifact('document')],
}
```

Aserciones disponibles: `httpOk`, `replied`, `calledTool(name)`, `didNotCallTool(name)`,
`producedArtifact(kind)`, `producedNoArtifact`, `replyMatches(re)`, `replyNotMatches(re)`.

**Regla anti-flaky:** los LLM no son deterministas. Usa instrucciones **directivas**
("usa tu herramienta de X para…") y aserciones **robustas** (que la herramienta esté entre
las llamadas, que exista el artefacto), nunca comparaciones exactas de texto libre.

## Costo

Cada caso es 1 turno real del agente (consume tokens del proveedor, fracciones de centavo).
Mantén la suite enfocada; corre subconjuntos con el filtro mientras desarrollas.
