# Supabase setup for TEER WALE
#
# Supabase is a free PostgreSQL database + storage service.
# Using it means your member data and photos will NEVER be lost on restart.
#
# 1. Create a free Supabase project at https://supabase.com
# 2. Get these values from the project dashboard:
#      - Project URL (e.g. https://xyz.supabase.co)
#      - anon/public key (Settings → API → anon public)
# 3. Set these as environment variables (see .env.example).
# 4. Run the SQL schema in the Supabase SQL editor (see SUPABASE_SCHEMA below).
# 5. Start the app:  node server.js
#
# That's it — no other code changes needed.

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_KEY=your-anon-public-key-here

# Local settings (optional — these work the same with Supabase)
# PJS_DATA_DIR=./data
# PORT=3000
# HOST=0.0.0.0
# SITE_URL=https://your-domain.com

# Admin account (first run creates this automatically)
# ADMIN_EMAIL=your-email@example.com
# ADMIN_PASSWORD=your-secure-password-here
