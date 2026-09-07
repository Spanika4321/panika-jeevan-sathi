-- =====================================================================
-- SEVA MARKET INDIA — migration 0002: remote-mirror change log
--
-- Appwrite Cloud cannot run SQL, so this SQLite database stays the fast
-- query engine while every change is *also* recorded here for a remote
-- mirror (src/db/remote.js pushes the log to Appwrite).
--
-- Triggers run inside the same transaction as the change they record, so a
-- row is either written AND logged, or neither. Cascaded deletes (FK ON
-- DELETE CASCADE / SET NULL) fire these triggers too, which keeps the
-- remote mirror exact without reconciliation jobs.
--
-- The log stores only (table, operation, primary key). The mirror reads the
-- current row back at flush time, so future migrations that add columns
-- need no trigger changes.
-- =====================================================================

CREATE TABLE IF NOT EXISTS _sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl         TEXT NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  pk          TEXT NOT NULL,
  synced_at   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS _sync_log_pending_idx
  ON _sync_log (synced_at, id) WHERE synced_at IS NULL;

-- ---------------------------------------------------------------- users
CREATE TRIGGER IF NOT EXISTS trg_users_sync_ins AFTER INSERT ON users
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('users', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_users_sync_upd AFTER UPDATE ON users
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('users', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_users_sync_del AFTER DELETE ON users
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('users', 'delete', OLD.id); END;

-- ----------------------------------------------------------- locations
CREATE TRIGGER IF NOT EXISTS trg_locations_sync_ins AFTER INSERT ON locations
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('locations', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_locations_sync_upd AFTER UPDATE ON locations
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('locations', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_locations_sync_del AFTER DELETE ON locations
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('locations', 'delete', OLD.id); END;

-- ---------------------------------------------------------- categories
CREATE TRIGGER IF NOT EXISTS trg_categories_sync_ins AFTER INSERT ON categories
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('categories', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_categories_sync_upd AFTER UPDATE ON categories
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('categories', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_categories_sync_del AFTER DELETE ON categories
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('categories', 'delete', OLD.id); END;

-- ----------------------------------------------------------- providers
CREATE TRIGGER IF NOT EXISTS trg_providers_sync_ins AFTER INSERT ON providers
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('providers', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_providers_sync_upd AFTER UPDATE ON providers
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('providers', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_providers_sync_del AFTER DELETE ON providers
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('providers', 'delete', OLD.id); END;

-- ------------------------------------------------------------ services
CREATE TRIGGER IF NOT EXISTS trg_services_sync_ins AFTER INSERT ON services
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('services', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_services_sync_upd AFTER UPDATE ON services
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('services', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_services_sync_del AFTER DELETE ON services
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('services', 'delete', OLD.id); END;

-- ------------------------------------------------------- service_areas
-- Composite primary key (provider_id, pin_code); pk key = "id-pin".
CREATE TRIGGER IF NOT EXISTS trg_service_areas_sync_ins AFTER INSERT ON service_areas
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('service_areas', 'upsert', NEW.provider_id || '-' || NEW.pin_code); END;
CREATE TRIGGER IF NOT EXISTS trg_service_areas_sync_upd AFTER UPDATE ON service_areas
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('service_areas', 'upsert', NEW.provider_id || '-' || NEW.pin_code); END;
CREATE TRIGGER IF NOT EXISTS trg_service_areas_sync_del AFTER DELETE ON service_areas
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('service_areas', 'delete', OLD.provider_id || '-' || OLD.pin_code); END;

-- --------------------------------------------------------------- leads
CREATE TRIGGER IF NOT EXISTS trg_leads_sync_ins AFTER INSERT ON leads
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('leads', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_leads_sync_upd AFTER UPDATE ON leads
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('leads', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_leads_sync_del AFTER DELETE ON leads
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('leads', 'delete', OLD.id); END;

-- ---------------------------------------------------------- audit_logs
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_sync_ins AFTER INSERT ON audit_logs
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('audit_logs', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_sync_upd AFTER UPDATE ON audit_logs
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('audit_logs', 'upsert', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_logs_sync_del AFTER DELETE ON audit_logs
BEGIN INSERT INTO _sync_log (tbl, op, pk) VALUES ('audit_logs', 'delete', OLD.id); END;
