-- Migration: cuando se elimina un user de auth.users (vía Edge Function admin
-- con service_role), su profile en public.profiles se elimina automáticamente.
-- (Ya estaba así en schema.sql, esto es por si la base se creó con una
-- versión vieja sin el cascade.)

alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id)
  references auth.users(id)
  on delete cascade;
