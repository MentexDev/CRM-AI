-- Cierre C-A-R (cambiar de agente en el chat): la política UPDATE de conversations existía con
-- USING ((created_by = auth.uid()) OR has_brand_access(brand_id)) pero SIN WITH CHECK, así que la
-- fila RESULTANTE no se validaba (se podía reasignar brand_id a una marca sin acceso). Añadimos el
-- WITH CHECK para que tras un UPDATE la conversación siga siendo accesible al usuario (defensa en
-- profundidad; el switchAgent del front ya NO toca brand_id). ALTER POLICY no recrea (sin ventana).
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conversations' and policyname = 'conversations_update'
  ) then
    alter policy conversations_update on public.conversations
      with check ((created_by = auth.uid()) OR has_brand_access(brand_id));
  end if;
end $$;
