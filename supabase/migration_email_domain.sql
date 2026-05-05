-- Migration: cambiar el dominio sintético del email interno
-- de @nina.local (rechazado por Supabase, RFC 6762) a @nina.app
-- Solo afecta al admin Ana que se creó manualmente con .local.
-- Las nuevas vendedoras creadas desde la app ya nacerán con .app.

update auth.users
   set email = replace(email, '@nina.local', '@nina.app')
 where email like '%@nina.local';

-- Verificar:
-- select id, email from auth.users where email like '%@nina.app';
