-- WEIN NINA Inventary — promover admin
-- Ejecutar DESPUÉS de schema.sql.
-- Antes de correr esto: ve a Authentication → Users → Add user → Create new user
--   Email:    ninabrandon.villa@nina.local
--   Password: NINA123*
--   Auto Confirm User: ✅
-- (la app mapea el username NINAbrandon.villa al email sintético @nina.local)

update public.profiles
   set role       = 'admin',
       first_name = 'Brandon',
       last_name  = 'Villa',
       avatar     = 'BV',
       goal       = 0
 where username = 'NINAbrandon.villa';
