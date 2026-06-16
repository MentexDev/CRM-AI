-- Fix auditoría C-A-R (L1): la política de lectura de approvals tenía un cortocircuito
-- `brand_id IS NULL OR has_brand_access(brand_id)` → CUALQUIER usuario autenticado podía
-- leer las aprobaciones de agentes sin marca (incluido el cuerpo HTML del correo en el
-- payload). has_brand_access(NULL) ya evalúa a is_junta() (la membresía de una marca NULL
-- no matchea), así que basta con quitar el OR: las filas sin marca quedan solo para la Junta.
alter policy approvals_read_by_access on public.approvals
  using (has_brand_access(brand_id));
