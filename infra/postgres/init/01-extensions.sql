-- =============================================================================
-- Pilotage Scolaire — Postgres 15 bootstrap
-- Lancé automatiquement au premier démarrage du container postgres
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ---------------------------------------------------------------------------
-- 2) Application roles
-- ---------------------------------------------------------------------------
-- app_user: utilisé par l'application (RLS active)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator LOGIN PASSWORD 'app_migrator' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auditor') THEN
    CREATE ROLE auditor LOGIN PASSWORD 'auditor' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END$$;

GRANT CONNECT ON DATABASE pilotage TO app_user, app_migrator, auditor;

-- ---------------------------------------------------------------------------
-- 3) Separate database for Keycloak
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'keycloak') THEN
    CREATE ROLE keycloak LOGIN PASSWORD 'keycloak' NOSUPERUSER CREATEDB;
  END IF;
END$$;

SELECT 'CREATE DATABASE keycloak OWNER keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
