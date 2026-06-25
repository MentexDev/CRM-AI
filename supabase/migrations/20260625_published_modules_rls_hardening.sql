-- Hardening RLS de published_modules (C-A-R 2026-06-25): las policies abiertas con using(true)
-- permitían que cualquier usuario BORRARA módulos de otros e INSERTARA filas con created_by ajeno.
-- Alineado con el patrón de 20260624_code_templates_rls_hardening.sql.
--   SELECT: contenido de equipo → lectura para cualquier autenticado (declarado de baja sensibilidad).
--   INSERT: solo a nombre propio (created_by = auth.uid()) → no se puede suplantar autoría.
--   DELETE: solo el creador o la Junta → se cierra la destrucción de contenido ajeno.
drop policy if exists pm_read on public.published_modules;
create policy pm_read on public.published_modules for select to authenticated using (true);

drop policy if exists pm_insert on public.published_modules;
create policy pm_insert on public.published_modules for insert to authenticated with check (created_by = auth.uid());

drop policy if exists pm_delete on public.published_modules;
create policy pm_delete on public.published_modules for delete to authenticated using (public.is_junta() or created_by = auth.uid());
