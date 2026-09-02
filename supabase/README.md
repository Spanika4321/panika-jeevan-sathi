# Supabase (GitHub connection)

This folder is what the **Supabase GitHub integration** reads.

The website itself talks to Supabase over HTTPS (`lib/supabase.js`) using
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on Render. Connecting GitHub does
**not** set those Render env vars — it deploys the **schema and photo bucket**.

## Layout

| Path | Purpose |
| --- | --- |
| `config.toml` | Tells GitHub which storage bucket to create (`uploads`, private) |
| `migrations/` | Postgres tables. Applied on merge to `main` when **Deploy to production** is on |
| `schema.sql` | Same SQL, for pasting into the SQL editor (fallback) |

## Dashboard settings (already connected)

1. [Project Settings → Integrations → GitHub](https://supabase.com/dashboard/project/_/settings/integrations)
2. Repository: `Spanika4321/panika-jeevan-sathi`
3. **Working directory:** `.`  (`supabase/` is at the repo root)
4. **Deploy to production:** enabled
5. Production branch: `main`

After a merge to `main`, check the GitHub Checks tab for the Supabase
deployment, then confirm in the Table Editor that `users`, `profiles`,
`messages`, … exist and Storage has an `uploads` bucket.

## Fallback (no GitHub deploy)

```bash
# SQL editor: paste schema.sql and Run.

# Or one command (needs an access token from Account → Access Tokens):
node scripts/supabase-setup.mjs --access-token sbp_xxx            # list projects
node scripts/supabase-setup.mjs --access-token sbp_xxx --apply    # schema + bucket
```

Then paste `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into Render
(see `DEPLOY.md`).
