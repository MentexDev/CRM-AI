-- WEIN NINA Inventary — schema Supabase
-- Ejecutar en SQL Editor del proyecto. Idempotente (puedes correrlo varias veces).

-- ============================================================
-- 1) Perfiles (extiende auth.users) y rol
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text not null,
  role text not null default 'seller' check (role in ('admin', 'seller')),
  avatar text,
  goal numeric(12,0) not null default 3000000,
  created_at timestamptz not null default now()
);

-- Auto-crea profile al registrarse un usuario
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'seller')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2) Productos
-- ============================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique not null,
  category text,
  color text,
  price numeric(12,0) not null default 0,
  cost numeric(12,0) not null default 0,
  -- stock por talla, ej: {"XS": 3, "S": 5, "M": 6, "L": 4, "XL": 2}
  sizes jsonb not null default '{"XS":0,"S":0,"M":0,"L":0,"XL":0}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 3) Ventas
-- ============================================================
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  size text not null check (size in ('XS','S','M','L','XL')),
  quantity int not null check (quantity > 0),
  unit_price numeric(12,0) not null,
  total numeric(12,0) not null,
  payment_method text not null default 'Efectivo',
  sold_at timestamptz not null default now()
);

create index if not exists sales_seller_idx on public.sales(seller_id);
create index if not exists sales_product_idx on public.sales(product_id);
create index if not exists sales_sold_at_idx on public.sales(sold_at desc);

-- Función transaccional: registra una venta y descuenta del stock atómicamente.
-- Lanza excepción si no hay stock suficiente.
create or replace function public.register_sale(
  p_seller uuid,
  p_product uuid,
  p_size text,
  p_qty int,
  p_payment text default 'Efectivo'
) returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  v_product products%rowtype;
  v_available int;
  v_sale public.sales;
begin
  if p_qty <= 0 then raise exception 'Cantidad inválida'; end if;

  select * into v_product from public.products where id = p_product for update;
  if not found then raise exception 'Producto no encontrado'; end if;

  v_available := coalesce((v_product.sizes->>p_size)::int, 0);
  if v_available < p_qty then
    raise exception 'Stock insuficiente: solo % unidades en talla %', v_available, p_size;
  end if;

  update public.products
    set sizes = jsonb_set(sizes, array[p_size], to_jsonb(v_available - p_qty))
    where id = p_product;

  insert into public.sales (seller_id, product_id, size, quantity, unit_price, total, payment_method)
  values (p_seller, p_product, p_size, p_qty, v_product.price, v_product.price * p_qty, p_payment)
  returning * into v_sale;

  return v_sale;
end; $$;

-- Cancelar venta (devuelve stock)
create or replace function public.cancel_sale(p_sale uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sales%rowtype; cur int;
begin
  select * into s from public.sales where id = p_sale for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  cur := coalesce((select (sizes->>s.size)::int from public.products where id = s.product_id), 0);
  update public.products
    set sizes = jsonb_set(sizes, array[s.size], to_jsonb(cur + s.quantity))
    where id = s.product_id;
  delete from public.sales where id = p_sale;
end; $$;

-- ============================================================
-- 4) Premios
-- ============================================================
create table if not exists public.prizes (
  id uuid primary key default gen_random_uuid(),
  threshold numeric(12,0) not null,
  name text not null,
  icon text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 5) Row Level Security
-- ============================================================
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.sales    enable row level security;
alter table public.prizes   enable row level security;

-- Helper: ¿soy admin?
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- profiles
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin on public.profiles for update
  using (auth.uid() = id or public.is_admin());

drop policy if exists profiles_admin_insert on public.profiles;
create policy profiles_admin_insert on public.profiles for insert
  with check (public.is_admin());

drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete
  using (public.is_admin());

-- products: todos autenticados leen; solo admin escribe
drop policy if exists products_read_auth on public.products;
create policy products_read_auth on public.products for select
  using (auth.role() = 'authenticated');

drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products for all
  using (public.is_admin()) with check (public.is_admin());

-- sales: vendedora ve sus ventas, admin ve todas; insert via RPC
drop policy if exists sales_select_own_or_admin on public.sales;
create policy sales_select_own_or_admin on public.sales for select
  using (seller_id = auth.uid() or public.is_admin());

drop policy if exists sales_insert_own on public.sales;
create policy sales_insert_own on public.sales for insert
  with check (seller_id = auth.uid() or public.is_admin());

drop policy if exists sales_admin_delete on public.sales;
create policy sales_admin_delete on public.sales for delete using (public.is_admin());

-- prizes: lectura pública autenticada, escritura admin
drop policy if exists prizes_read on public.prizes;
create policy prizes_read on public.prizes for select using (auth.role() = 'authenticated');
drop policy if exists prizes_admin_write on public.prizes;
create policy prizes_admin_write on public.prizes for all
  using (public.is_admin()) with check (public.is_admin());
