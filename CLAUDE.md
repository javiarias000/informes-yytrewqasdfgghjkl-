# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the server (port 3001)
npm start

# Seed the SQLite database from the XLSX + hardcoded tutor data (safe to re-run)
node seed-db.js

# Export CSV utility
node export_csv.js
```

No build step, no linter config, no test suite.

## Architecture

Single-file Express backend (`server.js`, ~2100 lines) + vanilla JS + Tailwind CSS frontend (`public/`). No framework, no bundler.

### Key external services

| Service | Purpose | Config |
|---|---|---|
| Google Sheets API | Read grade/contact data from teacher spreadsheets; write cells back | OAuth2 via `credentials.json` + `token.json` |
| Google Forms | Auto-submit teacher reports via POST to `formResponse` | Hardcoded form entry IDs + `FORM_URL` in server.js |
| Evolution API (WhatsApp) | Send grade/attendance reports to parents | `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` in `.env` |
| OpenAI `gpt-4.1-mini` | Analyze spreadsheet structure and Google Form fields | `OPENAI_API_KEY` in `.env` |
| SGA1 (Django) | Optional proxy for `/api/informes/*` to a local Django backend | `SGA1_BASE` in `.env` (defaults to `http://localhost:8000`) |

### Database (`db.js`)

Uses `sql.js` (pure JS, no native SQLite bindings). Schema in 3NF:
- `docentes` — teacher roster (name, phone, emails)
- `cursos` — course catalog (grade 1–11, paralelo A/B/C)
- `tutores_cursos` — which teacher is tutor of which course per school year
- `clases_sesiones` — pedagogical session metadata (topic, description, keyed by sheetId+tab+colIndex)
- `clase_recomendaciones` — per-student recommendations per session

The DB is loaded from `conservatorio.db` on startup and written back to disk after every mutation (`_persist()`). The file is a binary SQLite blob.

### Grade and attendance tab naming

Grade tabs: `1P`, `2P`, `3P`, `4P` (parciales), `1Q`, `2Q` (quimestres), `Anual`.  
Attendance tabs: `A1`, `A2`, `A3`, `A4` (one per parcial).  
Tab names are matched in `column_map.json` (`Datos/column_map.json`) and used throughout server.js to pick editable column indices.

### Course → dropdown option mapping

`CURSO_TUTOR_OPTIONS` in server.js is the hardcoded list of Google Form dropdown options (30 course+tutor strings). `DROPDOWN_MAP` pre-computes a `"grade_PARALELO"` → option string lookup. `parseCursoKey()` normalizes a raw course name (e.g. `"4to A"`, `"2do Bach B"`) to the same key format. **If the form dropdown options ever change, update both `CURSO_TUTOR_OPTIONS` and `seed-db.js`.**

### Column mapping system

`Datos/column_map.json` maps each CSV/tab name to its column indices, header row, data start row, and skip rows. The `/api/cal/*` endpoints serve this data. The UI's "Hojas" section lets users configure mappings visually; saving calls `POST /api/cal/map`.

### Form submission flow

1. User configures subject sheets (Google Sheets URL + tab selection).
2. `/api/smart-load` reads contact + grade tabs, groups students by curso, marks those with promedio < 7 as `dificultades`.
3. User fills in `contenidos` and `acciones` text fields.
4. `/api/submit-forms` POSTs to Google Form's `formResponse` endpoint for each group, then appends to `submissions.json`.
5. Optionally sends WhatsApp to the class tutor via Evolution API.

### Parent report flow

1. `/api/parent-grades` loads a grade or attendance tab, cross-references the `Contacto` tab for phone numbers.
2. `/api/wa/send-parent-report` builds a formatted WhatsApp message per student and sends via Evolution API.

### OAuth setup

Google OAuth redirect URI is hardcoded in server.js as a `trycloudflare.com` URL. **Must be updated when the Cloudflare tunnel URL changes** (also update it in Google Cloud Console's authorized redirect URIs). Flow: `GET /auth` → Google consent → `GET /oauth2callback` → saves `token.json`.

### Runtime-created files

- `submissions.json` — form submission history, capped at 500 entries, created on first submission.
- `token.json` — Google OAuth token, created via `/auth` flow.
- `docentes_overrides.json` — manual phone/email overrides for teachers, written by `/api/docentes/upsert`.

### Frontend

`public/index.html` — single-page app with sidebar nav. Sections: Historial, Nuevo informe, Hojas, Ingreso de datos, Actividades, Informes a padres.  
`public/app.js` — all client-side logic (section switching, API calls, rendering).  
`public/calificaciones.html` — separate calificaciones viewer page.  
All time handling uses `America/Guayaquil` (UTC-5, no DST).
