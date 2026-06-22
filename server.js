require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── OAuth setup ───────────────────────────────────────────────────────────────

const credentials = JSON.parse(fs.readFileSync('credentials.json')).web;
const REDIRECT_URI = 'https://victory-postal-relief-generations.trycloudflare.com/oauth2callback';
const oauth2Client = new google.auth.OAuth2(
  credentials.client_id,
  credentials.client_secret,
  REDIRECT_URI
);

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const TOKEN_PATH = 'token.json';

if (fs.existsSync(TOKEN_PATH)) {
  oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
}

app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    res.redirect('/?auth=ok');
  } catch {
    res.redirect('/?auth=error');
  }
});

app.get('/api/auth-status', (req, res) => {
  res.json({ authenticated: fs.existsSync(TOKEN_PATH) });
});

// ── Google Form constants ─────────────────────────────────────────────────────

const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSewGgx9m2qI-xia17kWKHLUijep2rFVdql7d7YNpb8pAGGN6w/formResponse';

// Exact dropdown options from the form
const CURSO_TUTOR_OPTIONS = [
  '1o A  Larreátegui Feijoó Inés María',
  '2o A  Laura Guaman Christian Daniel',
  '3o A Túquerez Nuñez Diego Javier',
  '4o A  Solis Solis Juan Francisco',
  '5o A Solis Solis Juan Francisco',
  '7o A Amancha Hidalgo Félix Marcelo',
  '8o A Quinapanta Tibán Angel Rodrigo',
  '9o Año (1o Bach ) A Arévalo Castañeda Angel Jorge',
  '10o año (2o Bach)  A Chicaiza Yanez Jeferson Alexander',
  '11o Año (3o Bach) A Guananga Aysabucha Santiago Javier',
  '1o B Reyes Garcés Elizabeth del Roció',
  '1o C Paredes Santana Marco Antonio',
  '2o B Amores Valdivieso Jenny',
  '2o C Nuñez  Cunalata Zoila Delia',
  '3o B  Peña Nuñez Andrea Michelle',
  '3o C  Fonseca  Sandoval Walter Guillermo',
  '4o B  Guzñay Paca Inti Rafael',
  '4o C  Chico Analuisa Fabricio Renato',
  '5o B De la Cruz Changalombo Jorge Ramiro',
  '5o C Pérez Mayorga Edwin Israel',
  '6o B Acosta Zagal Karolina de los Angeles',
  '6o C Caiza Caiza Roberto Carlos',
  '7o B Toapanta Arequipa Danny Alexander',
  '7o C Gutama Galán Juan Diego',
  '8o B Peralta Aponte Christian',
  '8o C Zumbana  Quinapanta Santiago Maximiliano',
  '9o año (1o Bach)  B Chicaiza Cuenca Rubén Geovany',
  '10o año (2o Bach) B Chico Espinoza Edwin Patricio',
  '10o Año (2o Bach) C Jiménez Vega Mauricio Marmonte',
  '11o año (3o Bach) B Tocto Villarreal Marco Antonio',
];

// ── Course matching ───────────────────────────────────────────────────────────

// Pre-compute dropdown map: "grade_PARALELO" → full option string
const DROPDOWN_MAP = (() => {
  const map = {};
  for (const opt of CURSO_TUTOR_OPTIONS) {
    const lo = opt.toLowerCase();
    let grade = null;

    // Bach variants in parentheses → map to grade 9/10/11
    const bachM = lo.match(/\((\d+)o bach/);
    if (bachM) {
      const n = parseInt(bachM[1]);
      grade = n === 1 ? 9 : n === 2 ? 10 : n === 3 ? 11 : null;
    } else {
      const gm = lo.match(/^(\d+)/);
      if (gm) grade = parseInt(gm[1]);
    }

    // Paralelo: first standalone A/B/C after the leading grade/year block
    const afterGrade = lo
      .replace(/^\d+o?\s*(a[ñn]o\s*)?\([^)]*\)\s*/i, '')
      .replace(/^\d+o?\s*(a[ñn]o\s*)?/i, '');
    const pm = afterGrade.match(/^([abc])\b/i);
    const paralelo = pm ? pm[1].toUpperCase() : null;

    if (grade && paralelo) map[`${grade}_${paralelo}`] = opt;
  }
  return map;
})();

function parseCursoKey(cursoStr) {
  const lo = cursoStr.toLowerCase().trim();

  // "Xdo/Xer/Xmo/Xvo Bach [paralelo]" → bachillerato
  const bachM = lo.match(/(\d+)[a-z]*\s*bach[^\s]*\s+([abc])/i);
  if (bachM) {
    const n = parseInt(bachM[1]);
    const grade = n === 1 ? 9 : n === 2 ? 10 : n === 3 ? 11 : null;
    return grade ? `${grade}_${bachM[2].toUpperCase()}` : null;
  }

  // Regular: extract leading number + trailing paralelo letter
  const gm = lo.match(/(\d+)/);
  const pm = lo.match(/\b([abc])\s*$/i);
  if (gm && pm) return `${parseInt(gm[1])}_${pm[1].toUpperCase()}`;

  return null;
}

