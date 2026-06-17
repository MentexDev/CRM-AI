-- La idempotencia de execute-approval usa una máquina de estados
-- (pending → executing → executed/failed), pero el CHECK original de approvals.status
-- solo permitía pending/approved/rejected/expired → el claim `set status='executing'`
-- violaba el constraint y devolvía 500 al aprobar. Ampliamos los estados permitidos.
alter table public.approvals drop constraint approvals_status_check;
alter table public.approvals add constraint approvals_status_check
  check (status = any (array['pending', 'approved', 'rejected', 'expired', 'executing', 'executed', 'failed']));
