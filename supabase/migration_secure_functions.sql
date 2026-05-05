-- Migration: agregar verificación de permisos en las funciones SECURITY DEFINER.
-- Antes cualquier authenticated user podía llamarlas (las funciones bypasean RLS
-- por ser security definer). Ahora exigen ser admin o el dueño del recurso.

-- ============================================================
-- cancel_sale: solo admin o la vendedora dueña de esa venta
-- ============================================================
create or replace function public.cancel_sale(p_sale uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sales%rowtype;
begin
  select * into s from public.sales where id = p_sale for update;
  if not found then raise exception 'Venta no encontrada'; end if;

  if not (auth.uid() = s.seller_id or public.is_admin()) then
    raise exception 'Sin permisos para anular esta venta';
  end if;

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

-- ============================================================
-- cancel_order: igual, admin o dueña del pedido
-- ============================================================
create or replace function public.cancel_order(p_order text)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sales%rowtype; v_owner uuid;
begin
  select seller_id into v_owner from public.sales where order_id = p_order limit 1;
  if v_owner is null then raise exception 'Pedido no encontrado'; end if;
  if not (auth.uid() = v_owner or public.is_admin()) then
    raise exception 'Sin permisos para anular este pedido';
  end if;

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

-- ============================================================
-- set_initial_size: solo admin (ajuste de inventario inicial)
-- ============================================================
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
  if not public.is_admin() then
    raise exception 'Solo admin puede ajustar el inventario inicial';
  end if;
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
-- register_order: solo admin puede registrar a nombre de otra vendedora;
-- las vendedoras solo pueden registrar a su propio nombre
-- ============================================================
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
  if not (auth.uid() = p_seller_id or public.is_admin()) then
    raise exception 'No puedes registrar ventas a nombre de otra vendedora';
  end if;

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
