-- FASE 3: edición en vivo COMPARTIDA. El módulo es una herramienta del equipo: cualquier usuario
-- autenticado puede editar los datos (sections) y se guarda solo. Es contenido de equipo (mismo criterio
-- que pm_read = lectura abierta). El BORRADO (pm_delete) sigue restringido a creador/Junta; el INSERT
-- (pm_insert) sigue exigiendo created_by = auth.uid().
drop policy if exists pm_update on public.published_modules;
create policy pm_update on public.published_modules for update to authenticated
  using (true) with check (true);
