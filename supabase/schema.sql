-- WEIN NINA Inventary — schema Supabase
-- Idempotente. Pegar y ejecutar en SQL Editor del proyecto Supabase.

-- ============================================================
-- 1) Perfiles
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  first_name text not null,
  last_name text not null,
  role text not null default 'seller' check (role in ('admin', 'seller')),
  avatar text,
  goal numeric(12,0) not null default 3000000,
  created_at timestamptz not null default now()
);

create index if not exists profiles_username_idx on public.profiles (lower(username));

-- vista derivada con full name
create or replace view public.profiles_with_name as
  select id, username, first_name, last_name,
         (first_name || ' ' || last_name) as name,
         role, avatar, goal, created_at
  from public.profiles;

-- Auto-crea profile al registrarse un usuario
-- Lee username, first_name, last_name desde raw_user_meta_data
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_first text;
  v_last  text;
  v_user  text;
  v_avatar text;
begin
  v_first := coalesce(new.raw_user_meta_data->>'first_name', split_part(new.email, '@', 1));
  v_last  := coalesce(new.raw_user_meta_data->>'last_name', '');
  v_user  := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));
  v_avatar := upper(substr(coalesce(v_first, ''), 1, 1) || substr(coalesce(v_last, ''), 1, 1));

  insert into public.profiles (id, username, first_name, last_name, role, avatar)
  values (
    new.id,
    v_user,
    v_first,
    v_last,
    coalesce(new.raw_user_meta_data->>'role', 'seller'),
    nullif(v_avatar, '')
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
  sku text unique not null,
  name text not null,
  category text,
  color text,
  price numeric(12,0) not null default 0,
  cost numeric(12,0) not null default 0,
  -- jsonb con cantidad por talla, ej: {"6":3,"8":5,"10":6,"12":4,"14":2}
  initial_sizes jsonb not null default '{"6":0,"8":0,"10":0,"12":0,"14":0}'::jsonb,
  sizes         jsonb not null default '{"6":0,"8":0,"10":0,"12":0,"14":0}'::jsonb,
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
-- 3) Ventas (cada fila = una línea de pedido)
-- ============================================================
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  seller_name text not null,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  sku text,
  size text not null,
  quantity int not null check (quantity > 0),
  unit_price numeric(12,0) not null,
  line_subtotal numeric(12,0) not null,
  discount numeric(12,0) not null default 0,
  total numeric(12,0) not null,
  payment_method text not null default 'Efectivo',
  -- cliente (opcional, defaults 'NA')
  customer_name text not null default 'NA',
  customer_cedula text not null default 'NA',
  customer_address text not null default 'NA',
  customer_phone text not null default 'NA',
  customer_email text not null default 'NA',
  sold_at timestamptz not null default now()
);

create index if not exists sales_seller_idx  on public.sales(seller_id);
create index if not exists sales_product_idx on public.sales(product_id);
create index if not exists sales_order_idx   on public.sales(order_id);
create index if not exists sales_sold_at_idx on public.sales(sold_at desc);

-- Función transaccional: registra un pedido completo (varias líneas) y descuenta
-- el stock atómicamente. Cada línea trae su propio discount_pct y payment_method.
-- p_items = jsonb array:
--   [{"product_id": "uuid", "size": "8", "quantity": 2,
--     "discount_pct": 10, "payment_method": "Efectivo"}, ...]
-- p_customer = jsonb: {"name":"...","cedula":"...","address":"...","phone":"...","email":"..."}
drop function if exists public.register_order(uuid, jsonb, text, numeric, jsonb);

create or replace function public.register_order(
  p_seller_id uuid,
  p_items jsonb,
  p_customer jsonb default '{}'::jsonb
) returns setof public.sales
language plpgsql security definer set search_path = public as $$
declare
  v_order_id text := 'ord-' || extract(epoch from now())::bigint || '-' || substr(md5(random()::text), 1, 6);
  v_seller   public.profiles%rowtype;
  v_item     jsonb;
  v_product  public.products%rowtype;
  v_size     text;
  v_qty      int;
  v_disc_pct numeric;
  v_pay      text;
  v_line_subtotal numeric;
  v_line_disc numeric;
  v_sold_at  timestamptz := now();
  v_cust_name text := coalesce(p_customer->>'name', 'NA');
  v_cust_ced  text := coalesce(p_customer->>'cedula', 'NA');
  v_cust_addr text := coalesce(p_customer->>'address', 'NA');
  v_cust_phn  text := coalesce(p_customer->>'phone', 'NA');
  v_cust_eml  text := coalesce(p_customer->>'email', 'NA');
