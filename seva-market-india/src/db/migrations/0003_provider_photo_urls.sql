-- SEVA MARKET INDIA — up to five server-uploaded business photos per profile.
-- Values are JSON URL arrays. File bytes live in Supabase Storage in production
-- (or in ignored public/uploads during local development), never in SQLite.
ALTER TABLE providers ADD COLUMN photo_urls TEXT NOT NULL DEFAULT '[]';