function findDropdownOption(cursoFromSheet) {
  const key = parseCursoKey(cursoFromSheet);
  return key ? (DROPDOWN_MAP[key] || null) : null;
}

// ── Sheets helpers ────────────────────────────────────────────────────────────

function extractSheetId(urlOrId) {
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : urlOrId.trim();
}

async function getTabNames(sheets, id) {
  const res = await sheets.spreadsheets.get({ spreadsheetId: id });
  return res.data.sheets.map(s => s.properties.title);
}

async function readTab(sheets, id, tab) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `'${tab}'!A:Z`,
    });
    return res.data.values || [];
  } catch {
    return [];
  }
}

function normName(str) {
  return (str || '').trim().replace(/\s+/g, ' ').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Returns: { [studentName]: { promedio, curso } }
async function readStudentSheet(sheets, spreadsheetId) {
  const allTabs = await getTabNames(sheets, spreadsheetId);
  const findTab = kw => allTabs.find(t =>
    t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(kw)
  ) || null;

  const contactTab = findTab('contacto');
  const anualTab   = findTab('anual');
  console.log(`[${spreadsheetId}] contacto="${contactTab}" anual="${anualTab}"`);

  const contactRows = contactTab ? await readTab(sheets, spreadsheetId, contactTab) : [];
  const anualRows   = anualTab   ? await readTab(sheets, spreadsheetId, anualTab)   : [];

  // ── Parse Contacto ────────────────────────────────────────────────────────
  // Columns: id | Apellidos | Nombres | Telefono | ... | Curso
  const cursoMap = {}; // normName → { fullName, curso }
  if (contactRows.length >= 2) {
    const h = contactRows[0].map(c => (c || '').toLowerCase().trim());
    const apeIdx  = h.findIndex(c => c.includes('apellido'));
    const nomIdx  = h.findIndex(c => c === 'nombres' || (c.includes('nombre') && !c.includes('apellido')));
    const cursoIdx = h.findIndex(c => c.includes('curso') || c.includes('grado') || c.includes('paralelo'));

    for (let i = 1; i < contactRows.length; i++) {
      const row = contactRows[i];
      const ape  = (row[apeIdx]  || '').trim();
      const nom  = (row[nomIdx]  || '').trim();
      const curso = cursoIdx >= 0 ? (row[cursoIdx] || '').trim() : '';
      const full = [ape, nom].filter(Boolean).join(' ');
      if (full) cursoMap[normName(full)] = { fullName: full, curso };
    }
  }

  // ── Parse Anual ───────────────────────────────────────────────────────────
  // Rows 0-5: institutional headers. Row 6: column headers. Row 7: sub-header. Row 8+: data.
  // Find the header row dynamically (contains "ESTUDIANTE" or "NOTA FINAL")
  const noteMap = {}; // normName → nota
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(anualRows.length, 15); i++) {
    const cells = anualRows[i].map(c => (c || '').toUpperCase());
    if (cells.some(c => c.includes('ESTUDIANTE') || c.includes('NOTA FINAL'))) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx >= 0) {
    const h = anualRows[headerRowIdx].map(c => (c || '').toLowerCase().trim());
    // Name: look for "estudiante" → that's apellidos; the next column is nombres
    const apeIdx  = h.findIndex(c => c.includes('estudiante'));
    const nomIdx  = apeIdx >= 0 ? apeIdx + 1 : -1;
    const noteIdx = h.findIndex(c => c.includes('nota') && c.includes('final'));

    // Skip header row + sub-header row (if any)
    const dataStart = headerRowIdx + 2;

    for (let i = dataStart; i < anualRows.length; i++) {
      const row = anualRows[i];
      const ape  = (row[apeIdx]  || '').trim();
      const nom  = nomIdx >= 0 ? (row[nomIdx] || '').trim() : '';
      const full = [ape, nom].filter(Boolean).join(' ');
      const noteStr = (row[noteIdx] || '').trim().replace(',', '.');
      const note = parseFloat(noteStr);
      if (full && !isNaN(note)) noteMap[normName(full)] = note;
    }
  }

  console.log(`  contacto: ${Object.keys(cursoMap).length} alumnos | anual: ${Object.keys(noteMap).length} notas`);

  // ── Merge by normalized name ──────────────────────────────────────────────
  const result = {};
  for (const [norm, { fullName, curso }] of Object.entries(cursoMap)) {
    const nota = noteMap[norm];
    if (nota !== undefined) {
      result[fullName] = { promedio: Math.round(nota * 100) / 100, curso };
    }
  }
  return result;
}

