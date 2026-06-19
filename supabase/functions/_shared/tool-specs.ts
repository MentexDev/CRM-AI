// AUTO-GENERADO desde tools_registry (Fase 1.5 · migración a ToolRegistry).
// Fuente de verdad de los SCHEMAS de tools EN EL REPO (antes vivían solo en la BD).
// Regenerar: query a tools_registry → este archivo. No editar a mano.

export interface ToolSpecData {
  name: string
  description: string
  category: string
  parameters: Record<string, unknown>
  requiresApproval: boolean
  isActive: boolean
}

export const TOOL_SPECS: ToolSpecData[] = [
  {
    "name": "create_agent",
    "description": "Solicita la creación de un nuevo agente especializado. Exclusivo del CEO Global. Requiere aprobación de la Junta antes de activarse.",
    "category": "system",
    "parameters": {
      "type": "object",
      "required": [
        "name",
        "slug",
        "role",
        "system_prompt",
        "allowed_tools",
        "justification"
      ],
      "properties": {
        "name": {
          "type": "string"
        },
        "role": {
          "enum": [
            "specialist",
            "brand_manager"
          ],
          "type": "string"
        },
        "slug": {
          "type": "string",
          "description": "Identificador único en kebab-case"
        },
        "model": {
          "type": "string",
          "default": "llama-3.3-70b-versatile"
        },
        "brand_id": {
          "type": "string"
        },
        "specialty": {
          "type": "string"
        },
        "allowed_tools": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "justification": {
          "type": "string",
          "description": "Por qué se necesita este agente"
        },
        "system_prompt": {
          "type": "string"
        },
        "parent_agent_id": {
          "type": "string"
        }
      }
    },
    "requiresApproval": true,
    "isActive": true
  },
  {
    "name": "delegate_task",
    "description": "Delegar una tarea a otro agente subordinado. Crea una tarea en su tablero kanban.",
    "category": "core",
    "parameters": {
      "type": "object",
      "required": [
        "agent_slug",
        "title",
        "objective"
      ],
      "properties": {
        "title": {
          "type": "string",
          "description": "Título corto y accionable."
        },
        "due_at": {
          "type": "string",
          "format": "date-time"
        },
        "context": {
          "type": "string",
          "description": "Contexto necesario para ejecutar."
        },
        "priority": {
          "type": "integer",
          "maximum": 5,
          "minimum": 1
        },
        "objective": {
          "type": "string",
          "description": "Qué se quiere lograr."
        },
        "agent_slug": {
          "type": "string",
          "description": "Slug del agente destinatario."
        },
        "success_criteria": {
          "type": "string",
          "description": "Cómo se sabe que está hecha."
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "escalate_to_ceo",
    "description": "Escalar una situación al CEO Global cuando el Brand Manager está bloqueado o duda.",
    "category": "core",
    "parameters": {
      "type": "object",
      "required": [
        "reason",
        "question"
      ],
      "properties": {
        "reason": {
          "type": "string"
        },
        "question": {
          "type": "string"
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "finish_task",
    "description": "Marcar una tarea propia como completada con su resultado.",
    "category": "core",
    "parameters": {
      "type": "object",
      "required": [
        "task_id",
        "result_summary"
      ],
      "properties": {
        "task_id": {
          "type": "string",
          "format": "uuid"
        },
        "result_data": {
          "type": "object"
        },
        "result_summary": {
          "type": "string"
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "generate_image",
    "description": "Generar o EDITAR una imagen con Gemini 3 Pro Image (Nano Banana Pro) a partir de un prompt visual. Acepta imágenes de referencia (reference_image_urls): p.ej. la foto del PRODUCTO real de NINA y/o una MODELO — Gemini aplica el producto exacto a la escena ('ponle ESTE pantalón a ESTA modelo en un estadio del Mundial'). Útil para mockups, campañas, propuestas visuales. La imagen vuelve como URL pública. NO publica nada — sólo crea el asset. Para publicar externamente, después usa request_approval para que la Junta autorice.",
    "category": "image",
    "parameters": {
      "type": "object",
      "required": [
        "prompt"
      ],
      "properties": {
        "prompt": {
          "type": "string",
          "description": "Descripción visual detallada en inglés (mejores resultados) o español. Sé específico sobre escena, estilo, iluminación, look. Si pasas reference_image_urls, di qué hacer con ellas (ej. 'usa el pantalón de la imagen 1 sobre la modelo de la imagen 2')."
        },
        "reference_image_urls": {
          "type": "array",
          "items": { "type": "string" },
          "description": "URLs públicas de imágenes de referencia que Gemini debe usar como base: foto del producto REAL de NINA (para que la prenda sea exacta) y/o foto de la modelo. Úsalas cuando el usuario adjunte o señale un producto/modelo específico."
        },
        "style_hint": {
          "type": "string",
          "description": "Referencia de estilo opcional (ej. 'editorial fashion photography', 'cinematic moody', 'minimal product shot')."
        },
        "aspect_ratio": {
          "enum": [
            "1:1",
            "16:9",
            "9:16",
            "4:5",
            "3:2"
          ],
          "type": "string",
          "default": "1:1",
          "description": "1:1 para feed Instagram, 9:16 para stories/reels, 4:5 portrait Instagram, 16:9 web/landing."
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "draft_document",
    "description": "Redactar un DOCUMENTO de trabajo (estilo Notion) que se abre EDITABLE en el canvas: brief, guion, plan de contenido, propuesta, notas, artículo. Devuelve el documento en Markdown; el usuario puede editarlo, exportarlo (MD/PDF) y guardarlo en la biblioteca. NO envía ni publica nada — solo crea el documento de trabajo. Para campañas de correo HTML usa compose_email; esto es para texto/documentos de trabajo.",
    "category": "document",
    "parameters": {
      "type": "object",
      "required": [
        "title",
        "content"
      ],
      "properties": {
        "title": {
          "type": "string",
          "description": "Título del documento."
        },
        "content": {
          "type": "string",
          "description": "Cuerpo en Markdown (GFM): # / ## / ### para títulos, listas con - o 1., casillas - [ ] / - [x], **negrita**, > citas, `código` y bloques de código con ```."
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "draft_slides",
    "description": "Crea una PRESENTACIÓN (mazo de diapositivas) que se abre EDITABLE en el canvas: pitch de colección, propuesta comercial, reporte visual, plan de campaña. Devuelve diapositivas estructuradas (portada, viñetas, frase de impacto, secciones, cita). El usuario las edita, navega y exporta a PDF. NO publica nada — solo crea la presentación. Para texto largo corrido usa draft_document; para una campaña de correo HTML usa compose_email.",
    "category": "document",
    "parameters": {
      "type": "object",
      "required": [
        "title",
        "slides"
      ],
      "properties": {
        "title": {
          "type": "string",
          "description": "Título de la presentación (aparece en la portada)."
        },
        "subtitle": {
          "type": "string",
          "description": "Subtítulo o bajada de la portada (opcional)."
        },
        "slides": {
          "type": "array",
          "description": "Diapositivas en orden. 6–12 suele ser lo ideal. La primera conviene que sea layout 'cover'.",
          "items": {
            "type": "object",
            "required": [
              "heading"
            ],
            "properties": {
              "layout": {
                "type": "string",
                "enum": [
                  "cover",
                  "bullets",
                  "statement",
                  "section",
                  "quote"
                ],
                "description": "cover=portada; bullets=título + viñetas; statement=frase grande de impacto; section=separador de sección; quote=cita. Por defecto 'bullets'."
              },
              "heading": {
                "type": "string",
                "description": "Título de la diapositiva (o la frase principal, en statement/quote)."
              },
              "bullets": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "Viñetas (para layout 'bullets'). 3–6 frases cortas es lo ideal."
              },
              "body": {
                "type": "string",
                "description": "Texto de apoyo: la frase grande (statement/section) o el autor de la cita (quote)."
              },
              "note": {
                "type": "string",
                "description": "Nota del presentador (opcional, no se muestra en la diapositiva)."
              }
            }
          }
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "draft_sheet",
    "description": "Crea una HOJA DE CÁLCULO editable en el canvas: tabla de datos, comparativo, catálogo, presupuesto, reporte de ventas. Devuelve columnas y filas; el usuario edita celdas, agrega/quita filas y columnas, ve totales de columnas numéricas y exporta a CSV. NO publica ni envía nada — solo crea la tabla. Para texto largo usa draft_document; para diapositivas usa draft_slides.",
    "category": "document",
    "parameters": {
      "type": "object",
      "required": [
        "title",
        "columns",
        "rows"
      ],
      "properties": {
        "title": {
          "type": "string",
          "description": "Título de la hoja."
        },
        "columns": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Encabezados de columna, en orden. Ej: [\"Producto\", \"Precio\", \"Stock\"]."
        },
        "rows": {
          "type": "array",
          "items": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "description": "Filas de datos. Cada fila es un arreglo de celdas alineado a 'columns' (mismo orden y cantidad). Los números van como texto; la hoja calcula totales de las columnas que sean 100% numéricas."
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "draft_board",
    "description": "Crea una PIZARRA (lienzo visual) editable en el canvas: mapa de campaña, lluvia de ideas, flujo de proceso, organigrama, mapa mental. Devuelve NOTAS (nodos) y CONEXIONES entre ellas; el usuario arrastra las notas, edita su texto, cambia colores, conecta/desconecta y la guarda. NO publica nada — solo crea la pizarra. Para texto largo usa draft_document; para diapositivas draft_slides; para tablas draft_sheet.",
    "category": "document",
    "parameters": {
      "type": "object",
      "required": [
        "title",
        "nodes"
      ],
      "properties": {
        "title": {
          "type": "string",
          "description": "Título de la pizarra."
        },
        "nodes": {
          "type": "array",
          "description": "Notas del lienzo (4–14 es lo ideal). Cada una con un id único y su texto.",
          "items": {
            "type": "object",
            "required": [
              "id",
              "text"
            ],
            "properties": {
              "id": {
                "type": "string",
                "description": "Identificador único de la nota (ej: 'n1', 'objetivo'). Se usa para conectar."
              },
              "text": {
                "type": "string",
                "description": "Texto de la nota (breve, una idea por nota)."
              },
              "color": {
                "type": "string",
                "enum": [
                  "slate",
                  "amber",
                  "sky",
                  "emerald",
                  "rose",
                  "violet"
                ],
                "description": "Color de la nota (opcional). Úsalo para agrupar por tema/fase."
              }
            }
          }
        },
        "edges": {
          "type": "array",
          "description": "Conexiones dirigidas entre notas (opcional). Cada una une dos ids de 'nodes'.",
          "items": {
            "type": "object",
            "required": [
              "from",
              "to"
            ],
            "properties": {
              "from": { "type": "string", "description": "id de la nota origen." },
              "to": { "type": "string", "description": "id de la nota destino." },
              "label": { "type": "string", "description": "Etiqueta de la flecha (opcional, breve)." }
            }
          }
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "ingest_document",
    "description": "Ingesta un documento de texto en el brain de la marca: lo divide en fragmentos semánticos, genera embeddings, extrae entidades nombradas y relaciones entre ellas.",
    "category": "knowledge",
    "parameters": {
      "type": "object",
      "required": [
        "title",
        "content"
      ],
      "properties": {
        "title": {
          "type": "string",
          "description": "Título descriptivo del documento"
        },
        "content": {
          "type": "string",
          "description": "Contenido completo en texto plano o markdown"
        },
        "source_uri": {
          "type": "string",
          "description": "URL o ruta de origen (opcional)"
        },
        "source_kind": {
          "enum": [
            "manual",
            "markdown",
            "web",
            "conversation"
          ],
          "type": "string",
          "default": "manual"
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "query_brain",
    "description": "Busca en la base de conocimiento de la marca usando recuperación híbrida (similitud vectorial + full-text + importancia). Devuelve los fragmentos más relevantes para enriquecer una tarea o responder una pregunta. Úsala ANTES de responder preguntas sobre la marca, sus productos, decisiones históricas o clientes.",
    "category": "knowledge",
    "parameters": {
      "type": "object",
      "required": [
        "query"
      ],
      "properties": {
        "limit": {
          "type": "integer",
          "default": 8,
          "description": "Máximo de fragmentos a devolver. Default 8, máx 20."
        },
        "query": {
          "type": "string",
          "description": "Pregunta o tema a buscar en el brain de la marca"
        },
        "source_kind": {
          "enum": [
            "manual",
            "distillation",
            "obsidian",
            "conversation"
          ],
          "type": "string",
          "description": "Filtrar por tipo de fuente (opcional)"
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "read_kpis",
    "description": "Leer los KPIs operacionales de la marca asignada al agente.",
    "category": "data",
    "parameters": {
      "type": "object",
      "properties": {
        "since": {
          "type": "string",
          "format": "date-time"
        },
        "metric": {
          "type": "string",
          "description": "Nombre del KPI; si se omite, devuelve todos."
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "request_approval",
    "description": "Solicitar aprobación a la Junta Directiva (humanos) para una acción crítica.",
    "category": "core",
    "parameters": {
      "type": "object",
      "required": [
        "trigger",
        "summary",
        "payload"
      ],
      "properties": {
        "payload": {
          "type": "object",
          "description": "Detalles estructurados de la acción propuesta."
        },
        "summary": {
          "type": "string",
          "description": "Qué quieres hacer y por qué, en una frase."
        },
        "trigger": {
          "enum": [
            "expense",
            "public_publish",
            "external_comm",
            "structural",
            "inventory_threshold",
            "agent_uncertain"
          ],
          "type": "string"
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "save_memory",
    "description": "Guardar una nota, decisión, aprendizaje o recordatorio en memoria de largo plazo del agente.",
    "category": "core",
    "parameters": {
      "type": "object",
      "required": [
        "kind",
        "content"
      ],
      "properties": {
        "kind": {
          "enum": [
            "note",
            "decision",
            "learning",
            "reminder"
          ],
          "type": "string"
        },
        "content": {
          "type": "string"
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "search_memory",
    "description": "Buscar en la memoria de largo plazo del agente.",
    "category": "core",
    "parameters": {
      "type": "object",
      "required": [
        "query"
      ],
      "properties": {
        "limit": {
          "type": "integer",
          "default": 5
        },
        "query": {
          "type": "string"
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "shopify_adjust_inventory",
    "description": "Ajustar el inventario disponible de un SKU en una location específica. El delta es relativo (positivo suma, negativo resta). Si |delta| ≤ 20 unidades, se ejecuta directo. Si supera 20, crea una aprobación pendiente y NO ejecuta — cuando la Junta apruebe, se ejecuta automáticamente. Antes de invocar, llama primero a shopify_get_inventory para conocer el location_id.",
    "category": "shopify",
    "parameters": {
      "type": "object",
      "required": [
        "sku",
        "location_id",
        "delta"
      ],
      "properties": {
        "sku": {
          "type": "string",
          "description": "SKU exacto."
        },
        "delta": {
          "type": "integer",
          "description": "Cantidad relativa. Positivo suma (entrada de mercancía), negativo resta (merma, venta no registrada, devolución a proveedor)."
        },
        "reason": {
          "type": "string",
          "description": "Motivo del ajuste. Ej: 'merma por defecto', 'recepción de pedido', 'conteo cíclico'."
        },
        "location_id": {
          "type": "string",
          "description": "ID numérico de la location (obtenlo de shopify_get_inventory)."
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "shopify_get_inventory",
    "description": "Consultar el inventario actual de un SKU en Shopify. Devuelve el total disponible y el desglose por location (con location_id que necesitas para ajustar). Úsalo antes de ajustar para conocer el estado actual.",
    "category": "shopify",
    "parameters": {
      "type": "object",
      "required": [
        "sku"
      ],
      "properties": {
        "sku": {
          "type": "string",
          "description": "SKU exacto del producto/variante (ej. NINA-20174-S)."
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "shopify_recent_orders",
    "description": "Listar las órdenes recientes de Shopify ordenadas por fecha desc. Útil para ver ventas reales, identificar bestsellers, detectar problemas. Devuelve total, items, cliente y status financiero/de cumplimiento. El parámetro `since` acepta ISO (2026-04-01) o expresiones (last 30 days, 7 days ago, yesterday).",
    "category": "shopify",
    "parameters": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "integer",
          "default": 20,
          "description": "Máximo 50."
        },
        "since": {
          "type": "string",
          "description": "Fecha desde la cual incluir órdenes. Acepta ISO (preferido: '2026-04-01'), o expresiones en inglés: 'today', 'yesterday', 'last week', 'last month', 'last 90 days', '7 days ago', '30 days ago', '3 months ago'."
        },
        "status": {
          "enum": [
            "",
            "paid",
            "pending",
            "refunded",
            "voided",
            "partially_refunded",
            "authorized"
          ],
          "type": "string",
          "description": "Filtrar por estado financiero. Vacío = todos."
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "shopify_search_customers",
    "description": "Buscar clientes de la tienda. Acepta query estilo Shopify (ej: \"email:cliente@x.com\" o \"orders_count:>3\"). Devuelve nombre, email, teléfono, número de órdenes, gasto acumulado y tags.",
    "category": "shopify",
    "parameters": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "integer",
          "default": 10,
          "description": "Máximo 50."
        },
        "query": {
          "type": "string",
          "description": "Query estilo Shopify. Vacío = clientes recientes."
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "shopify_search_products",
    "description": "Buscar productos en la tienda Shopify (NINA). Acepta una query estilo Shopify (ej: \"title:vestido status:active vendor:NINA tag:verano\"). Devuelve título, precio, inventario, vendor, tags, y URL handle.",
    "category": "shopify",
    "parameters": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "integer",
          "default": 10,
          "description": "Máximo 50."
        },
        "query": {
          "type": "string",
          "description": "Query estilo Shopify. Vacío = todos los productos."
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "shopify_shop_summary",
    "description": "Información general de la tienda Shopify: nombre, dominio, moneda, país, plan. Útil al comienzo de cada análisis para contextualizar.",
    "category": "shopify",
    "parameters": {
      "type": "object",
      "properties": {}
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "web_search",
    "description": "Buscar en la web información actualizada (tendencias, competencia, noticias, productos, mercado). Devuelve: un campo `answer` con un resumen sintetizado por el motor de búsqueda y `results` con los top N artículos (título, URL, excerpt de 500 chars, fecha). Sé específico en la query — frases naturales funcionan mejor que keywords sueltas. Útil para que el Analista de Tendencias se informe antes de proponer estrategias.",
    "category": "web",
    "parameters": {
      "type": "object",
      "required": [
        "query"
      ],
      "properties": {
        "depth": {
          "enum": [
            "basic",
            "advanced"
          ],
          "type": "string",
          "default": "basic",
          "description": "advanced trae más contexto pero gasta más cuota. Úsalo sólo para investigaciones profundas."
        },
        "limit": {
          "type": "integer",
          "default": 5,
          "description": "Cantidad de resultados (máximo 10)."
        },
        "query": {
          "type": "string",
          "description": "Búsqueda en lenguaje natural. Ej: 'tendencias de moda femenina colombiana 2026' o 'competencia directa de NINA en jeans wide leg'."
        },
        "topic": {
          "enum": [
            "general",
            "news"
          ],
          "type": "string",
          "default": "general",
          "description": "news prioriza artículos recientes de medios; general da resultados orgánicos."
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "send_email",
    "description": "Envía un correo electrónico real vía Resend. Úsala para notificar a clientes o al equipo: confirmaciones, alertas, resúmenes, seguimientos. Envía DE VERDAD — úsala con criterio. FLUJO DE CAMPAÑAS: si ya compusiste el correo con compose_email (se ve en el canvas), NO repitas el HTML aquí — llama send_email SOLO con 'to' y reutilizo automáticamente el asunto y el HTML compuesto. Para correos simples ad-hoc, pasa 'subject' y 'body'.",
    "category": "communication",
    "parameters": {
      "type": "object",
      "properties": {
        "to": {
          "type": "string",
          "description": "Email del destinatario. Para varios, sepáralos por coma."
        },
        "subject": {
          "type": "string",
          "description": "Asunto del correo. OPCIONAL si ya hay un correo compuesto (se reutiliza el suyo)."
        },
        "body": {
          "type": "string",
          "description": "Cuerpo del correo (texto plano o HTML). OPCIONAL: si lo omites y ya compusiste el correo con compose_email, reutilizo ese HTML. No re-escribas HTML grande aquí."
        }
      },
      "required": [
        "to"
      ]
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "compose_email",
    "description": "Compone un correo en HTML y lo muestra EN EL CANVAS del chat para previsualizar e iterar (NO envía nada). Pasa 'subject' y 'html' (HTML completo y atractivo, estilo marketing de NINA: header, cuerpo, CTA, footer, con estilos inline). Tras aprobarlo visualmente, usa send_email para lanzar la campaña a los clientes.",
    "category": "communication",
    "parameters": {
      "type": "object",
      "properties": {
        "subject": {
          "type": "string",
          "description": "Asunto del correo."
        },
        "html": {
          "type": "string",
          "description": "HTML completo del correo, con estilos inline (se renderiza en un iframe sandboxed)."
        }
      },
      "required": [
        "subject",
        "html"
      ]
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "suitecrm_sales",
    "description": "Consulta las ventas (facturas) del SuiteCRM de Jeans Colombianos por rango de fecha de facturación. Devuelve total en pesos, conteo de facturas, desglose por sucursal y por día, y las facturas más grandes. Úsala para reportes de ventas diarios o semanales.",
    "category": "suitecrm",
    "parameters": {
      "type": "object",
      "properties": {
        "period": {
          "type": "string",
          "enum": ["today", "yesterday", "last_7_days", "last_week"],
          "default": "yesterday",
          "description": "Periodo a consultar (zona Colombia). 'yesterday' (default) = día anterior; 'last_7_days' = 7 días terminando ayer (no incluye hoy); 'last_week' = lunes a domingo de la semana pasada."
        },
        "start_date": {
          "type": "string",
          "description": "Opcional. Inicio de un rango explícito en formato MM/DD/YYYY. Usar junto con end_date (tiene prioridad sobre period)."
        },
        "end_date": {
          "type": "string",
          "description": "Opcional. Fin de un rango explícito en formato MM/DD/YYYY."
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "ask_questions",
    "description": "Cuando el usuario pide algo ABIERTO o AMBIGUO (sobre todo en el primer mensaje de una conversación nueva), NO adivines: usa esta tool para hacerle 2-5 preguntas clave y precisar el requerimiento ANTES de producir el entregable. Mezcla tipos: 'text' (respuesta libre), 'single' (una opción de una lista) y 'multi' (varias opciones). El usuario responde en un formulario por pasos; sus respuestas te llegan como su siguiente mensaje y entonces continúas. Si ya tienes contexto suficiente, NO preguntes.",
    "category": "core",
    "parameters": {
      "type": "object",
      "required": [
        "questions"
      ],
      "properties": {
        "questions": {
          "type": "array",
          "description": "Entre 2 y 5 preguntas clave para precisar el pedido.",
          "items": {
            "type": "object",
            "required": [
              "prompt",
              "type"
            ],
            "properties": {
              "prompt": {
                "type": "string",
                "description": "La pregunta para el usuario."
              },
              "type": {
                "enum": [
                  "text",
                  "single",
                  "multi"
                ],
                "type": "string",
                "description": "text=respuesta libre; single=elegir una opción; multi=elegir varias."
              },
              "options": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "Opciones para single/multi. El formulario añade automáticamente 'Otro' para escribir."
              }
            }
          }
        }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "calendar_create_event",
    "description": "Agenda un evento en el calendario de marca de Google (calendario editorial / de contenido). Úsalo para programar publicaciones, recordatorios de campaña, lanzamientos, reuniones. Indica 'title' y la fecha: 'start' (fecha y hora en ISO 8601, p.ej. 2026-06-20T15:00:00) o 'date' (YYYY-MM-DD para todo el día). Opcional: 'end' y 'description'.",
    "category": "productivity",
    "parameters": {
      "type": "object",
      "required": ["title"],
      "properties": {
        "title": { "type": "string", "description": "Título del evento." },
        "start": { "type": "string", "description": "Inicio en ISO 8601 con hora (zona Colombia). Ej: 2026-06-20T15:00:00" },
        "end": { "type": "string", "description": "Fin en ISO 8601 (opcional; por defecto +1h)." },
        "date": { "type": "string", "description": "YYYY-MM-DD para un evento de TODO EL DÍA (en vez de start/end)." },
        "description": { "type": "string", "description": "Detalle/nota del evento (opcional)." }
      }
    },
    "requiresApproval": false,
    "isActive": true
  },
  {
    "name": "calendar_list_events",
    "description": "Lista los próximos eventos del calendario de marca de Google. Úsalo para revisar qué hay agendado antes de proponer fechas o para resumir el calendario editorial.",
    "category": "productivity",
    "parameters": {
      "type": "object",
      "required": [],
      "properties": {
        "time_min": { "type": "string", "description": "Desde (ISO 8601). Por defecto: ahora." },
        "time_max": { "type": "string", "description": "Hasta (ISO 8601). Opcional." },
        "max": { "type": "integer", "description": "Máximo de eventos (default 10, máx 50)." }
      }
    },
    "requiresApproval": false,
    "isActive": true
  }
]
