# Salama Digital – foundation (DB/testing + Module 1)
1. `npm install && npm run gen:secrets` → put output in `.env` (see `.env.example`)
2. `ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run seed:admin` (first login forces password change + MFA enrolment)
3. `npm start` · `npm test`

Layout: `src/repositories/*` (all SQL; swap for Postgres later) · `src/services/*` (logic) · `src/routes/*` (HTTP) · `src/auth/roles.js` (7 roles + permission matrix) · `src/db/migrations/*.sql`.
