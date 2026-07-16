-- User to City access mapping for city-level authorization
-- Run with: psql -h <host> -U <user> -d <db> -f 20250220_add_user_city_access.sql

CREATE TABLE IF NOT EXISTS user_city_access (
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  city_id INTEGER NOT NULL REFERENCES cities(city_id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by INTEGER REFERENCES users(user_id),
  PRIMARY KEY (user_id, city_id)
);

CREATE INDEX IF NOT EXISTS idx_user_city_access_city_id
  ON user_city_access (city_id);

-- Ensure the table exists even if migrations were skipped previously
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'user_city_access_pkey'
      AND table_name = 'user_city_access'
  ) THEN
    ALTER TABLE user_city_access
    ADD CONSTRAINT user_city_access_pkey PRIMARY KEY (user_id, city_id);
  END IF;
END $$;
