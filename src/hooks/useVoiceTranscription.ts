// useVoiceTranscription v3 — NeuralOS God-Tier Spanglish Voice Intelligence
// ─────────────────────────────────────────────────────────────────────────────
// Layer 1: Web Audio API (getUserMedia + AnalyserNode) — real waveform data
// Layer 2: Web Speech API (SpeechRecognition) — continuous bilingual transcription
// Layer 3: NLP Pipeline — 12-stage Spanglish intelligence
//   ① Filler removal (ES+EN+Spanglish)   ② Stutter elimination
//   ③ Tech vocabulary guard               ④ Voice command detection (60+ cmds)
//   ⑤ Number normalization (ES+EN)        ⑥ Acronym/brand preservation
//   ⑦ Markdown via voice                  ⑧ Smart bilingual punctuation
//   ⑨ Auto-capitalisation                 ⑩ Auto-paragraph detection
//   ⑪ Intelligent list detection          ⑫ Adaptive language scoring
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback, useEffect } from 'react';

// ── Browser shim ──────────────────────────────────────────────────────────────
const isInSandboxedIframe = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();

const SpeechRecognitionImpl: any = isInSandboxedIframe
  ? null
  : ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null);

// ── Types ─────────────────────────────────────────────────────────────────────
export type VoiceStatus = 'idle' | 'listening' | 'paused' | 'processing' | 'unsupported';

export interface VoiceCommandEvent {
  raw: string;
  output: string;
  label: string;
  ts: number;
}

export interface UseVoiceTranscriptionOptions {
  lang?: string;
  onFinalResult?: (fullText: string) => void;
  onInterimResult?: (text: string) => void;   // fires '' when segment finalizes
  onError?: (msg: string) => void;
  onCommandDetected?: (cmd: VoiceCommandEvent) => void;
}

