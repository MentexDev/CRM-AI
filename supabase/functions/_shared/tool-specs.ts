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
    "description": "Generar una imagen vía Higgsfield (modelo Soul, text-to-image) a partir de un prompt visual. Útil para mockups, conceptos de campaña, propuestas de pieza visual, referencias para el equipo. La imagen generada vuelve como URL pública (la hospeda Higgsfield). NO publica nada — sólo crea el asset. Si quieres publicar la imagen externamente, después usas request_approval para que la Junta autorice.",
    "category": "image",
    "parameters": {
      "type": "object",
      "required": [
        "prompt"
      ],
      "properties": {
        "prompt": {
          "type": "string",
          "description": "Descripción visual detallada en inglés (mejores resultados) o español. Sé específico sobre escena, estilo, iluminación, look."
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
    "description": "Envía un correo electrónico real vía Resend. Úsala para notificar a clientes o al equipo: confirmaciones, alertas, resúmenes, seguimientos. Indica 'to' (email del destinatario; varios separados por coma), 'subject' y 'body' (texto plano o HTML simple). Envía DE VERDAD — úsala con criterio.",
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
          "description": "Asunto del correo."
        },
        "body": {
          "type": "string",
          "description": "Cuerpo del correo. Texto plano, o HTML simple si necesitas formato."
        }
      },
      "required": [
        "to",
        "subject",
        "body"
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
  }
]
