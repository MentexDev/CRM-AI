-- C-A-R: cerrar fuga multi-marca en code_templates. Las policies INSERT/UPDATE validaban QUIÉN escribe
-- pero NO el brand_id resultante → un usuario podía plantar/promover plantillas globales o de otra marca.
-- Patrón correcto (igual que cs_module/conversations): solo la junta crea/promueve GLOBALES (brand_id null);
-- el resto debe targetear una marca con acceso (brand_id NOT NULL + has_brand_access). + WITH CHECK en UPDATE.
drop policy if exists code_templates_insert on public.code_templates;
create policy code_templates_insert on public.code_templates for insert
  with check (created_by = auth.uid() and (public.is_junta() or (brand_id is not null and public.has_brand_access(brand_id))));

drop policy if exists code_templates_update on public.code_templates;
create policy code_templates_update on public.code_templates for update
  using (public.is_junta() or created_by = auth.uid())
  with check (public.is_junta() or (created_by = auth.uid() and brand_id is not null and public.has_brand_access(brand_id)));
