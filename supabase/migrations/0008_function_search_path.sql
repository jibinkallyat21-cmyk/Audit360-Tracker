-- Pins the search path on the three helper functions the Supabase advisor flagged.
-- They are not security-definer and reference no tables, so this is hardening only.
alter function public.next_stage(public.workflow_stage) set search_path = pg_catalog, public;
alter function public.deny() set search_path = pg_catalog, public;
alter function public.block_history_changes() set search_path = pg_catalog, public;
