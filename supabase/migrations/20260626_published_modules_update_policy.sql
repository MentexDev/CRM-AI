-- Permite RE-PUBLICAR (actualizar el MISMO módulo, manteniendo su id/URL) en vez de crear duplicados.
-- Acotada al creador o a la Junta (mismo criterio que pm_delete del hardening).
drop policy if exists pm_update on public.published_modules;
create policy pm_update on public.published_modules for update to authenticated
  using (public.is_junta() or created_by = auth.uid())
  with check (public.is_junta() or created_by = auth.uid());