export interface UseVoiceTranscriptionReturn {
  status: VoiceStatus;
  interimText: string;
  confidence: number;
  segmentCount: number;
  wordCount: number;
  canUndo: boolean;
  isSupported: boolean;
  isDemoMode: boolean;
  lastCommand: VoiceCommandEvent | null;
  language: string;
  detectedLang: 'es' | 'en' | 'mixed';
  // Controls
  startListening: () => void;
  stopListening: () => void;
  pauseListening: () => void;
  resumeListening: () => void;
  toggle: () => void;
  reset: () => void;
  undoLastSegment: () => void;
  setLanguage: (lang: string) => void;
  // Waveform — call in your own RAF loop, zero React state updates
  getAudioLevels: () => number[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── LAYER ③: TECH VOCABULARY GUARD ────────────────────────────────────────────
// Terms that must NEVER be modified by any NLP stage.
// SpeechRecognition returns these in lowercase/wrong case — we restore them.
// ═══════════════════════════════════════════════════════════════════════════════
const TECH_VOCAB: Record<string, string> = {
  // Languages & Frameworks
  'javascript': 'JavaScript', 'typescript': 'TypeScript', 'python': 'Python',
  'react': 'React', 'vue': 'Vue', 'angular': 'Angular', 'nextjs': 'Next.js',
  'next js': 'Next.js', 'nodejs': 'Node.js', 'node js': 'Node.js',
  'fastapi': 'FastAPI', 'fast api': 'FastAPI', 'flask': 'Flask', 'django': 'Django',
  // Protocols & Standards
  'api': 'API', 'rest': 'REST', 'graphql': 'GraphQL', 'grpc': 'gRPC',
  'sql': 'SQL', 'nosql': 'NoSQL', 'json': 'JSON', 'xml': 'XML', 'yaml': 'YAML',
  'html': 'HTML', 'css': 'CSS', 'http': 'HTTP', 'https': 'HTTPS',
  'url': 'URL', 'uri': 'URI', 'dns': 'DNS', 'ssl': 'SSL', 'tls': 'TLS',
  'jwt': 'JWT', 'oauth': 'OAuth', 'sso': 'SSO', 'rbac': 'RBAC',
  'crud': 'CRUD', 'orm': 'ORM', 'mvc': 'MVC', 'sdk': 'SDK', 'cli': 'CLI',
  'ssh': 'SSH', 'ci': 'CI', 'cd': 'CD', 'cicd': 'CI/CD', 'ci cd': 'CI/CD',
  // Platforms & Tools
  'github': 'GitHub', 'git hub': 'GitHub', 'gitlab': 'GitLab',
  'vercel': 'Vercel', 'netlify': 'Netlify', 'heroku': 'Heroku',
  'aws': 'AWS', 'gcp': 'GCP', 'azure': 'Azure', 'docker': 'Docker',
  'kubernetes': 'Kubernetes', 'k8s': 'K8s',
  'supabase': 'Supabase', 'firebase': 'Firebase', 'mongodb': 'MongoDB',
  'postgresql': 'PostgreSQL', 'postgres': 'PostgreSQL', 'mysql': 'MySQL',
  'redis': 'Redis', 'elasticsearch': 'Elasticsearch',
  // Business & SaaS
  'stripe': 'Stripe', 'twilio': 'Twilio', 'sendgrid': 'SendGrid',
  'zapier': 'Zapier', 'make': 'Make', 'n8n': 'n8n', 'airtable': 'Airtable',
  'notion': 'Notion', 'slack': 'Slack', 'discord': 'Discord',
  'whatsapp': 'WhatsApp', 'what sapp': 'WhatsApp', 'watsap': 'WhatsApp',
  'instagram': 'Instagram', 'linkedin': 'LinkedIn', 'linked in': 'LinkedIn',
  'salesforce': 'Salesforce', 'hubspot': 'HubSpot', 'hub spot': 'HubSpot',
  'shopify': 'Shopify', 'wordpress': 'WordPress', 'word press': 'WordPress',
  // AI/ML
  'chatgpt': 'ChatGPT', 'chat gpt': 'ChatGPT', 'gpt': 'GPT',
  'claude': 'Claude', 'openai': 'OpenAI', 'open ai': 'OpenAI',
  'anthropic': 'Anthropic', 'llm': 'LLM', 'rag': 'RAG',
  'ai': 'AI', 'ml': 'ML', 'nlp': 'NLP', 'rlhf': 'RLHF',
  // ── Spanish ASR phonetic approximations ──────────────────────────────────
  // When ASR runs in es-ES mode it transcribes English proper nouns phonetically.
  // These entries map the Spanish approximation → correct English spelling.
  // Model names
  'claudio': 'Claude',          // "Claude" → Spanish ear hears "Claudio"
  'clod': 'Claude',             // short phonetic mishear
  'claud': 'Claude',
  // OpenClaw — AI/automation tool (distinct from OpenAI)
  'open claw': 'OpenClaw',      // user explicitly: "Open Claw" → OpenClaw
  'openclaw': 'OpenClaw',
  'open clo': 'OpenClaw',
  // OpenAI phonetic variants (different from OpenClaw)
  'open clod': 'OpenAI',
  'open claud': 'OpenAI',
  'open col': 'OpenAI',
  'open eye': 'OpenAI',
  'open ay': 'OpenAI',
  // ChatGPT
  'chat yi pi ti': 'ChatGPT',   // Spanish phonetic spelling of the letters
  'chat yi pt': 'ChatGPT',
  'chat wipi ti': 'ChatGPT',
  'chat jipi ti': 'ChatGPT',
  // Anthropic
  'antro pic': 'Anthropic',
  'antro pick': 'Anthropic',
  'anthropick': 'Anthropic',
  // GitHub — Spanish ASR often splits or distorts
  'get hub': 'GitHub',
  'git jab': 'GitHub',
  // Vercel
  'ver cel': 'Vercel',
  'ver sell': 'Vercel',
  // Next.js
  'next yei es': 'Next.js',
  'next yes': 'Next.js',
  // Tailwind
  'tail wind': 'Tailwind',
  'te wind': 'Tailwind',
  // Supabase
  'supa base': 'Supabase',
  'super base': 'Supabase',
  // Prisma
  'prima': 'Prisma',
  // TypeScript
  'tai script': 'TypeScript',
  'taip script': 'TypeScript',
  // NeuralOS / ATLAS
  'neural os': 'NeuralOS',
  'neuro os': 'NeuralOS',
  // Business Metrics
  'crm': 'CRM', 'erp': 'ERP', 'mvp': 'MVP', 'saas': 'SaaS', 'paas': 'PaaS',
  'b2b': 'B2B', 'b2c': 'B2C', 'mrr': 'MRR', 'arr': 'ARR', 'ltv': 'LTV',
  'cac': 'CAC', 'kpi': 'KPI', 'roi': 'ROI', 'nps': 'NPS',
  // Dev Terms
  'webhook': 'webhook', 'endpoint': 'endpoint', 'middleware': 'middleware',
  'payload': 'payload', 'token': 'token', 'frontend': 'frontend',
  'backend': 'backend', 'fullstack': 'fullstack', 'full stack': 'fullstack',
  'microservices': 'microservices', 'serverless': 'serverless',
  'pipeline': 'pipeline', 'workflow': 'workflow', 'dashboard': 'dashboard',
  'deployment': 'deployment', 'deploy': 'deploy', 'repository': 'repositorio',
  // NeuralOS specific
  'neuralos': 'NeuralOS', 'atlas': 'ATLAS',
  'forge': 'Forge',
};

// Restore tech vocabulary — applied LAST so no other stage corrupts these
function applyTechVocab(text: string): string {
  let result = text;
  // Sort by length descending so longer phrases match first
  const entries = Object.entries(TECH_VOCAB).sort((a, b) => b[0].length - a[0].length);
  for (const [pattern, replacement] of entries) {
    // Word-boundary aware replacement, case-insensitive
    const rx = new RegExp(`(?<![\\w])${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'gi');
    result = result.replace(rx, replacement);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── LAYER ①: FILLER WORD REMOVAL ──────────────────────────────────────────────
// Covers: Spanish, English, and Spanglish fillers
// ═══════════════════════════════════════════════════════════════════════════════
const FILLER_RX = /\b(e+h+|u+m+|a+h+|m+h+m*|e+m+|e+r+|o+h+|hmm+|uh+|um+|bueno(?:\s+pues)?|o\s+sea|(?:o\s+)?sea|a\s+ver|pues\s+(?:nada|s[ií]|no)|este+|like(?:\s+I\s+said)?|you\s+know|kind\s+of|sort\s+of|basically|literally|obviously|I\s+mean|right\??|so+\s+um|well+|anyway|o+kay\s+so|mmkay)\b[\s,]*/gi;

function removeFiller(t: string): string {
  return t.replace(FILLER_RX, ' ').replace(/\s{2,}/g, ' ').trim();
}

// ── LAYER ②: Stutter elimination ─────────────────────────────────────────────
function removeStutter(t: string): string {
  return t
    .replace(/\b(\w+)(?:\s+\1){2,}\b/gi, '$1')      // triple+
    .replace(/\b(\w{3,})(?:\s+\1)\b/gi, '$1')        // double (3+ char words)
    .trim();
}

// ── LAYER ④: Voice commands (60+ commands, ES+EN) ─────────────────────────────
interface VoiceCmd {
  rx: RegExp;
  out: string;
  label: string;
  cap?: boolean;
}

const VOICE_COMMANDS: VoiceCmd[] = [
  // ── Punctuation — Spanish ──────────────────────────────────────────────────
  { rx: /^coma$/i,                                  out: ',',   label: 'Coma ,' },
  { rx: /^punto$/i,                                 out: '.',   label: 'Punto .' },
  { rx: /^punto y coma$/i,                          out: ';',   label: 'Punto y coma ;' },
  { rx: /^dos puntos$/i,                            out: ':',   label: 'Dos puntos :' },
  { rx: /^signo de interrogaci[oó]n$/i,             out: '?',   label: '? Interrogación' },
  { rx: /^(signo de )?(admira|exclama)ci[oó]n$/i,  out: '!',   label: '! Admiración' },
  { rx: /^(abrir|abre)\s+interrogaci[oó]n$/i,       out: '¿',   label: '¿ Abrir pregunta' },
  { rx: /^(cerrar|cierra)\s+interrogaci[oó]n$/i,    out: '?',   label: '? Cerrar pregunta' },
  { rx: /^(abrir|abre)\s+(admiraci[oó]n|exclamaci[oó]n)$/i, out: '¡', label: '¡ Abrir admiración' },
  { rx: /^(cerrar|cierra)\s+(admiraci[oó]n|exclamaci[oó]n)$/i, out: '!', label: '! Cerrar admiración' },
  { rx: /^(nueva l[ií]nea|salto de l[ií]nea|nueva linea|enter)$/i, out: '\n',   label: '↵ Nueva línea' },
  { rx: /^(punto y aparte|nuevo p[aá]rrafo|doble enter)$/i,         out: '\n\n', label: '¶ Párrafo' },
  { rx: /^(puntos suspensivos|elipsis)$/i,          out: '…',   label: '… Suspensivos' },
  { rx: /^raya$/i,                                  out: '—',   label: '— Raya' },
  { rx: /^gui[oó]n$/i,                              out: '-',   label: '- Guión' },
  { rx: /^barra$/i,                                 out: '/',   label: '/ Barra' },
  { rx: /^barra invertida|backslash$/i,             out: '\\',  label: '\\ Backslash' },
  { rx: /^arroba$/i,                                out: '@',   label: '@ Arroba' },
  { rx: /^almohadilla|hashtag|numeral$/i,           out: '#',   label: '# Hash' },
  { rx: /^asterisco$/i,                             out: '*',   label: '* Asterisco' },
  { rx: /^comillas$/i,                              out: '"',   label: '" Comillas' },
  { rx: /^comilla simple|ap[oó]strofe$/i,           out: "'",   label: "' Apóstrofe" },
  { rx: /^comillas (de apertura|angulares)$/i,      out: '«',   label: '« Apertura' },
  { rx: /^comillas (de cierre|angulares cierre)$/i, out: '»',   label: '» Cierre' },
  { rx: /^abrir par[eé]ntesis$/i,                   out: '(',   label: '( Paréntesis' },
  { rx: /^cerrar par[eé]ntesis$/i,                  out: ')',   label: ') Paréntesis' },
  { rx: /^abrir (llave|corchete curvo)$/i,          out: '{',   label: '{ Llave' },
  { rx: /^cerrar (llave|corchete curvo)$/i,         out: '}',   label: '} Llave' },
  { rx: /^abrir (corchete|corchete cuadrado)$/i,    out: '[',   label: '[ Corchete' },
  { rx: /^cerrar (corchete|corchete cuadrado)$/i,   out: ']',   label: '] Corchete' },
  { rx: /^(guión bajo|underscore|subrayado)$/i,     out: '_',   label: '_ Underscore' },
  { rx: /^(mayor que|ángulo derecho|mayor)$/i,      out: '>',   label: '> Mayor que' },
  { rx: /^(menor que|ángulo izquierdo|menor)$/i,    out: '<',   label: '< Menor que' },
  { rx: /^(tilde|virgulilla)$/i,                    out: '~',   label: '~ Tilde' },
  { rx: /^(acento grave|backtick|tilde invertida)$/i, out: '`', label: '` Backtick' },
  { rx: /^(pipe|barra vertical|palito)$/i,          out: '|',   label: '| Pipe' },
  { rx: /^(ampersand|et|y comercial)$/i,            out: '&',   label: '& Ampersand' },
  { rx: /^(caret|acento circunflejo|potencia)$/i,   out: '^',   label: '^ Caret' },
  { rx: /^(porcentaje|por ciento)$/i,               out: '%',   label: '% Porcentaje' },
  { rx: /^(doble igual|igual igual)$/i,             out: '==',  label: '== Doble igual' },
  { rx: /^(triple igual|estrictamente igual)$/i,    out: '===', label: '=== Triple igual' },
  { rx: /^(diferente|no igual|distinto)$/i,         out: '!=',  label: '!= Diferente' },
  { rx: /^(flecha|arrow right|flecha derecha)$/i,   out: '→',   label: '→ Flecha' },
  { rx: /^(flecha doble|double arrow)$/i,           out: '=>',  label: '=> Arrow fn' },
  { rx: /^punto com$/i,                             out: '.com', label: '.com' },
  { rx: /^punto (es|io|ai|net|org|co)$/i,           out: '.$1', label: '.TLD', cap: true },
  // ── Punctuation — English ─────────────────────────────────────────────────
  { rx: /^comma$/i,                                 out: ',',   label: 'Comma' },
  { rx: /^(period|full stop|dot)$/i,                out: '.',   label: 'Period' },
  { rx: /^semicolon$/i,                             out: ';',   label: 'Semicolon' },
  { rx: /^colon$/i,                                 out: ':',   label: 'Colon' },
  { rx: /^question mark$/i,                         out: '?',   label: 'Question mark' },
  { rx: /^(exclamation mark|exclamation point|bang)$/i, out: '!', label: 'Exclamation' },
  { rx: /^(new line|next line|line break|newline)$/i, out: '\n', label: 'New line' },
  { rx: /^(new paragraph|paragraph break|double enter)$/i, out: '\n\n', label: 'Paragraph' },
  { rx: /^(ellipsis|dot dot dot)$/i,               out: '…',   label: 'Ellipsis' },
  { rx: /^(em dash|long dash)$/i,                  out: '—',   label: 'Em dash' },
  { rx: /^(en dash)$/i,                             out: '–',   label: 'En dash' },
  { rx: /^(hyphen|dash)$/i,                         out: '-',   label: 'Hyphen' },
  { rx: /^slash$/i,                                 out: '/',   label: 'Slash' },
  { rx: /^backslash$/i,                             out: '\\',  label: 'Backslash' },
  { rx: /^at sign$/i,                               out: '@',   label: 'At @' },
  { rx: /^(hashtag|hash sign|pound sign)$/i,        out: '#',   label: 'Hash #' },
  { rx: /^open paren(thesis)?$/i,                   out: '(',   label: 'Open paren' },
  { rx: /^close paren(thesis)?$/i,                  out: ')',   label: 'Close paren' },
  { rx: /^open curly( brace)?$/i,                   out: '{',   label: 'Open brace' },
  { rx: /^close curly( brace)?$/i,                  out: '}',   label: 'Close brace' },
  { rx: /^open bracket$/i,                          out: '[',   label: 'Open bracket' },
  { rx: /^close bracket$/i,                         out: ']',   label: 'Close bracket' },
  { rx: /^(underscore|under score)$/i,              out: '_',   label: 'Underscore' },
  { rx: /^(greater than|right angle)$/i,            out: '>',   label: 'Greater than' },
  { rx: /^(less than|left angle)$/i,                out: '<',   label: 'Less than' },
  { rx: /^tilde$/i,                                 out: '~',   label: 'Tilde' },
  { rx: /^(backtick|back tick|grave accent)$/i,     out: '`',   label: 'Backtick' },
  { rx: /^(pipe|vertical bar)$/i,                   out: '|',   label: 'Pipe' },
  { rx: /^ampersand$/i,                             out: '&',   label: 'Ampersand' },
  { rx: /^percent(age)?$/i,                         out: '%',   label: 'Percent' },
  { rx: /^(double equals|equals equals)$/i,         out: '==',  label: 'Double equals' },
  { rx: /^triple equals$/i,                         out: '===', label: 'Triple equals' },
  { rx: /^(not equals|bang equals)$/i,              out: '!=',  label: 'Not equals' },
  { rx: /^arrow( right)?$/i,                        out: '→',   label: 'Arrow' },
  { rx: /^fat arrow$/i,                             out: '=>',  label: 'Fat arrow' },
  { rx: /^dot com$/i,                               out: '.com', label: '.com' },
  { rx: /^dot (io|ai|net|org|co|es)$/i,             out: '.$1', label: '.TLD', cap: true },
  // ── Markdown via voice — ES ───────────────────────────────────────────────
  { rx: /^en negrita (.+)$/i,          out: '**$1**', label: 'Negrita', cap: true },
  { rx: /^en cursiva (.+)$/i,          out: '_$1_',   label: 'Cursiva', cap: true },
  { rx: /^(en )?c[oó]digo (.+)$/i,    out: '`$2`',   label: 'Código',  cap: true },
  { rx: /^tachado (.+)$/i,             out: '~~$1~~', label: 'Tachado', cap: true },
  { rx: /^t[ií]tulo (.+)$/i,           out: '# $1',   label: 'H1',      cap: true },
  { rx: /^subt[ií]tulo (.+)$/i,        out: '## $1',  label: 'H2',      cap: true },
  { rx: /^viñeta (.+)$/i,              out: '- $1',   label: 'Viñeta',  cap: true },
  { rx: /^n[uú]mero (.+)$/i,           out: '1. $1',  label: 'Lista #', cap: true },
  // ── Markdown via voice — EN ───────────────────────────────────────────────
  { rx: /^bold (.+)$/i,                out: '**$1**', label: 'Bold',    cap: true },
  { rx: /^italic (.+)$/i,              out: '_$1_',   label: 'Italic',  cap: true },
  { rx: /^code (.+)$/i,                out: '`$1`',   label: 'Code',    cap: true },
  { rx: /^strikethrough (.+)$/i,       out: '~~$1~~', label: 'Strike',  cap: true },
  { rx: /^heading (.+)$/i,             out: '# $1',   label: 'Heading', cap: true },
  { rx: /^bullet (.+)$/i,              out: '- $1',   label: 'Bullet',  cap: true },
  // ── Control commands ─────────────────────────────────────────────────────
  { rx: /^(borra eso|borra el [uú]ltimo|elimina eso|deshacer)$/i,          out: 'UNDO',   label: '↩ Borrar último' },
  { rx: /^(undo that|delete that|scratch that|cancel that|erase that)$/i,  out: 'UNDO',   label: '↩ Undo' },
  { rx: /^(pausa|pause recording|pause)$/i,                                 out: 'PAUSE',  label: '⏸ Pausar' },
  { rx: /^(cont[ií]n[uú]a|continuar|resume|resume recording)$/i,           out: 'RESUME', label: '▶ Continuar' },
  { rx: /^(borra todo|clear all|limpiar todo|empieza de nuevo)$/i,         out: 'CLEAR',  label: '🗑 Borrar todo' },
];

function detectVoiceCommand(t: string): { isCmd: boolean; out: string; label: string; isSpecial?: string } {
  const tr = t.trim();
  for (const cmd of VOICE_COMMANDS) {
    const m = tr.match(cmd.rx);
    if (!m) continue;
    const specials = ['UNDO', 'PAUSE', 'RESUME', 'CLEAR'];
    if (specials.includes(cmd.out)) return { isCmd: true, out: '', label: cmd.label, isSpecial: cmd.out };
    const out = cmd.cap
      ? cmd.out.replace(/\$(\d+)/g, (_, g) => m[parseInt(g)] ?? '')
      : cmd.out;
    return { isCmd: true, out, label: cmd.label };
  }
  return { isCmd: false, out: t, label: '' };
}

// ── LAYER ⑤: Number normalization ────────────────────────────────────────────
const ES_NUM: Record<string, number> = {
  'cero':0,'un':1,'uno':1,'una':1,'dos':2,'tres':3,'cuatro':4,'cinco':5,
  'seis':6,'siete':7,'ocho':8,'nueve':9,'diez':10,'once':11,'doce':12,
  'trece':13,'catorce':14,'quince':15,'dieciséis':16,'dieciseis':16,
  'diecisiete':17,'dieciocho':18,'diecinueve':19,'veinte':20,'veintiuno':21,
  'veintidós':22,'veintidos':22,'veintitrés':23,'veintitres':23,
  'veinticuatro':24,'veinticinco':25,'veintiséis':26,'veintiseis':26,
  'veintisiete':27,'veintiocho':28,'veintinueve':29,
  'treinta':30,'cuarenta':40,'cincuenta':50,'sesenta':60,'setenta':70,
  'ochenta':80,'noventa':90,'cien':100,'ciento':100,
};
const EN_NUM: Record<string, number> = {
  'zero':0,'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,
  'eight':8,'nine':9,'ten':10,'eleven':11,'twelve':12,'thirteen':13,
  'fourteen':14,'fifteen':15,'sixteen':16,'seventeen':17,'eighteen':18,
  'nineteen':19,'twenty':20,'thirty':30,'forty':40,'fifty':50,
  'sixty':60,'seventy':70,'eighty':80,'ninety':90,'hundred':100,
};

// CRIT PRE-EXISTING BUG FIX: parseSpokenInt previously returned a value even when
// it only matched a prefix of the chunk (e.g. ["uno","puede"] → returned 1 after
// matching only "uno", then normalizeNumbers would consume BOTH words as the number 1,
// swallowing "puede"). The new signature returns { val, consumed } so the caller can
// reject partial matches where consumed < len (words in the chunk).
function parseSpokenInt(words: string[]): { val: number; consumed: number } | null {
  let total = 0, cur = 0, consumed = 0;
  for (const w of words) {
    const lw = w.toLowerCase();
    if (lw === 'mil' || lw === 'thousand') {
      cur = cur || 1; total += cur * 1000; cur = 0; consumed++; continue;
    }
    if (lw === 'millones' || lw === 'millón' || lw === 'million' || lw === 'millions') {
      cur = cur || 1; total += cur * 1000000; cur = 0; consumed++; continue;
    }
    const n = ES_NUM[lw] ?? EN_NUM[lw];
    if (n !== undefined) { cur += n; consumed++; }
    else break;
  }
  return consumed > 0 ? { val: total + cur, consumed } : null;
}

// Pronoun guard — "uno"/"una" as solo words are almost always Spanish pronouns
// ("uno puede escribir", "una persona", etc.). The full-consume check below already
// prevents partial-match swallowing, but this guard adds a semantic layer:
// even a lone "uno" at end-of-sentence stays as "uno", not "1".
const PRONOUN_GUARD = new Set(['uno', 'una']);

function normalizeNumbers(t: string): string {
  const words = t.split(/\s+/);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let best: { val: number; len: number } | null = null;
    for (let len = Math.min(6, words.length - i); len > 0; len--) {
      const chunk = words.slice(i, i + len);
      // Pronoun guard: standalone "uno"/"una" → preserve as pronoun/article
      if (len === 1 && PRONOUN_GUARD.has(chunk[0].toLowerCase())) break;
      const result = parseSpokenInt(chunk);
      // CRITICAL: only accept if parseSpokenInt consumed ALL words in the chunk.
      // A partial match (consumed < len) means the chunk starts with a number word
      // but continues with non-number words — reject and try a shorter chunk.
      if (result !== null && result.consumed === len) {
        best = { val: result.val, len };
        break;
      }
    }
    if (best) {
      out.push(best.val.toLocaleString('es-ES'));
      i += best.len;
    } else {
      out.push(words[i]); i++;
    }
  }
  return out.join(' ');
}

// ── LAYER ⑥: Brand / Acronym preservation ────────────────────────────────────
const KNOWN_BRANDS = new Set([
  'API','REST','SQL','JSON','HTML','CSS','AWS','GCP','CRM','ERP','MVP','SaaS',
  'B2B','B2C','MRR','ARR','KPI','ROI','NPS','SSO','JWT','SDK','CLI','CI','CD',
  'UI','UX','PR','PM','CTO','CEO','CMO','CFO','VP','HR','AI','ML','NLP','LLM',
  'RAG','GPT','URL','DNS','SSL','TLS','HTTP','HTTPS','GitHub','GitLab','Stripe',
  'Twilio','Vercel','Supabase','Firebase','MongoDB','PostgreSQL','MySQL','Redis',
  'Docker','Kubernetes','Slack','Discord','Notion','Airtable','WhatsApp',
  'HubSpot','Salesforce','Shopify','WordPress','ChatGPT','Claude','ATLAS',
  'NeuralOS','React','Vue','Angular','TypeScript','JavaScript','Python',
  'GraphQL','OAuth','CRUD','ORM','MVC','YAML','XML','gRPC',
]);

function preserveBrands(text: string): string {
  return text.split(/\s+/).map(word => {
    const up = word.toUpperCase();
    const title = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    return KNOWN_BRANDS.has(up) ? up
      : KNOWN_BRANDS.has(word) ? word
      : KNOWN_BRANDS.has(title) ? title
      : word;
  }).join(' ');
}

// ── LAYER ⑫: Adaptive language scoring ────────────────────────────────────────
const ES_MARKERS = new Set([
  'el','la','los','las','un','una','unos','unas','de','en','con','por','para',
  'que','es','son','hay','está','están','tiene','tienen','fue','ser','hacer',
  'quiero','necesito','puede','debe','voy','tengo','esto','eso','aquí','allí',
  'pero','porque','cuando','como','donde','si','no','sí','muy','más','también',
  'ahora','después','antes','todo','todos','nada','algo','alguien',
]);
const EN_MARKERS = new Set([
  'the','a','an','is','are','was','were','have','has','had','do','does','did',
  'will','would','could','should','can','may','might','must','shall',
  'I','you','he','she','it','we','they','my','your','his','her','our','their',
  'this','that','these','those','here','there','and','but','or','if','then',
  'when','where','how','what','why','who','which','some','any','all','not',
  'get','make','need','want','use','like','know','think','see','go','come',
]);

type LangScore = 'es' | 'en' | 'mixed';
function detectLanguage(text: string): LangScore {
  const words = text.toLowerCase().split(/\s+/);
  let es = 0, en = 0;
  for (const w of words) {
    if (ES_MARKERS.has(w)) es++;
    else if (EN_MARKERS.has(w)) en++;
  }
  const total = es + en;
  if (total === 0) return 'mixed';
  if (es / total > 0.55) return 'es';
  if (en / total > 0.55) return 'en';
  return 'mixed';
}

// ── LAYER ⑧: Smart bilingual punctuation ──────────────────────────────────────

// Question sentence starters — these segments are almost certainly questions
const QUESTION_STARTERS_ES = /^(qué|que(?:\s+(?:pasó|pasa|tal|fue|es|son|hay|tiene|tienes|hace|haces))|cuál|cuáles|cómo(?:\s+(?:estás|está|están|vas|funciona|se))?|cuándo|dónde|quién|quiénes|por qué|para qué|cuántos|cuántas|cuánto(?:\s+tiempo)?|a qué hora|de qué|en qué|con qué)\b/i;
const QUESTION_STARTERS_EN = /^(which|what|who|whom|when|where|why|how(?:\s+(?:are|is|do|does|did|many|much|long|often))?|is(?:\s+it| there| that)?|are(?:\s+you| there| they)?|was|were|will|would|could|should|can|did|do(?:\s+you| they)?|does|have|has|had|may|might)\b/i;

// Exclamatory words — these segments end with "!"
const EXCLAIM_WORDS_ES = /\b(genial|perfecto|excelente|increíble|increible|fantástico|fantastico|espectacular|brutal|wow|bravo|fenomenal|insane|bestial|impresionante|alucinante|tremendo|genio|maravilloso|estupendo|soberbio|extraordinario|épico|épica|top|crack)\b/i;
const EXCLAIM_WORDS_EN = /\b(amazing|excellent|great|perfect|awesome|fantastic|outstanding|brilliant|incredible|insane|unbelievable|wonderful|terrific|superb|magnificent)\b/i;

// COMMA_STARTERS — segments beginning with these connector words continue a previous
// thought. They should get a trailing comma, not a period, even after a long pause.
// Rationale: "pero" never starts an independent sentence in natural dictation.
const COMMA_STARTERS_ES = /^(pero|aunque|sin embargo|además|también|por lo tanto|por eso|así que|de hecho|es decir|o sea|en cambio|no obstante|a pesar de|incluso|hasta|tampoco|ni siquiera|excepto|salvo|por ejemplo|como|ya que|porque|dado que|puesto que|si bien|mientras que|a medida que|en cuanto|tan pronto como|después de que|antes de que|para que|a fin de que|con tal de que|no solo|sino también|tanto como)\b/i;
const COMMA_STARTERS_EN = /^(but|although|however|moreover|furthermore|besides|therefore|thus|hence|because|since|even though|even if|whereas|as soon as|unless|in addition|in fact|for example|such as|except|apart from|not only|rather than|on the other hand|as a result|consequently|nevertheless|nonetheless|meanwhile)\b/i;

// SOFT_ENDINGS — words that clearly signal the sentence has NOT finished.
// A segment ending with these gets a comma, never a period.
const SOFT_ENDINGS = /\b(y|o|e|ni|pero|sino|que|como|si|cuando|donde|porque|aunque|mientras|además|también|de|del|a|al|en|con|por|para|desde|hasta|sobre|entre|mediante|and|but|or|nor|if|when|where|so|of|the|an|in|on|at|to|for|with|by)\s*$/i;

// LIST_CONTINUATION — if previous segment ended in comma and this one continues
// naturally, it's likely still mid-sentence
const PREV_ENDED_COMMA_STARTER = /^(y|e|ni|o|u|también|además|así como|entre ellos|entre ellas|entre otros|including|as well as|together with|along with)\b/i;

function applySmartPunctuation(text: string, pauseMs: number, prevEnded: boolean, lang: LangScore): string {
  if (!text.trim()) return '';
  let t = text.trim();
  const alreadyPunct = /[.!?,;:\n]$/.test(t);
  if (alreadyPunct) return t;

  const isQuestion     = QUESTION_STARTERS_ES.test(t) || QUESTION_STARTERS_EN.test(t);
  const isExclaim      = EXCLAIM_WORDS_ES.test(t) || EXCLAIM_WORDS_EN.test(t);
  const isCommaStarter = COMMA_STARTERS_ES.test(t) || COMMA_STARTERS_EN.test(t);
  const isSoftEnding   = SOFT_ENDINGS.test(t);

  // 1. Questions — add ¿...? for Spanish, ...? for English
  if (isQuestion) {
    // Only wrap with ¿ if it doesn't already have one and the segment IS a question
    // (not just a word that can start questions used declaratively, e.g. "cómo te llamas")
    const needsOpenMark = lang === 'es' && !t.startsWith('¿');
    return needsOpenMark ? `¿${t}?` : `${t}?`;
  }

  // 2. Exclamations
  if (isExclaim) return t + '!';

  // 3. Comma-starters: these segments always continue a previous clause
  //    Even with a 3-second pause, a sentence starting with "pero" is a continuation.
  if (isCommaStarter) return t + ',';

  // 4. Soft endings: the segment itself is clearly unfinished
  if (isSoftEnding) return t + ',';

  // 5. Very long pause (≥2400ms) → full stop, end of sentence
  //    Raised from 2200ms to reduce false periods on natural breathing pauses.
  if (pauseMs >= 2400) return t + '.';

  // 6. Medium pause (≥950ms) and previous segment ended (not mid-sentence):
  //    This is a new independent clause starting — separate with period
  if (pauseMs >= 950 && prevEnded) return t + '.';

  // 7. Medium pause (≥950ms) and previous segment has NOT ended:
  //    We're still in the same sentence — add comma to mark the breath
  if (pauseMs >= 950 && !prevEnded) return t + ',';

  // 8. Short pause + list continuation pattern → comma
  if (PREV_ENDED_COMMA_STARTER.test(t)) return t + ',';

  // 9. No strong signal → no punctuation, let the next segment decide
  return t;
}

// ── LAYER ⑨: Capitalisation ───────────────────────────────────────────────────
// Handles Spanish opening marks ¿ and ¡ — capitalizes the first actual letter
function capitalize(t: string): string {
  if (!t) return t;
  if (t.startsWith('¿') || t.startsWith('¡')) {
    return t.charAt(0) + t.charAt(1).toUpperCase() + t.slice(2);
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ── LAYER ⑧b: Embedded question fixer ────────────────────────────────────────
// Handles cases like "pregunto qué pasa" → "pregunto, ¿qué pasa?"
// and "quiero saber cómo funciona" → "quiero saber, ¿cómo funciona?"
const INTRO_VERB_RX = /\b(pregunto|preguntas|pregunta|preguntarte|preguntarme|quisiera saber|quiero saber|me pregunto|necesito saber|dime|cuéntame|explícame|sabes)\s+(qu[eé]\b|cu[aá]l(?:es)?\b|c[oó]mo\b|cu[aá]ndo\b|d[oó]nde\b|qui[eé]n(?:es)?\b|por\s+qu[eé]\b|para\s+qu[eé]\b|cu[aá]ntos?\b)/gi;

function fixEmbeddedQuestions(t: string, lang: LangScore): string {
  if (lang === 'en') return t;
  let result = t.replace(INTRO_VERB_RX, (_, verb, qword) => `${verb}, ¿${qword}`);
  // If ¿ was injected mid-sentence but no ? at end, close it
  if (result.includes('¿') && !/[?]$/.test(result.trimEnd())) {
    result = result.trimEnd() + '?';
  }
  return result;
}

// ── LAYER ⑪: Auto-paragraph & list detection ──────────────────────────────────
const ORDINAL_START = /^(primero?|segundo?|tercero?|cuarto?|quinto?|sexto?|séptimo?|octavo?|noveno?|décimo?|luego|después|finalmente|por\s+[uú]ltimo|adem[aá]s|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|then|next|finally|lastly|also)\b/i;

function detectAndFormatList(segments: string[]): string[] {
  if (segments.length < 2) return segments;
  const ordinalCount = segments.filter(s => ORDINAL_START.test(s.trim())).length;
  if (ordinalCount >= 2 && ordinalCount / segments.length >= 0.5) {
    return segments.map((s, i) => i === 0 ? s : `\n• ${s}`);
  }
  return segments;
}

// ── Full segment merge ────────────────────────────────────────────────────────
function mergeSegments(segs: string[], addParagraph: boolean[]): string {
  const formatted = detectAndFormatList(segs);
  return formatted.reduce((acc, seg, i) => {
    if (i === 0) return seg;
    if (addParagraph[i]) return acc.trimEnd() + '\n\n' + capitalize(seg);
    const prev = acc.trimEnd();
    const endsWithHard = /[.!?…]$/.test(prev);
    const endsWithSoft = /[,;:]$/.test(prev);
    if (seg.startsWith('\n')) return prev + seg;
    if (endsWithHard)  return prev + ' ' + capitalize(seg);
    if (endsWithSoft)  return prev + ' ' + seg.charAt(0).toLowerCase() + seg.slice(1);
    return prev + ' ' + seg;
  }, '');
}

// Count words in a string (ignoring punctuation)
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── DEMO MODE ─────────────────────────────────────────────────────────────────
// Realistic Spanglish streaming simulation for sandboxed environments
// ═══════════════════════════════════════════════════════════════════════════════
const DEMO_SENTENCES = [
  { interim: 'Hey ATLAS,',                            final: 'Hey ATLAS,' },
  { interim: 'necesito configurar',                   final: 'necesito configurar un webhook' },
  { interim: 'que dispare cuando llegue',             final: 'que dispare cuando llegue un pago desde Stripe.' },
  { interim: 'Quiero que el',                         final: 'Quiero que el payload se envíe a n8n' },
  { interim: 'y que automáticamente',                 final: 'y que automáticamente actualice el CRM.' },
  { interim: '¿Puedes crear',                         final: '¿Puedes crear el workflow completo?' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// ── MAIN HOOK ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
export function useVoiceTranscription(
  opts: UseVoiceTranscriptionOptions = {}
): UseVoiceTranscriptionReturn {
  // ── Callback refs — always point to the LATEST callbacks, no stale closures ─
  // This is the standard pattern for hooks with timers/intervals.
  const onFinalResultRef    = useRef(opts.onFinalResult);
  const onInterimResultRef  = useRef(opts.onInterimResult);
  const onErrorRef          = useRef(opts.onError);
  const onCommandDetectedRef = useRef(opts.onCommandDetected);
  // Update refs every render — no dependency array needed
  onFinalResultRef.current    = opts.onFinalResult;
  onInterimResultRef.current  = opts.onInterimResult;
  onErrorRef.current          = opts.onError;
  onCommandDetectedRef.current = opts.onCommandDetected;
  // Convenience aliases (used in sync code for brevity — same as ref.current at call time)
  const { onFinalResult, onInterimResult, onError, onCommandDetected } = opts;

  const [status,       setStatusState]  = useState<VoiceStatus>(SpeechRecognitionImpl ? 'idle' : 'unsupported');
  // Always-current wrapper — keeps statusRef in sync so plain-function closures
  // (resumeListeningInternal etc.) can read the latest status without stale closure risk.
  const setStatus = (next: VoiceStatus | ((prev: VoiceStatus) => VoiceStatus)) => {
    setStatusState(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      statusRef.current = resolved;
      return resolved;
    });
  };
  const [interimText,  setInterimText]  = useState('');
  const [confidence,   setConfidence]   = useState(0);
  const [segmentCount, setSegmentCount] = useState(0);
  const [wordCount,    setWordCount]    = useState(0);
  const [canUndo,      setCanUndo]      = useState(false);
  const [lastCommand,  setLastCommand]  = useState<VoiceCommandEvent | null>(null);
  const [language,     setLanguageState] = useState(opts.lang ?? 'es-ES');
  const [detectedLang, setDetectedLang] = useState<LangScore>('mixed');

  // Internal refs (zero re-renders for audio/segments)
  const recognitionRef      = useRef<any>(null);
  const segmentsRef         = useRef<string[]>([]);
  const paragraphRef        = useRef<boolean[]>([]);
  const lastFinalRef        = useRef(Date.now());
  const prevEndedRef        = useRef(true);
  const isMountedRef        = useRef(true);
  const langRef             = useRef(language);
  const permissionDeniedRef = useRef(false);
  const demoFallbackRef     = useRef(false);   // auto-switched to demo after not-allowed
  const demoTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoIndexRef        = useRef(0);
  const demoIntervalRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  // CRIT-1 FIX: statusRef mirrors the status state so that plain functions defined
  // inside the hook body (resumeListeningInternal, pauseListeningInternal) always
  // read the current status even when captured inside a useCallback closure that
  // was created in an earlier render and has no `status` in its dep array.
  const statusRef = useRef<VoiceStatus>(SpeechRecognitionImpl ? 'idle' : 'unsupported');

  // Web Audio API
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const analyserRef  = useRef<AnalyserNode | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const rafSimRef    = useRef<number>(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; cleanupAudio(); };
  }, []);

  // ── Audio teardown ──────────────────────────────────────────────────────────
  function cleanupAudio() {
    try {
      const s = streamRef.current;
      if (s && typeof (s as any).getTracks === 'function') {
        (s as MediaStream).getTracks().forEach(t => t.stop());
      }
    } catch { /* ignore */ }
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    streamRef.current   = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    try { cancelAnimationFrame(rafSimRef.current); } catch { /* ignore */ }
  }

  // ── Web Audio init (reuses mic already held by SpeechRecognition) ──────────
  async function initAudioAfterRecognition(existingStream?: MediaStream) {
    if (analyserRef.current) return;
    try {
      const stream = existingStream
        ?? (navigator.mediaDevices
            ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false })
            : null);
      if (!stream) return;
      streamRef.current = stream;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.82;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
    } catch { /* Fallback to simulated waveform */ }
  }

  // ── Public: get audio levels (real or simulated) ───────────────────────────
  const getAudioLevels = useCallback((): number[] => {
    if (analyserRef.current) {
      const data = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(data);
      const bars = 32, step = Math.max(1, Math.floor(data.length / bars));
      return Array.from({ length: bars }, (_, i) => {
        const slice = data.slice(i * step, (i + 1) * step);
        return (slice.reduce((a, b) => a + b, 0) / slice.length) / 255;
      });
    }
    if (status === 'listening') {
      const t = Date.now() / 180;
      return Array.from({ length: 32 }, (_, i) =>
        Math.max(0.04, Math.abs(Math.sin(t + i * 0.42) * 0.55 + Math.sin(t * 1.3 + i * 0.9) * 0.35))
      );
    }
    return new Array(32).fill(0.03);
  }, [status]);

  // ── NLP Pipeline — 12 stages ───────────────────────────────────────────────
  function runNLP(raw: string, pauseMs: number): string {
    // Normalize casing first — browser SpeechRecognition sometimes over-capitalizes
    // mid-sentence words (e.g. "Qué" inside "pero te pregunto Qué pasa").
    // We lowercase everything and let later stages restore proper caps.
    let t = raw.toLowerCase();
    t = removeFiller(t);        // ①
    t = removeStutter(t);       // ②
    // ③ tech vocab guard applied last — skip now
    // ④ voice commands handled separately — skip
    t = normalizeNumbers(t);    // ⑤
    t = preserveBrands(t);      // ⑥
    // ⑦ markdown handled via commands
    const lang = detectLanguage(t); // ⑫
    setDetectedLang(lang);
    t = fixEmbeddedQuestions(t, lang); // ⑧a — e.g. "pregunto qué pasa" → "pregunto, ¿qué pasa?"
    t = applySmartPunctuation(t, pauseMs, prevEndedRef.current, lang); // ⑧b
    t = capitalize(t);          // ⑨
    // ⑩⑪ handled in mergeSegments
    t = applyTechVocab(t);      // ③ (applied last)
    return t.trim();
  }

  // ── Build SpeechRecognition instance ──────────────────────────────────────
  const buildRecognition = useCallback(() => {
    if (!SpeechRecognitionImpl) return null;
    const rec = new SpeechRecognitionImpl();
    rec.lang            = langRef.current;
    rec.continuous      = true;
    rec.interimResults  = true;
    rec.maxAlternatives = 3;

    rec.onstart = () => {
      if (!isMountedRef.current) return;
      setStatus('listening');
      setTimeout(() => { initAudioAfterRecognition(); }, 300);
    };

    rec.onresult = (ev: any) => {
      if (!isMountedRef.current) return;
      let interim = '';

      for (let idx = ev.resultIndex; idx < ev.results.length; idx++) {
        const result = ev.results[idx];
        // Best alternative
        const transcript = Array.from({ length: result.length }, (_, a) => result[a].transcript)
          .reduce((best, alt) => best || alt, result[0].transcript);

        if (result.isFinal) {
          const now     = Date.now();
          const pauseMs = now - lastFinalRef.current;
          lastFinalRef.current = now;

          let t = transcript;
          t = removeFiller(t);
          t = removeStutter(t);
          if (!t.trim()) continue;

          // Voice command detection (before full NLP)
          const cmd = detectVoiceCommand(t);
          if (cmd.isCmd) {
            if (cmd.isSpecial === 'UNDO') {
              if (segmentsRef.current.length > 0) {
                segmentsRef.current.pop();
                paragraphRef.current.pop();
                const cnt = segmentsRef.current.length;
                setSegmentCount(cnt);
                setCanUndo(cnt > 0);
                const merged = mergeSegments(segmentsRef.current, paragraphRef.current);
                setWordCount(countWords(merged));
                // CRIT-2 FIX: use ref to always call the latest callback, not the stale closure
                onFinalResultRef.current?.(merged);
              }
              const ev2: VoiceCommandEvent = { raw: transcript, output: '', label: '↩ Borrado', ts: now };
              setLastCommand(ev2); onCommandDetectedRef.current?.(ev2);
              // Clear interim (segment done)
              setInterimText('');
              onInterimResultRef.current?.('');
              continue;
            }
            if (cmd.isSpecial === 'PAUSE') { pauseListeningInternal(); return; }
            if (cmd.isSpecial === 'RESUME') { resumeListeningInternal(); return; }
            if (cmd.isSpecial === 'CLEAR') {
              segmentsRef.current = []; paragraphRef.current = [];
              setSegmentCount(0); setCanUndo(false); setWordCount(0);
              onFinalResultRef.current?.('');
              const ev2: VoiceCommandEvent = { raw: transcript, output: '', label: '🗑 Todo borrado', ts: now };
              setLastCommand(ev2); onCommandDetectedRef.current?.(ev2);
              setInterimText(''); onInterimResultRef.current?.('');
              continue;
            }
            // Inline command (punctuation/markdown)
            segmentsRef.current.push(cmd.out);
            paragraphRef.current.push(false);
            const cnt = segmentsRef.current.length;
            setSegmentCount(cnt); setCanUndo(cnt > 0);
            const merged = mergeSegments(segmentsRef.current, paragraphRef.current);
            setWordCount(countWords(merged));
            setConfidence(1);
            const ev2: VoiceCommandEvent = { raw: transcript, output: cmd.out, label: cmd.label, ts: now };
            setLastCommand(ev2); onCommandDetectedRef.current?.(ev2);
            onFinalResultRef.current?.(merged);
            setInterimText(''); onInterimResultRef.current?.('');
            continue;
          }

          // Full NLP pipeline
          const processed = runNLP(t, pauseMs);
          if (!processed) continue;

          // Auto-paragraph disabled — use voice command "nueva línea" / "new line" for line breaks
          const newParagraph = false;
          prevEndedRef.current = /[.!?…]$/.test(processed);

          segmentsRef.current.push(processed);
          paragraphRef.current.push(newParagraph);
          const cnt = segmentsRef.current.length;
          setSegmentCount(cnt);
          setCanUndo(cnt > 0);

          const best = result[0];
          setConfidence(best?.confidence ?? 0.85);

          const merged = mergeSegments(segmentsRef.current, paragraphRef.current);
          setWordCount(countWords(merged));
          onFinalResultRef.current?.(merged);
          // Clear interim — segment confirmed
          setInterimText('');
          onInterimResultRef.current?.('');

        } else {
          interim += transcript;
        }
      }

      if (interim) {
        // Normalize interim: lowercase → filler removal → brand restore
        const preview = applyTechVocab(preserveBrands(removeFiller(interim.toLowerCase())));
        setInterimText(preview);
        onInterimResultRef.current?.(preview);
      }
    };

    rec.onerror = (ev: any) => {
      if (!isMountedRef.current) return;
      if (ev.error === 'no-speech') return;

      // ── Auto-demo fallback: mic not allowed → silently run demo so UI works ──
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        permissionDeniedRef.current = true;
        demoFallbackRef.current     = true;
        cleanupAudio();
        // Reset counters for fresh demo session
        segmentsRef.current = []; paragraphRef.current = [];
        setInterimText(''); setConfidence(0); setSegmentCount(0);
        setWordCount(0); setCanUndo(false); setLastCommand(null);
        setStatus('listening');
        startDemoStreaming();
        return;
      }

      const msg =
        ev.error === 'audio-capture' ? 'No se pudo capturar audio. Verifica que el micrófono esté conectado.' :
        ev.error === 'network'       ? 'Error de red durante la transcripción.' :
        `Error de reconocimiento: ${ev.error}`;
      setStatus('idle'); setInterimText('');
      onInterimResultRef.current?.('');
      cleanupAudio();
      onErrorRef.current?.(msg);
    };

    rec.onend = () => {
      if (!isMountedRef.current) return;
      // If we auto-fell back to demo mode, the error handler already took over — ignore
      if (demoFallbackRef.current) return;
      setStatus(prev => prev === 'listening' ? 'processing' : prev);
      setTimeout(() => { if (isMountedRef.current) { setStatus('idle'); setInterimText(''); onInterimResultRef.current?.(''); } }, 220);
    };

    return rec;
  }, [onFinalResult, onInterimResult, onError, onCommandDetected]);

  // ── Internal pause/resume (called by voice commands) ──────────────────────
  function pauseListeningInternal() {
    try { recognitionRef.current?.stop(); } catch {}
    setStatus('paused');
    const ev: VoiceCommandEvent = { raw: '', output: '', label: '⏸ Pausado', ts: Date.now() };
    setLastCommand(ev);
  }
  function resumeListeningInternal() {
    // CRIT-1 FIX: use statusRef.current, NOT the captured `status` state.
    // This function is called from buildRecognition's onresult handler (a useCallback
    // closure that may be stale). statusRef is always up-to-date.
    if (statusRef.current !== 'paused') return;
    const rec = buildRecognition();
    if (!rec) return;
    recognitionRef.current = rec;
    try { rec.start(); } catch {}
    const ev: VoiceCommandEvent = { raw: '', output: '', label: '▶ Reanudado', ts: Date.now() };
    setLastCommand(ev);
  }

  // ── Demo mode: realistic Spanglish streaming simulation ───────────────────
  // Uses ref.current for callbacks to avoid stale closures in setInterval/setTimeout
  function startDemoStreaming() {
    demoIndexRef.current = 0;
    if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    const allText: string[] = [];

    const advance = () => {
      if (!isMountedRef.current) return;
      const idx = demoIndexRef.current;
      if (idx >= DEMO_SENTENCES.length) {
        clearInterval(demoIntervalRef.current!);
        demoIntervalRef.current = null;
        setStatus('processing');
        setInterimText('');
        onInterimResultRef.current?.('');
        setTimeout(() => {
          if (!isMountedRef.current) return;
          setStatus('idle');
        }, 700);
        return;
      }
      const sentence = DEMO_SENTENCES[idx];
      // Show interim — always use ref.current for freshest callback
      setInterimText(sentence.interim);
      onInterimResultRef.current?.(sentence.interim);
      // Finalize after ~480ms
      setTimeout(() => {
        if (!isMountedRef.current) return;
        allText.push(sentence.final);
        const merged = allText.join(' ');
        const wc = countWords(merged);
        setSegmentCount(allText.length);
        setWordCount(wc);
        setCanUndo(allText.length > 0);
        setConfidence(0.88 + Math.random() * 0.10);
        onFinalResultRef.current?.(merged);
        setInterimText('');
        onInterimResultRef.current?.('');
        demoIndexRef.current++;
      }, 480);
    };

    advance();
    demoIntervalRef.current = setInterval(advance, 1100);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    // Demo path: no SpeechRecognition API, OR already fell back to demo after not-allowed
    if (!SpeechRecognitionImpl || demoFallbackRef.current) {
      if (status === 'listening') return;
      setStatus('listening');
      setConfidence(0);
      setSegmentCount(0); setWordCount(0); setCanUndo(false); setLastCommand(null);
      startDemoStreaming();
      return;
    }
    if (status === 'listening') return;
    segmentsRef.current  = [];
    paragraphRef.current = [];
    prevEndedRef.current = true;
    lastFinalRef.current = Date.now();
    setInterimText(''); setConfidence(0); setSegmentCount(0); setWordCount(0);
    setCanUndo(false); setLastCommand(null);

    const rec = buildRecognition();
    if (!rec) return;
    recognitionRef.current = rec;
    try { rec.start(); } catch {}
  }, [status, buildRecognition]);

