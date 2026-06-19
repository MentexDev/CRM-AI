-- Auditabilidad (cierre C-A-R): la escritura de `agents` (config/provider/model, etc.) debe estar
-- gateada por is_junta() a nivel RLS — el gate del front (botón ⚙️/selector de modelo solo visibles
-- para la Junta) es cosmético; la garantía real es esta política. Ya existe en la BD live; esta
-- migración la deja como fuente-de-verdad en el repo. Idempotente: solo la crea si faltara.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'agents' and policyname = 'agents_junta_writes'
  ) then
    create policy agents_junta_writes on public.agents
      for all using (is_junta()) with check (is_junta());
  end if;
end $$;
