# Dent22 Backend

This folder now contains:
- `src/`: standalone Node/Express backend API (runs separately from frontend)
- `sql/`: Supabase schema, policies, and migration/hotfix scripts

Project target: `hddexuhvimiwevuhzjyg`

## Run Backend API (separate process)

Requirements:
- Node.js 18+

Commands:

```bash
cd backend
npm install
npm run dev
```

API base URL:
- `http://localhost:4000`

Health check:
- `GET /api/health`

Supabase passthrough proxy (for frontend):
- `http://localhost:4000/supabase/*`

### Environment

Use `backend/.env` (already created) or copy from `backend/.env.example`.

```env
PORT=4000
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM_EMAIL=
SMTP_FROM_NAME=Smiles Dental Hub
```

## Run Frontend + Backend Separately

Terminal 1:

```bash
cd backend
npm run dev
```

Terminal 2:

```bash
cd frontend
npm run dev
```

Important frontend env:
- `VITE_SUPABASE_URL=http://localhost:4000/supabase`
- `VITE_SUPABASE_ANON_KEY=<same anon key>`

With this, frontend Supabase client calls are routed through backend proxy.

## Postman API Routes

### Auth

- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/refresh-session`
- `GET /api/auth/me` (Bearer token required)
- `POST /api/auth/update-password` (Bearer token required)
- `POST /api/auth/logout` (Bearer token required)

Login request body:

```json
{
  "login": "admin",
  "password": "Admin123!"
}
```

### RPC Proxy

- `POST /api/rpc/:fn`
- Use `Authorization: Bearer <access_token>` for authenticated RPCs
- `resolve_login_email` is allowed without token

Example:

```http
POST /api/rpc/allowed_navigation
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{
  "params": {}
}
```

### Generic DB Routes (Bearer token required)

- `POST /api/db/select`
- `POST /api/db/insert`
- `POST /api/db/upsert`
- `POST /api/db/update`
- `POST /api/db/delete`

`select` example:

```json
{
  "table": "patients",
  "columns": "*",
  "filters": [
    { "column": "is_active", "operator": "eq", "value": true }
  ],
  "orderBy": [{ "column": "created_at", "ascending": false }],
  "limit": 20,
  "offset": 0
}
```

`insert` example:

```json
{
  "table": "patients",
  "values": {
    "first_name": "John",
    "last_name": "Doe",
    "sex": "Male",
    "authorization_accepted": true
  }
}
```

`update` example:

```json
{
  "table": "patients",
  "values": { "phone": "09171234567" },
  "filters": [{ "column": "id", "operator": "eq", "value": "PATIENT_UUID" }]
}
```

`delete` example:

```json
{
  "table": "patient_documents",
  "filters": [{ "column": "id", "operator": "eq", "value": "DOC_UUID" }]
}
```

Supported filter operators:
- `eq`
- `neq`
- `gt`
- `gte`
- `lt`
- `lte`
- `like`
- `ilike`
- `in`
- `is`
- `contains`
- `containedBy`
- `overlaps`
- `textSearch`

## Supabase SQL Setup

Staff-only roles:
- `admin`
- `receptionist`
- `associate_dentist`

No patient account role is included.

### SQL Files

- `sql/00_schema_and_policies.sql`
- `sql/00a_add_admin_role_enum.sql`
- `sql/01_dev_seed_staff_accounts.sql`
- `sql/02_smoke_test_flow.sql`
- `sql/03_seed_app_data.sql`
- `sql/04_profile_and_amount_hotfix.sql`
- `sql/05_service_pricing_and_discount_hotfix.sql`
- `sql/06_patient_documents_columns_hotfix.sql`
- `sql/07_auth_account_recovery_hotfix.sql`
- `sql/07_service_records_and_documents_rules_hotfix.sql`
- `sql/08_patient_code_sequence_hotfix.sql`
- `sql/15_verification_codes_hotfix.sql`
- `sql/09_auth_pgcrypto_search_path_hotfix.sql`
- `sql/21_system_audit_logs.sql`
- `sql/22_backfill_system_audit_logs.sql`
- `sql/23_harden_system_audit_log_policies.sql`

### Run Order (Supabase SQL Editor)

1. If upgrading an existing DB, run `backend/sql/00a_add_admin_role_enum.sql` in its own execution.
2. Run `backend/sql/00_schema_and_policies.sql`.
3. For older DBs, run applicable hotfix files: `04`, `05`, `06`, `07`, `08`, `09`, `15`, `17`, `18`, `19`, `20`.
4. Run `backend/sql/21_system_audit_logs.sql`.
5. Run `backend/sql/22_backfill_system_audit_logs.sql`.
6. Run `backend/sql/23_harden_system_audit_log_policies.sql`.
7. Optional (dev only): run `backend/sql/01_dev_seed_staff_accounts.sql`.
8. Optional: run `backend/sql/03_seed_app_data.sql`.
9. Optional: run `backend/sql/02_smoke_test_flow.sql`.

### Admin RPCs

- `public.admin_create_user(email, password, full_name, username, role)`
- `public.admin_update_user_profile(user_id, full_name, username, role, is_active)`
- `public.admin_reset_user_password(user_id, new_password)`
- `public.list_patient_logs()`
