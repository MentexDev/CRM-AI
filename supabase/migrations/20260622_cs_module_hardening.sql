-- Cierre C-A-R del módulo Atención al Cliente. Endurece la BD contra los hallazgos confirmados.

-- ── HIGH #1/#21: cs_messages — el INSERT debe atar conversation_id a la MISMA marca ──────────────
-- Antes: with check (has_brand_access(brand_id)) sin validar la conversación → un operador de la marca A
-- podía insertar un mensaje con brand_id=A y conversation_id de la marca B (FK solo exige existencia), y
-- el trigger (SECURITY DEFINER) tocaba el hilo ajeno. Ahora exigimos que la conversación sea de su marca.
drop policy if exists cs_messages_insert on public.cs_messages;
create policy cs_messages_insert on public.cs_messages for insert
  with check (
    has_brand_access(brand_id)
    and exists (select 1 from public.cs_conversations c where c.id = conversation_id and c.brand_id = cs_messages.brand_id)
  );

-- Trigger: filtrar el UPDATE por marca (defensa en profundidad; service_role bypassa RLS, esto lo ata).
create or replace function public.cs_message_touch_conversation()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.cs_conversations
    set last_message = case when new.type = 'text' then left(new.content, 280) else '[' || new.type || ']' end,
        last_message_at = new.created_at,
        unread = unread + (case when new.direction = 'inbound' then 1 else 0 end),
        updated_at = now()
    where id = new.conversation_id and brand_id = new.brand_id;
  return new;
end $$;

-- ── HIGH #3/#4/#17: normalizar el teléfono a SOLO DÍGITOS (un único canon) ───────────────────────
-- El front guardaba "+57 300…" y el webhook "57300…" → contactos duplicados; unique(brand_id,phone) no
-- protegía. Trigger BEFORE INSERT/UPDATE que normaliza siempre (el front también normaliza antes del lookup).
create or replace function public.cs_normalize_phone()
returns trigger language plpgsql as $$
begin
  if new.phone is not null then new.phone := regexp_replace(new.phone, '\D', '', 'g'); end if;
  return new;
end $$;
drop trigger if exists cs_contacts_norm_phone on public.cs_contacts;
create trigger cs_contacts_norm_phone before insert or update on public.cs_contacts
  for each row execute function public.cs_normalize_phone();

-- Normalizar los existentes (best-effort: solo donde no choca con un duplicado ya normalizado).
update public.cs_contacts c set phone = regexp_replace(c.phone, '\D', '', 'g')
where c.phone ~ '\D'
  and not exists (
    select 1 from public.cs_contacts d
    where d.brand_id = c.brand_id and d.id <> c.id and d.phone = regexp_replace(c.phone, '\D', '', 'g')
  );

-- ── MED #9: una sola conversación ABIERTA por contacto y marca (evita hilos partidos por carrera) ──
create unique index if not exists cs_conv_open_uniq on public.cs_conversations (brand_id, contact_id) where status = 'open';

-- ── MED #13: cs_contacts y cs_stages faltaban en la publicación Realtime (el front se suscribe) ───
do $$
begin
  alter publication supabase_realtime add table public.cs_contacts;
  alter publication supabase_realtime add table public.cs_stages;
exception when duplicate_object then null;
end $$;

-- ── MED #14: REPLICA IDENTITY FULL → los eventos DELETE con filtro brand_id sí llegan a Realtime ──
-- (cs_messages se deja default: su filtro es por conversation_id y los DELETE son raros; evita WAL extra.)
alter table public.cs_channels replica identity full;
alter table public.cs_contacts replica identity full;
alter table public.cs_stages replica identity full;
alter table public.cs_leads replica identity full;
alter table public.cs_conversations replica identity full;