  const stopListening = useCallback(() => {
    if (!SpeechRecognitionImpl || demoFallbackRef.current) {
      if (demoIntervalRef.current) { clearInterval(demoIntervalRef.current); demoIntervalRef.current = null; }
      if (demoTimerRef.current) { clearTimeout(demoTimerRef.current); demoTimerRef.current = null; }
      setStatus('processing');
      setInterimText(''); onInterimResultRef.current?.('');
      setTimeout(() => { if (isMountedRef.current) setStatus('idle'); }, 500);
      return;
    }
    try { recognitionRef.current?.stop(); } catch {}
    cleanupAudio();
    setStatus('processing');
  }, []);

  const pauseListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
    if (!SpeechRecognitionImpl) {
      if (demoIntervalRef.current) { clearInterval(demoIntervalRef.current); demoIntervalRef.current = null; }
    }
    setStatus('paused');
  }, []);

  const resumeListening = useCallback(() => {
    if (status !== 'paused') return;
    if (!SpeechRecognitionImpl || demoFallbackRef.current) {
      setStatus('listening');
      startDemoStreaming();
      return;
    }
    const rec = buildRecognition();
    if (!rec) return;
    recognitionRef.current = rec;
    try { rec.start(); } catch {}
  }, [status, buildRecognition]);

  const toggle = useCallback(() => {
    if (status === 'listening') stopListening();
    else if (status === 'paused') resumeListening();
    else startListening();
  }, [status, startListening, stopListening, resumeListening]);

  const reset = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
    if (demoIntervalRef.current) { clearInterval(demoIntervalRef.current); demoIntervalRef.current = null; }
    if (demoTimerRef.current) { clearTimeout(demoTimerRef.current); demoTimerRef.current = null; }
    cleanupAudio();
    segmentsRef.current  = [];
    paragraphRef.current = [];
    permissionDeniedRef.current = false;
    demoFallbackRef.current     = false;
    setInterimText(''); onInterimResultRef.current?.('');
    setStatus('idle');
    setConfidence(0); setSegmentCount(0); setWordCount(0); setCanUndo(false); setLastCommand(null);
  }, [onInterimResult]);

  const undoLastSegment = useCallback(() => {
    if (!segmentsRef.current.length) return;
    segmentsRef.current.pop();
    paragraphRef.current.pop();
    const cnt = segmentsRef.current.length;
    setSegmentCount(cnt);
    setCanUndo(cnt > 0);
    const merged = mergeSegments(segmentsRef.current, paragraphRef.current);
    setWordCount(countWords(merged));
    onFinalResultRef.current?.(merged); // use ref — stable, never stale
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setLanguage = useCallback((lang: string) => {
    langRef.current = lang;
    setLanguageState(lang);
    if (status === 'listening') {
      try { recognitionRef.current?.stop(); } catch {}
      const rec = buildRecognition();
      if (!rec) return;
      recognitionRef.current = rec;
      try { rec.start(); } catch {}
    }
  }, [status, buildRecognition]);

  return {
    status, interimText, confidence, segmentCount, wordCount,
    canUndo, isSupported: !!SpeechRecognitionImpl,
    isDemoMode: !SpeechRecognitionImpl || demoFallbackRef.current,
    lastCommand, language, detectedLang,
    startListening, stopListening, pauseListening,
    resumeListening, toggle, reset,
    undoLastSegment, setLanguage, getAudioLevels,
  };
}
