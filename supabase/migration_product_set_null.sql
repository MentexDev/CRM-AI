-- Migration: permitir borrar productos sin tener que borrar sus ventas
-- históricas. Cuando se elimina un producto, las ventas asociadas
-- conservan el registro (product_name, sku, total) pero pierden el
-- link via product_id (que pasa a NULL).
--
-- Ejecutar en Supabase SQL Editor.

-- 1) Permitir nulos en sales.product_id
alter table public.sales alter column product_id drop not null;

-- 2) Recrear la FK con ON DELETE SET NULL
alter table public.sales drop constraint if exists sales_product_id_fkey;
alter table public.sales
  add constraint sales_product_id_fkey
  foreign key (product_id)
  references public.products(id)
  on delete set null;
