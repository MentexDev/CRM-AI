-- Módulo "Atención al Cliente" (CRM + multiatención WhatsApp). Fase 1 (sin WhatsApp todavía).
-- Tablas con prefijo cs_ para NO chocar con conversations/messages del chat de AGENTES (otro dominio).
-- Multi-tenant por MARCA (brand_id) con el mismo candado que el resto: has_brand_access(brand_id).
-- Bandeja COMPARTIDA: todos los operadores de una marca ven todo lo de su marca (RLS por marca, sin
-- restricción por operador). assigned_to queda para el futuro (asignación), no se usa para filtrar aún.

-- ── Canales (un número/sesión de WhatsApp) ──────────────────────────────────
create table if not exists public.cs_channels (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'disconnected', -- disconnected | connecting | connected
  phone text,
  avatar text,
  session_id text,            -- id de instancia en Evolution (Fase 2)
  meta jsonb not null default '{}'::jsonb,  -- device/profile info (Fase 2)
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cs_channels_brand_idx on public.cs_channels(brand_id);

-- ── Contactos (el cliente externo) ──────────────────────────────────────────
create table if not exists public.cs_contacts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  channel_id uuid references public.cs_channels(id) on delete set null,
  name text,
  phone text not null,        -- identidad (número de WhatsApp)
  avatar text,
  tags text[] not null default '{}',
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, phone)    -- un contacto por número y marca → auto-crear sin duplicar (webhook Fase 2)
);
create index if not exists cs_contacts_brand_idx on public.cs_contacts(brand_id);

-- ── Etapas del pipeline (Kanban), PERSONALIZABLES por marca ──────────────────
create table if not exists public.cs_stages (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  color text not null default '#8a8a8a',
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cs_stages_brand_pos_idx on public.cs_stages(brand_id, position);

-- ── Leads (el contacto dentro del pipeline) ─────────────────────────────────
create table if not exists public.cs_leads (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  contact_id uuid not null references public.cs_contacts(id) on delete cascade,
  stage_id uuid references public.cs_stages(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null, -- futuro: asignación a operador
  status text not null default 'open',  -- open | won | lost
  position int not null default 0,      -- orden dentro de la etapa (drag-and-drop)
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cs_leads_brand_idx on public.cs_leads(brand_id);
create index if not exists cs_leads_stage_idx on public.cs_leads(brand_id, stage_id, position);
create index if not exists cs_leads_contact_idx on public.cs_leads(contact_id);

-- ── Conversaciones (hilo cliente↔operador) ──────────────────────────────────
create table if not exists public.cs_conversations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  contact_id uuid not null references public.cs_contacts(id) on delete cascade,
  channel_id uuid references public.cs_channels(id) on delete set null,
  last_message text not null default '',
  last_message_at timestamptz,
  unread int not null default 0,
  status text not null default 'open', -- open | closed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cs_conv_brand_idx on public.cs_conversations(brand_id);
create index if not exists cs_conv_recent_idx on public.cs_conversations(brand_id, last_message_at desc nulls last);
create index if not exists cs_conv_contact_idx on public.cs_conversations(contact_id);

-- ── Mensajes (brand_id denormalizado → RLS simple sin join, tabla de alto volumen) ──
create table if not exists public.cs_messages (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  conversation_id uuid not null references public.cs_conversations(id) on delete cascade,
  direction text not null,             -- inbound (del cliente) | outbound (del operador)
  sender_type text not null default 'contact', -- contact | operator | system
  sender_id uuid references auth.users(id) on delete set null, -- operador si es outbound
  type text not null default 'text',   -- text | image | audio | video | document
  content text not null default '',    -- cuerpo de texto / caption
  media_url text,
  media_type text,                     -- mime
  media_size bigint,
  wa_message_id text,                  -- id de WhatsApp (Fase 2, dedup)
  status text not null default 'sent', -- sent | delivered | read | failed
  created_at timestamptz not null default now()
);
create index if not exists cs_msg_conv_idx on public.cs_messages(conversation_id, created_at);
create index if not exists cs_msg_brand_idx on public.cs_messages(brand_id);

-- ── Trigger: al insertar un mensaje, actualizar el resumen de la conversación ──
create or replace function public.cs_message_touch_conversation()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.cs_conversations
    set last_message = case
          when new.type = 'text' then left(new.content, 280)
          else '[' || new.type || ']'
        end,
        last_message_at = new.created_at,
        unread = unread + (case when new.direction = 'inbound' then 1 else 0 end),
        updated_at = now()
    where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists cs_messages_touch on public.cs_messages;
create trigger cs_messages_touch after insert on public.cs_messages
  for each row execute function public.cs_message_touch_conversation();

-- ── RLS por marca (bandeja compartida) ──────────────────────────────────────
alter table public.cs_channels enable row level security;
alter table public.cs_contacts enable row level security;
alter table public.cs_stages enable row level security;
alter table public.cs_leads enable row level security;
alter table public.cs_conversations enable row level security;
alter table public.cs_messages enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cs_channels','cs_contacts','cs_stages','cs_leads','cs_conversations','cs_messages']
  loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select using (has_brand_access(brand_id))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (has_brand_access(brand_id))', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update using (has_brand_access(brand_id)) with check (has_brand_access(brand_id))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (has_brand_access(brand_id))', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
  end loop;
end $$;

-- ── Realtime (inbox + Kanban en vivo) ───────────────────────────────────────
do $$
begin
  alter publication supabase_realtime add table public.cs_messages;
  alter publication supabase_realtime add table public.cs_conversations;
  alter publication supabase_realtime add table public.cs_leads;
  alter publication supabase_realtime add table public.cs_channels;
exception when duplicate_object then null;
end $$;

-- ── Etapas por defecto para cada marca existente (idempotente) ───────────────
do $$
declare b record;
begin
  for b in select id from public.brands loop
    if not exists (select 1 from public.cs_stages where brand_id = b.id) then
      insert into public.cs_stages (brand_id, name, color, position) values
        (b.id, 'Nuevo contacto', '#3b82f6', 0),
        (b.id, 'En negociación', '#f59e0b', 1),
        (b.id, 'Agendado',       '#8b5cf6', 2),
        (b.id, 'Cerrado',        '#22c55e', 3),
        (b.id, 'Perdido',        '#ef4444', 4);
    end if;
  end loop;
end $$;
