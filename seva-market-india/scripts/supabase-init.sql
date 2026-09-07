SET lock_timeout = '10s';
SET statement_timeout = '30s';

BEGIN;

CREATE TABLE IF NOT EXISTS public.seva_mirror (
  tbl       text NOT NULL,
  id        text NOT NULL,
  doc       jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tbl, id)
);

ALTER TABLE public.seva_mirror ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.seva_mirror FROM anon;
REVOKE ALL ON TABLE public.seva_mirror FROM authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
