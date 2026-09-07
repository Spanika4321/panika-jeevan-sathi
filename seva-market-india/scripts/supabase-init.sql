-- SEVA MARKET INDIA — public.seva_mirror
--
-- How to run (Supabase dashboard):
--   1. SQL Editor -> New query (empty editor, no leftover text)
--   2. Paste ONLY the statements below this comment block
--   3. Run
--
-- Do not paste a filename or path. A path is not SQL.

CREATE TABLE IF NOT EXISTS public.seva_mirror (
  tbl       text NOT NULL,
  id        text NOT NULL,
  doc       jsonb NOT NULL DEFAULT jsonb_build_object(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tbl, id)
);

ALTER TABLE public.seva_mirror ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.seva_mirror FROM anon;
REVOKE ALL ON TABLE public.seva_mirror FROM authenticated;

NOTIFY pgrst, 'reload schema';
