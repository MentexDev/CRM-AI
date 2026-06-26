-- FASE 3 (corrección C-A-R): la edición en vivo COMPARTIDA NO debe hacerse con un pm_update abierto
-- (permitía a cualquiera reasignar created_by / cambiar title/kind/etc. de cualquier módulo). En su lugar:
--   1) pm_update vuelve a ser RESTRICTIVO (gestión: renombrar / re-publicar = creador o Junta).
--   2) una RPC SECURITY DEFINER actualiza SOLO sections[idx].data → cualquier autenticado edita los DATOS
--      del equipo, sin poder tocar la autoría ni la estructura. Persiste por sección (jsonb_set) para no
--      pisar lo que otro editó en OTRAS secciones del mismo módulo.
drop policy if exists pm_update on public.published_modules;
create policy pm_update on public.published_modules for update to authenticated
  using (public.is_junta() or created_by = auth.uid())
  with check (public.is_junta() or created_by = auth.uid());

create or replace function public.update_module_section_data(p_id uuid, p_index int, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if p_index < 0 then
    raise exception 'Índice inválido';
  end if;
  update public.published_modules
    set sections = jsonb_set(sections, array[p_index::text, 'data'], coalesce(p_data, '{}'::jsonb), true)
    where id = p_id
      and jsonb_typeof(sections) = 'array'
      and jsonb_array_length(sections) > p_index
    returning id into v_id;
  return v_id; -- null si el módulo o la sección no existen
end;
$$;
revoke all on function public.update_module_section_data(uuid, int, jsonb) from public;
grant execute on function public.update_module_section_data(uuid, int, jsonb) to authenticated;

-- La sección "Resumen" del Tracker pasa a kind 'summary' → se detecta de forma EXPLÍCITA (no por título)
-- y se renderiza calculada (no editable).
update public.published_modules
set sections = (
  select jsonb_agg(case when s->>'title' ilike 'resumen%' then jsonb_set(s, '{kind}', '"summary"') else s end order by ord)
  from jsonb_array_elements(sections) with ordinality e(s, ord)
)
where title = 'Tracker de Gastos y Presupuesto'
  and exists (select 1 from jsonb_array_elements(sections) s where s->>'title' ilike 'resumen%');
