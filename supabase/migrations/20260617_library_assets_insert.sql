-- "Guardar en la biblioteca" desde el canvas (cliente). library_assets solo tenía policy
-- de SELECT (los agentes insertan server-side con service_role). Permitimos que un usuario
-- autenticado guarde un entregable en la biblioteca de UNA marca a la que tiene acceso.
create policy library_assets_insert on public.library_assets
  for insert to authenticated
  with check (has_brand_access(brand_id));