begin
  select * into v_seller from public.profiles where id = p_seller_id;
  if not found then raise exception 'Vendedora no encontrada'; end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos una venta al pedido';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_size     := v_item->>'size';
    v_qty      := (v_item->>'quantity')::int;
    v_disc_pct := coalesce((v_item->>'discount_pct')::numeric, 0);
    v_pay      := coalesce(v_item->>'payment_method', 'Efectivo');

    if v_qty <= 0 then raise exception 'Cantidad inválida'; end if;
    if v_disc_pct < 0 or v_disc_pct > 100 then
      raise exception 'Descuento debe estar entre 0 y 100';
    end if;

    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid for update;
    if not found then raise exception 'Producto no encontrado'; end if;

    if coalesce((v_product.sizes->>v_size)::int, 0) < v_qty then
      raise exception 'Stock insuficiente para % talla %', v_product.name, v_size;
    end if;

    v_line_subtotal := v_product.price * v_qty;
    v_line_disc := round(v_line_subtotal * v_disc_pct / 100);

    -- descontar stock
    update public.products set
      sizes = jsonb_set(
        sizes,
        array[v_size],
        to_jsonb(coalesce((sizes->>v_size)::int, 0) - v_qty)
      )
    where id = v_product.id;

    return query insert into public.sales (
      order_id, seller_id, seller_name, product_id, product_name, sku,
      size, quantity, unit_price, line_subtotal, discount, total, payment_method,
      customer_name, customer_cedula, customer_address, customer_phone, customer_email,
      sold_at
    ) values (
      v_order_id,
      p_seller_id,
      coalesce(v_seller.first_name || ' ' || v_seller.last_name, v_seller.username),
      v_product.id,
      v_product.name,
      v_product.sku,
      v_size,
      v_qty,
      v_product.price,
      v_line_subtotal,
      v_line_disc,
      v_line_subtotal - v_line_disc,
      v_pay,
      v_cust_name, v_cust_ced, v_cust_addr, v_cust_phn, v_cust_eml,
      v_sold_at
    ) returning *;
  end loop;
end;
$$;

-- Cancelar venta (devuelve stock)
create or replace function public.cancel_sale(p_sale uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sales%rowtype;
begin
  select * into s from public.sales where id = p_sale for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  update public.products
    set sizes = jsonb_set(
      sizes,
      array[s.size],
      to_jsonb(coalesce((sizes->>s.size)::int, 0) + s.quantity)
    )
    where id = s.product_id;
  delete from public.sales where id = p_sale;
end;
$$;

-- Cancelar pedido completo
create or replace function public.cancel_order(p_order text)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sales%rowtype;
begin
  for s in select * from public.sales where order_id = p_order for update loop
    update public.products
      set sizes = jsonb_set(
        sizes,
        array[s.size],
        to_jsonb(coalesce((sizes->>s.size)::int, 0) + s.quantity)
      )
      where id = s.product_id;
  end loop;
  delete from public.sales where order_id = p_order;
end;
$$;

-- Ajustar inventario inicial sin perder ventas
create or replace function public.set_initial_size(
  p_product uuid, p_size text, p_qty int
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old_initial int;
  v_old_stock int;
  v_sold int;
  v_new_stock int;
begin
  if p_qty < 0 then raise exception 'Cantidad inválida'; end if;
  select coalesce((initial_sizes->>p_size)::int, 0),
         coalesce((sizes->>p_size)::int, 0)
    into v_old_initial, v_old_stock
    from public.products where id = p_product for update;
  v_sold := greatest(0, v_old_initial - v_old_stock);
  v_new_stock := greatest(0, p_qty - v_sold);
  update public.products
    set initial_sizes = jsonb_set(initial_sizes, array[p_size], to_jsonb(p_qty)),
        sizes         = jsonb_set(sizes, array[p_size], to_jsonb(v_new_stock))
    where id = p_product;
end;
$$;

-- ============================================================
-- 4) Premios
-- ============================================================
create table if not exists public.prizes (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'amount' check (type in ('amount', 'units')),
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

-- profiles: cualquier authenticated puede leer (para listar vendedoras en SaleModal)
drop policy if exists profiles_select_auth on public.profiles;
create policy profiles_select_auth on public.profiles for select
  using (auth.role() = 'authenticated');

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin on public.profiles for update
  using (auth.uid() = id or public.is_admin());

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

-- sales: vendedora ve sus ventas, admin ve todas
drop policy if exists sales_select_own_or_admin on public.sales;
create policy sales_select_own_or_admin on public.sales for select
  using (seller_id = auth.uid() or public.is_admin());

drop policy if exists sales_insert_authenticated on public.sales;
create policy sales_insert_authenticated on public.sales for insert
  with check (auth.role() = 'authenticated');

drop policy if exists sales_admin_delete on public.sales;
create policy sales_admin_delete on public.sales for delete using (public.is_admin());

-- prizes
drop policy if exists prizes_read on public.prizes;
create policy prizes_read on public.prizes for select using (auth.role() = 'authenticated');
drop policy if exists prizes_admin_write on public.prizes;
create policy prizes_admin_write on public.prizes for all
  using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 6) Realtime: suscribirse a cambios en estas tablas
-- ============================================================
alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.sales;
alter publication supabase_realtime add table public.prizes;
alter publication supabase_realtime add table public.profiles;
