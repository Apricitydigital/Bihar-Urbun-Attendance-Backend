-- RBAC core tables for dynamic roles, permissions, and assignments
-- Run with: psql -h <host> -U <user> -d <db> -f 20250105_create_rbac_tables.sql

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) UNIQUE NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  module VARCHAR(120) NOT NULL,
  action VARCHAR(60) NOT NULL,
  label VARCHAR(160),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT permissions_unique UNIQUE (module, action)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by INTEGER,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by INTEGER,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by INTEGER,
  PRIMARY KEY (user_id, permission_id)
);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS department VARCHAR(120);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_roles_updated_at
BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_permissions_updated_at
BEFORE UPDATE ON permissions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed base permissions and roles (idempotent)
INSERT INTO roles (name, description, is_system)
VALUES ('admin', 'Full platform administrator', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO roles (name, description, is_system)
VALUES ('supervisor', 'Supervisor default role', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (module, action, label, description)
VALUES
  ('users', 'view', 'View Users', 'Read-only access to users'),
  ('users', 'create', 'Create Users', 'Create new user accounts'),
  ('users', 'edit', 'Edit Users', 'Modify existing user accounts'),
  ('users', 'delete', 'Delete Users', 'Remove user accounts'),
  ('roles', 'view', 'View Roles', 'Read-only access to roles'),
  ('roles', 'create', 'Create Roles', 'Create new roles'),
  ('roles', 'edit', 'Edit Roles', 'Modify role definitions'),
  ('roles', 'delete', 'Delete Roles', 'Remove custom roles'),
  ('permissions', 'manage', 'Manage Permissions', 'Create/assign permissions'),
  ('reports', 'view', 'View Reports', 'Access analytics dashboards'),
  ('master', 'view', 'View Master Data', 'Read master data lists'),
  ('master', 'manage', 'Manage Master Data', 'Create and update master records')
ON CONFLICT (module, action) DO NOTHING;

-- Ensure admin role has all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;