// ── Form text builder ─────────────────────────────────────────────────────────

function buildFormText(contenidos, dificultades, acciones) {
  const lines = [];

  lines.push('1 - Contenidos trabajados en el 2do quimestre:');
  lines.push(contenidos);
  lines.push('');

  lines.push('2 - Apellidos y nombres del estudiante que presente dificultades académicas o faltas:');
  if (dificultades.length === 0) {
    lines.push('Ninguno');
  } else {
    dificultades.forEach(d => lines.push(`- ${d.nombre} (promedio: ${d.promedio}/10)`));
  }
  lines.push('');

  lines.push('3 - Actividades realizadas:');
  lines.push(dificultades.length === 0 ? 'No aplica' : acciones);

  return lines.join('\n');
}

// ── API: load and preview ─────────────────────────────────────────────────────

app.post('/api/load-data', async (req, res) => {
  try {
    const { arreglosUrl, ensambleUrl, guitarraUrl } = req.body;
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const [arreglos, ensamble, guitarra] = await Promise.all([
      readStudentSheet(sheets, extractSheetId(arreglosUrl)),
      readStudentSheet(sheets, extractSheetId(ensambleUrl)),
      readStudentSheet(sheets, extractSheetId(guitarraUrl)),
    ]);

    const subjects = [
      { name: 'Arreglos Musicales', data: arreglos },
      { name: 'Ensamble de Guitarras', data: ensamble },
      { name: 'Guitarra Clásica', data: guitarra },
    ];

    // Group by (subject, course)
    const groups = [];

    for (const subj of subjects) {
      const byCurso = {};
      for (const [nombre, d] of Object.entries(subj.data)) {
        const key = d.curso || 'Sin curso';
        if (!byCurso[key]) byCurso[key] = [];
        byCurso[key].push({ nombre, promedio: d.promedio });
      }

      for (const [curso, students] of Object.entries(byCurso)) {
        const dropdown = findDropdownOption(curso);
        const dificultades = students.filter(s => s.promedio < 7);
        groups.push({
          materia: subj.name,
          curso,
          dropdownOption: dropdown,
          students,
          dificultades,
        });
      }
    }

    const totals = {
      arreglos: Object.keys(arreglos).length,
      ensamble: Object.keys(ensamble).length,
      guitarra: Object.keys(guitarra).length,
    };
    console.log('Estudiantes encontrados:', totals);

    res.json({ success: true, groups, debug: totals });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

// ── Debug: show raw headers of Contacto and Anual tabs ───────────────────────

app.post('/api/debug-headers', async (req, res) => {
  try {
    const { sheetUrl } = req.body;
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const id = extractSheetId(sheetUrl);
    const allTabs = await getTabNames(sheets, id);
    const findTab = kw => allTabs.find(t =>
      t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(kw)
    ) || null;
    const contactTab = findTab('contacto');
    const anualTab   = findTab('anual');
    const cRows = contactTab ? await readTab(sheets, id, contactTab) : [];
    const aRows = anualTab   ? await readTab(sheets, id, anualTab)   : [];
    res.json({
      tabs: allTabs,
      contacto: { tab: contactTab, headers: cRows[0] || [], row1: cRows[1] || [] },
      anual:    { tab: anualTab,   headers: aRows[0] || [], row1: aRows[1] || [] },
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ── API: submit forms ─────────────────────────────────────────────────────────

app.post('/api/submit-forms', async (req, res) => {
  const { submissions } = req.body;
  // submissions: [{ dropdownOption, docente, materia, formText }]

  const results = [];

  for (const sub of submissions) {
    try {
      const params = new URLSearchParams();
      params.append('entry.1403373118', sub.dropdownOption);
      params.append('entry.697644543', sub.docente);
      params.append('entry.2132854786', sub.materia);
      params.append('entry.411694821', sub.formText);
      params.append('fvv', '1');
      params.append('draftResponse', '[]');
      params.append('pageHistory', '0');
      params.append('fbzx', Math.floor(Math.random() * 1e16).toString());

      await axios.post(FORM_URL, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        maxRedirects: 0,
        validateStatus: s => s < 400,
      });

      results.push({ label: `${sub.materia} – ${sub.dropdownOption}`, success: true });
    } catch (err) {
      results.push({
        label: `${sub.materia} – ${sub.dropdownOption}`,
        success: false,
        error: err.message,
      });
    }

    await new Promise(r => setTimeout(r, 800));
  }

  res.json({ results });
});

app.listen(8000, () => console.log('Servidor en http://localhost:8000'));
