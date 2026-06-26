-- MÓDULOS MULTI-SECCIÓN: un módulo publicado puede tener VARIAS secciones (pestañas) navegables desde
-- un menú en el sidebar. Cambio ADITIVO (no destructivo): se agrega una columna `sections` jsonb.
-- Forma de cada elemento: { id, title, kind('document'|'sheet'|'board'|'slides'), icon?, data:{payload} }.
-- Los módulos ya publicados (sections = []) siguen funcionando: el front deriva una sección única desde
-- las columnas kind/data existentes (compatibilidad hacia atrás, sin backfill obligatorio).
alter table public.published_modules add column if not exists sections jsonb not null default '[]'::jsonb;
