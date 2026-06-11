# Graph Report - .  (2026-06-11)

## Corpus Check
- 97 files · ~67,957 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 614 nodes · 1005 edges · 29 communities (27 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.79)
- Token cost: 37,000 input · 3,799 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Núcleo Edge · Runtime de Agentes|Núcleo Edge · Runtime de Agentes]]
- [[_COMMUNITY_Motor Agéntico · CrewAI (Python)|Motor Agéntico · CrewAI (Python)]]
- [[_COMMUNITY_Generación de Imágenes & Conectores|Generación de Imágenes & Conectores]]
- [[_COMMUNITY_Acciones · Memoria & Inventario|Acciones · Memoria & Inventario]]
- [[_COMMUNITY_Documentación · Cerebro & Motor|Documentación · Cerebro & Motor]]
- [[_COMMUNITY_Componentes · Modales & Diálogos|Componentes · Modales & Diálogos]]
- [[_COMMUNITY_Workspace del Agente · Chat|Workspace del Agente · Chat]]
- [[_COMMUNITY_Transcripción de Voz|Transcripción de Voz]]
- [[_COMMUNITY_Dependencias (package.json)|Dependencias (package.json)]]
- [[_COMMUNITY_Ingesta del Cerebro · Chunking & Embeddings|Ingesta del Cerebro · Chunking & Embeddings]]
- [[_COMMUNITY_Biblioteca · Entregables|Biblioteca · Entregables]]
- [[_COMMUNITY_Tareas · Kanban & Filtros|Tareas · Kanban & Filtros]]
- [[_COMMUNITY_Layout Admin · Sidebar & Navegación|Layout Admin · Sidebar & Navegación]]
- [[_COMMUNITY_Sync de Obsidian|Sync de Obsidian]]
- [[_COMMUNITY_Render de Resultados de Tools|Render de Resultados de Tools]]
- [[_COMMUNITY_Páginas Admin · AprobacionesMarcasProducción|Páginas Admin · Aprobaciones/Marcas/Producción]]
- [[_COMMUNITY_Diálogos de Sistema & Providers|Diálogos de Sistema & Providers]]
- [[_COMMUNITY_API del Motor · FastAPI|API del Motor · FastAPI]]
- [[_COMMUNITY_Autenticación & Top Bar|Autenticación & Top Bar]]
- [[_COMMUNITY_Deploy · Railway|Deploy · Railway]]
- [[_COMMUNITY_Contexto de Autenticación (sesión)|Contexto de Autenticación (sesión)]]
- [[_COMMUNITY_Página de Equipo|Página de Equipo]]
- [[_COMMUNITY_Proxy Seguro del Motor (run-engine)|Proxy Seguro del Motor (run-engine)]]

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 25 edges
2. `adminDb()` - 17 edges
3. `build_crew()` - 12 edges
4. `runAgentStep()` - 11 edges
5. `syncSingleNote()` - 11 edges
6. `withAuthRetry()` - 10 edges
7. `useConfirm()` - 9 edges
8. `useAgents()` - 9 edges
9. `runAgentChatTurn()` - 9 edges
10. `requireEngineKey()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `pip-compile hashed lock (supply-chain integrity)` --semantically_similar_to--> `Supply-chain SHA pinning of actions`  [INFERRED] [semantically similar]
  agent-engine/requirements.txt → .github/workflows/security.yml
- `CrewAI Agentic Engine POC` --semantically_similar_to--> `run-agent-step agent runtime (v18)`  [INFERRED] [semantically similar]
  agent-engine/README.md → docs/BRAIN.md
- `CRM · AI Mentex Holding SPA (index.html)` --conceptually_related_to--> `CrewAI Agentic Engine POC`  [INFERRED]
  index.html → agent-engine/README.md
- `pip-audit del motor` --conceptually_related_to--> `requests>=2.32.4 (CVE-2024-35195)`  [INFERRED]
  .github/workflows/security.yml → agent-engine/requirements.txt
- `Hybrid run persistence (memory + Supabase agent_runs)` --shares_data_with--> `Supabase (auth + DB)`  [INFERRED]
  agent-engine/DEPLOY.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Automated supply-chain security gate** — security_npm_audit, security_pip_audit, security_gitleaks, security_supply_chain_pinning [EXTRACTED 0.90]
- **CrewAI agent tool suite over Supabase Edge Functions** — engine_readme_brain_tool, engine_readme_memory_tool, engine_readme_action_tool, engine_readme_commerce_tool [EXTRACTED 0.85]
- **Self-evolving / self-healing brain loop** — brain_run_agent_step, brain_aetherna, brain_doctor, brain_pg_cron, brain_knowledge_store [INFERRED 0.80]

## Communities (29 total, 2 thin omitted)

### Community 0 - "Núcleo Edge · Runtime de Agentes"
Cohesion: 0.06
Nodes (38): CORS_HEADERS, VALID_BRAND_ROLES, VALID_GLOBAL_ROLES, CORS, extractLearnings(), Learning, CORS, CORS_HEADERS (+30 more)

### Community 1 - "Motor Agéntico · CrewAI (Python)"
Cohesion: 0.06
Nodes (38): main(), Demo de las nuevas tools del CRM en el motor — sin gastar LLM.    1) web_search, main(), Demo de MEMORIA PERSISTENTE por agente — sin gastar tokens del LLM.  Simula dos, Smoke-test: construye el Crew contra la librería real de CrewAI sin llamar al LL, main(), Demo de ACCIONES REALES sobre el flujo del proyecto — sin gastar LLM.  El Brand, BaseModel (+30 more)

### Community 2 - "Generación de Imágenes & Conectores"
Cohesion: 0.06
Nodes (36): CORS_HEADERS, authHeaders(), higgsfieldGenerateImage(), sleep(), StatusResponse, SubmitResponse, aspectToDims(), generateImage() (+28 more)

### Community 3 - "Acciones · Memoria & Inventario"
Cohesion: 0.06
Nodes (35): CORS, CORS, embedText(), json(), CORS, adjustInventory(), CORS, getInventoryBySku() (+27 more)

### Community 4 - "Documentación · Cerebro & Motor"
Cohesion: 0.06
Nodes (47): Protocolo Aetherna (autonomous distillation), create_agent tool (CEO only), Brain — Auto-evolving institutional memory, brain-doctor auto-healing + health_score, Hybrid retrieval (70% vector + 20% FTS + 10% importance), ingest-document Edge Function, Knowledge store (documents/chunks/entities/relations), obsidian-sync ingestion + wiki-link graph (+39 more)

### Community 5 - "Componentes · Modales & Diálogos"
Cohesion: 0.09
Nodes (19): AgentEngineModal(), STATUS_DOT, BRAND_ROLES, GLOBAL_ROLES, InviteMemberModal(), Modal(), useMobile(), DetailsStep() (+11 more)

### Community 6 - "Workspace del Agente · Chat"
Cohesion: 0.07
Nodes (29): ConversationHistory(), AgentHome(), agentIcon(), AgentWorkspace(), ChatComposer(), ConfigTab(), CONNECTOR_CATALOG, CONNECTOR_SOON (+21 more)

### Community 7 - "Transcripción de Voz"
Cohesion: 0.07
Nodes (20): DEMO_SENTENCES, detectAndFormatList(), EN_MARKERS, EN_NUM, ES_MARKERS, ES_NUM, isInSandboxedIframe, KNOWN_BRANDS (+12 more)

### Community 8 - "Dependencias (package.json)"
Cohesion: 0.08
Nodes (25): dependencies, framer-motion, lucide-react, react, react-dom, react-hot-toast, react-router-dom, @supabase/supabase-js (+17 more)

### Community 9 - "Ingesta del Cerebro · Chunking & Embeddings"
Cohesion: 0.13
Nodes (23): buildChunk(), buildExtractionPrompt(), buildOpenAIClient(), Chunk, chunkMarkdown(), cleanText(), embedBatch(), Entity (+15 more)

### Community 10 - "Biblioteca · Entregables"
Cohesion: 0.16
Nodes (14): AssetCard(), AssetDetailModal(), AssetRow(), Biblioteca(), KIND_META, kindMeta(), useLibraryAssets(), fmtCOP() (+6 more)

### Community 11 - "Tareas · Kanban & Filtros"
Cohesion: 0.11
Nodes (11): agentIcon(), fmtFull(), fmtRelative(), ListRow(), PRIORITY, SPECIALTY_ICON, STATUS_COLUMNS, STATUS_INFO (+3 more)

### Community 12 - "Layout Admin · Sidebar & Navegación"
Cohesion: 0.10
Nodes (12): AdminLayout(), AGENT_SPECIALTY_ICON, AGENT_STATUS_DOT, AgentsNav(), CONV_FILTERS, getWorkspace(), INDICATOR, WORKSPACE_NAV (+4 more)

### Community 13 - "Sync de Obsidian"
Cohesion: 0.16
Nodes (18): CORS, createWikiRelation(), downloadFile(), extractTitle(), listMarkdownFiles(), loadBrandMap(), ParsedNote, parseFrontmatter() (+10 more)

### Community 14 - "Render de Resultados de Tools"
Cohesion: 0.16
Nodes (5): GeneratedImage(), Header(), safeHref(), ToolResultBubble(), truncate()

### Community 15 - "Páginas Admin · Aprobaciones/Marcas/Producción"
Cohesion: 0.18
Nodes (5): Approvals(), TRIGGER_LABEL, Brands(), STATUS_BADGE, Protected()

### Community 16 - "Diálogos de Sistema & Providers"
Cohesion: 0.22
Nodes (6): ConfirmContext, ConfirmProvider(), useConfirm(), ConversationMenu(), SettingsModal(), AuthProvider()

### Community 17 - "API del Motor · FastAPI"
Cohesion: 0.30
Nodes (10): _auth(), get_run(), _is_stale(), _persist(), API web del motor agéntico — expone el Crew para que la UI React lo consuma.  Pa, Llama a la Edge Function agent-run (best-effort; si falla, seguimos en memoria)., _run_crew(), RunRequest (+2 more)

### Community 18 - "Autenticación & Top Bar"
Cohesion: 0.27
Nodes (6): SidebarUserBlock(), useConnectionState(), TopBar(), useAuth(), isSupabaseConfigured, Login()

### Community 19 - "Deploy · Railway"
Cohesion: 0.25
Nodes (7): build, builder, deploy, restartPolicyMaxRetries, restartPolicyType, startCommand, $schema

### Community 21 - "Página de Equipo"
Cohesion: 0.40
Nodes (3): ROLE_COLOR, ROLE_LABEL, Team()

## Knowledge Gaps
- **138 isolated node(s):** `Crew`, `$schema`, `builder`, `startCommand`, `restartPolicyType` (+133 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useAuth()` connect `Autenticación & Top Bar` to `Componentes · Modales & Diálogos`, `Workspace del Agente · Chat`, `Tareas · Kanban & Filtros`, `Layout Admin · Sidebar & Navegación`, `Páginas Admin · Aprobaciones/Marcas/Producción`, `Diálogos de Sistema & Providers`, `Contexto de Autenticación (sesión)`, `Página de Equipo`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `adminDb()` connect `Núcleo Edge · Runtime de Agentes` to `Generación de Imágenes & Conectores`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `Demo de las nuevas tools del CRM en el motor — sin gastar LLM.    1) web_search`, `Crew`, `Crew del CRM · Agent — jerarquía CEO → Brand Manager NINA → Creador de Contenido` to the rest of the system?**
  _155 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Núcleo Edge · Runtime de Agentes` be split into smaller, more focused modules?**
  _Cohesion score 0.062146892655367235 - nodes in this community are weakly interconnected._
- **Should `Motor Agéntico · CrewAI (Python)` be split into smaller, more focused modules?**
  _Cohesion score 0.06103896103896104 - nodes in this community are weakly interconnected._
- **Should `Generación de Imágenes & Conectores` be split into smaller, more focused modules?**
  _Cohesion score 0.058069381598793365 - nodes in this community are weakly interconnected._
- **Should `Acciones · Memoria & Inventario` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._