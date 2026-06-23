-- Menú de 3 puntos de los agentes (sidebar): fijar + reordenar (mover arriba/abajo).
-- pinned flota el agente al tope; sort_order es el orden manual. Escritura gateada por is_junta()
-- (policy existente agents_*). El sidebar ordena por (pinned desc, sort_order asc, name asc).
alter table public.agents add column if not exists pinned boolean not null default false;
alter table public.agents add column if not exists sort_order int not null default 0;
create index if not exists agents_pin_order_idx on public.agents(pinned, sort_order);
