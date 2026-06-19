-- Cierre C-A-R de Skills: refuerzo de aislamiento multi-marca.
-- (1) Asignar una skill a un agente exige que la skill sea de la MISMA marca del agente (o global),
--     además del acceso del caller a la marca del agente. Antes solo se validaba el agente → un
--     usuario podía asignar (y filtrar vía la inyección en el contexto) una skill de otra marca.
drop policy if exists agent_skills_insert on public.agent_skills;
create policy agent_skills_insert on public.agent_skills for insert with check (
  exists (
    select 1 from public.agents a
    where a.id = agent_skills.agent_id
      and ((a.brand_id is null) or has_brand_access(a.brand_id))
      and exists (
        select 1 from public.skills s
        where s.id = agent_skills.skill_id
          and (s.brand_id is null or s.brand_id = a.brand_id)
      )
  )
);

-- (2) Las skills / asignaciones SIN marca (brand_id null) ya NO son legibles por todas las marcas:
--     se quita el atajo "(brand_id is null) OR". has_brand_access(null)=is_junta(), así que el
--     contenido sin marca solo lo ve la Junta (mismo criterio que el fix de approvals).
drop policy if exists skills_read on public.skills;
create policy skills_read on public.skills for select
  using (has_brand_access(brand_id));

drop policy if exists agent_skills_read on public.agent_skills;
create policy agent_skills_read on public.agent_skills for select using (
  exists (select 1 from public.agents a where a.id = agent_skills.agent_id and has_brand_access(a.brand_id))
);

drop policy if exists agent_skills_delete on public.agent_skills;
create policy agent_skills_delete on public.agent_skills for delete using (
  exists (select 1 from public.agents a where a.id = agent_skills.agent_id and has_brand_access(a.brand_id))
);
