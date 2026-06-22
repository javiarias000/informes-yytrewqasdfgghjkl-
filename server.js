require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// ── Configurable student sheet reader ────────────────────────────────────────
// cfg.cols: { ape, nom (optional), curso, gradeApe, gradeNom (optional), nota }
// All col values are column indices (numbers)

async function readStudentSheetConfigured(sheets, spreadsheetId, cfg) {
  const { contactTab, gradeTab, cols } = cfg;

  const contactRows = contactTab ? await readTab(sheets, spreadsheetId, contactTab) : [];
  const gradeRows   = gradeTab   ? await readTab(sheets, spreadsheetId, gradeTab)   : [];

  // ── Find data start row for grades (skip institutional headers) ────────────
  let gradeHeaderIdx = 0;
  for (let i = 0; i < Math.min(gradeRows.length, 15); i++) {
    if (gradeRows[i].filter(c => c && c.trim()).length > 2) {
      gradeHeaderIdx = i;
      break;
    }
  }

  // ── Parse contact tab → cursoMap ──────────────────────────────────────────
  const cursoMap = {}; // normName → { fullName, curso }
  const contactStart = contactRows.length > 1 ? 1 : 0; // skip header row
  for (let i = contactStart; i < contactRows.length; i++) {
    const row = contactRows[i];
    const ape  = (row[cols.ape]  || '').trim();
    const nom  = cols.nom != null ? (row[cols.nom] || '').trim() : '';
    const curso = (row[cols.curso] || '').trim();
    const full = [ape, nom].filter(Boolean).join(' ');
    if (full) cursoMap[normName(full)] = { fullName: full, curso };
  }

  // ── Parse grade tab → noteMap ─────────────────────────────────────────────
  const noteMap = {}; // normName → nota
  const gradeStart = gradeHeaderIdx + (gradeRows.length > gradeHeaderIdx + 1 ? 2 : 1);
  for (let i = gradeStart; i < gradeRows.length; i++) {
    const row = gradeRows[i];
    const ape  = (row[cols.gradeApe]  || '').trim();
    const nom  = cols.gradeNom != null ? (row[cols.gradeNom] || '').trim() : '';
    const full = [ape, nom].filter(Boolean).join(' ');
    const noteStr = (row[cols.nota] || '').trim().replace(',', '.');
    const note = parseFloat(noteStr);
    if (full && !isNaN(note)) noteMap[normName(full)] = note;
  }

  // ── Merge ─────────────────────────────────────────────────────────────────
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

// ── API: get tabs of a sheet ──────────────────────────────────────────────────

app.post('/api/get-tabs', async (req, res) => {
  try {
    const { sheetUrl } = req.body;
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const tabs = await getTabNames(sheets, extractSheetId(sheetUrl));
    res.json({ success: true, tabs });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── API: get column headers of a specific tab ─────────────────────────────────

app.post('/api/get-columns', async (req, res) => {
  try {
    const { sheetUrl, tab } = req.body;
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const rows = await readTab(sheets, extractSheetId(sheetUrl), tab);

    // For sheets with institutional headers (like Anual), find the real header row
    // (first row where more than 2 cells are non-empty)
    let headerRow = rows[0] || [];
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const nonEmpty = rows[i].filter(c => c && c.trim()).length;
      if (nonEmpty > 2) { headerRow = rows[i]; break; }
    }

    const columns = headerRow.map((label, idx) => ({
      idx,
      label: label ? label.trim() : `Columna ${idx + 1}`,
    })).filter(c => c.label);

    res.json({ success: true, columns });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── API: load and preview ─────────────────────────────────────────────────────
// Body: { subjects: [{ name, sheetUrl, contactTab, gradeTab, cols: { ape, nom, curso, nota } }] }

app.post('/api/load-data', async (req, res) => {
  try {
    const { subjects: subjectConfigs } = req.body;
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const groups = [];

    for (const cfg of subjectConfigs) {
      const id = extractSheetId(cfg.sheetUrl);
      const data = await readStudentSheetConfigured(sheets, id, cfg);
      const byCurso = {};
      for (const [nombre, d] of Object.entries(data)) {
        const key = d.curso || 'Sin curso';
        if (!byCurso[key]) byCurso[key] = [];
        byCurso[key].push({ nombre, promedio: d.promedio });
      }
      for (const [curso, students] of Object.entries(byCurso)) {
        groups.push({
          materia: cfg.name,
          curso,
          dropdownOption: findDropdownOption(curso),
          students,
          dificultades: students.filter(s => s.promedio < 7),
        });
      }
      console.log(`${cfg.name}: ${Object.keys(data).length} estudiantes`);
    }

    res.json({ success: true, groups });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

// ── API: analyze Google Form structure ───────────────────────────────────────

app.post('/api/analyze-form', async (req, res) => {
  try {
    const { formUrl } = req.body;

    // Normalize: allow forms.gle, viewform, formResponse — always fetch viewform
    let viewUrl = formUrl.trim().replace(/[?#].*$/, '');
    if (!viewUrl.includes('viewform') && !viewUrl.includes('formResponse')) {
      // short URL like forms.gle/xxx — fetch as-is, axios will follow redirect
    } else {
      viewUrl = viewUrl.replace('/formResponse', '/viewform');
    }

    const htmlRes = await axios.get(viewUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      timeout: 20000,
      maxRedirects: 10,
    });

    const html = htmlRes.data;

    // ── Extract raw JSON ──────────────────────────────────────────────────────
    const dataStart = html.indexOf('var FB_PUBLIC_LOAD_DATA_ = ');
    if (dataStart === -1) {
      console.error('[analyze-form] FB_PUBLIC_LOAD_DATA_ not found. HTML snippet:', html.slice(0, 500));
      throw new Error('No se encontró la estructura del formulario. Asegúrate de que el link sea público y accesible.');
    }

    const jsonStart = dataStart + 'var FB_PUBLIC_LOAD_DATA_ = '.length;
    const jsonEnd   = html.indexOf(';</script>', jsonStart);
    if (jsonEnd === -1) throw new Error('No se pudo delimitar el JSON del formulario');

    const rawJson = html.slice(jsonStart, jsonEnd);
    let data;
    try { data = JSON.parse(rawJson); }
    catch (e) { throw new Error('JSON del formulario malformado: ' + e.message); }

    // ── Strategy 1: regex over the raw string (catches most Google Forms) ──────
    // Pattern: [entryId, null, "label", (null|"desc"), typeNum
    const TYPES = { 0: 'short_text', 1: 'paragraph', 2: 'radio', 3: 'dropdown', 4: 'checkbox', 5: 'scale', 7: 'grid', 9: 'date', 10: 'time' };
    const seen = new Set();
    const rawFields = [];

    const re = /\[(\d{7,12}),null,"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(rawJson)) !== null) {
      const entryId = parseInt(m[1]);
      const label   = m[2].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim();
      if (seen.has(entryId) || !label) continue;
      seen.add(entryId);
      rawFields.push({ entryId, label, type: 'unknown', choices: [] });
    }

    // ── Strategy 2: recursive JSON scan (fills in type + choices) ─────────────
    function scan(node, depth) {
      if (!Array.isArray(node) || depth > 15) return;
      if (
        node.length >= 5 &&
        typeof node[0] === 'number' && String(Math.abs(node[0])).length >= 7 &&
        typeof node[2] === 'string' && node[2].trim().length > 0 &&
        typeof node[4] === 'number' && node[4] >= 0 && node[4] <= 15
      ) {
        const existing = rawFields.find(f => f.entryId === node[0]);
        const choices = Array.isArray(node[6])
          ? node[6].filter(c => Array.isArray(c) && c[0]).map(c => String(c[0])).slice(0, 8)
          : [];
        if (existing) {
          existing.type    = TYPES[node[4]] || existing.type;
          existing.choices = choices.length ? choices : existing.choices;
          return;
        }
        if (!seen.has(node[0])) {
          seen.add(node[0]);
          rawFields.push({ entryId: node[0], label: node[2].trim(), type: TYPES[node[4]] || 'other', choices });
        }
        return;
      }
      for (const child of node) scan(child, depth + 1);
    }
    scan(data, 0);

    console.log(`[analyze-form] found ${rawFields.length} fields:`, rawFields.map(f => `${f.entryId}="${f.label}"`));

    // ── Strategy 3: if still nothing, let GPT parse the raw JSON ──────────────
    let fieldsToMap = rawFields;
    if (rawFields.length === 0) {
      const parseCompletion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Eres experto en parsear FB_PUBLIC_LOAD_DATA_ de Google Forms. Extrae todos los campos (preguntas) con su entryId (número 7-12 dígitos), label y tipo. Responde JSON: {"fields":[{"entryId":number,"label":"...","type":"...","choices":[]}]}',
          },
          {
            role: 'user',
            content: 'Extrae los campos de este JSON de Google Forms:\n' + rawJson.slice(0, 30000),
          },
        ],
      });
      const parsed = JSON.parse(parseCompletion.choices[0].message.content);
      fieldsToMap = parsed.fields || [];
    }

    if (fieldsToMap.length === 0) throw new Error('No se encontraron campos en el formulario. Verifica que el link sea público.');

    // ── Ask GPT to suggest mappings ───────────────────────────────────────────
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Eres un experto en formularios escolares de música en Ecuador.
Asigna a cada campo el tipo de dato más apropiado.

Tipos disponibles:
- "auto_curso": Curso y tutor del estudiante (dropdown, auto-detectado de la hoja)
- "auto_materia": Nombre de la materia musical (del nombre configurado en la app)
- "text_docente": Nombre del docente (texto que escribe el usuario, uno para todos)
- "text_contenidos": Contenidos del quimestre (uno por materia, en cada tarjeta)
- "auto_dificultades": Lista de estudiantes con dificultades (generado automáticamente)
- "text_acciones": Acciones correctivas (texto que escribe el usuario, uno para todos)
- "informe_completo": Texto completo: contenidos + dificultades + acciones combinados
- "ignore": Campo que no aplica

Responde SOLO con JSON: {"fields":[{"entryId":number,"label":"...","mapping":"tipo","description":"qué se enviará, max 10 palabras"}]}`,
        },
        {
          role: 'user',
          content: `Campos del formulario:\n${JSON.stringify(fieldsToMap, null, 2)}`,
        },
      ],
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.json({ success: true, fields: result.fields });
  } catch (err) {
    console.error('[analyze-form]', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ── API: submit forms ─────────────────────────────────────────────────────────

app.post('/api/submit-forms', async (req, res) => {
  const { submissions, formUrl, formFields } = req.body;
  const targetUrl = (formUrl || FORM_URL).trim().replace('/viewform', '/formResponse');

  const results = [];

  for (const sub of submissions) {
    try {
      const params = new URLSearchParams();

      if (formFields && formFields.length > 0) {
        // Dynamic mode: use the detected form fields
        for (const field of formFields) {
          let value;
          switch (field.mapping) {
            case 'auto_curso':      value = sub.dropdownOption; break;
            case 'text_docente':    value = sub.docente; break;
            case 'auto_materia':    value = sub.materia; break;
            case 'text_contenidos': value = sub.contenidos || ''; break;
            case 'auto_dificultades':
              value = sub.dificultades && sub.dificultades.length
                ? sub.dificultades.map(d => `- ${d.nombre} (${d.promedio}/10)`).join('\n')
                : 'Ninguno';
              break;
            case 'text_acciones':
              value = sub.dificultades && sub.dificultades.length
                ? (sub.acciones || '')
                : 'No aplica';
              break;
            case 'informe_completo': value = sub.formText; break;
            case 'ignore': continue;
            default: value = ''; break;
          }
          if (value !== undefined && value !== null) {
            params.append(`entry.${field.entryId}`, value);
          }
        }
      } else {
        // Legacy fallback: hardcoded entries
        params.append('entry.1403373118', sub.dropdownOption);
        params.append('entry.697644543',  sub.docente);
        params.append('entry.2132854786', sub.materia);
        params.append('entry.411694821',  sub.formText);
      }

      params.append('fvv', '1');
      params.append('draftResponse', '[]');
      params.append('pageHistory', '0');
      params.append('fbzx', Math.floor(Math.random() * 1e16).toString());

      await axios.post(targetUrl, params.toString(), {
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

// ── API: analyze sheet structure with Claude ──────────────────────────────────

app.post('/api/analyze-sheet', async (req, res) => {
  try {
    const { sheetUrl } = req.body;
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const id = extractSheetId(sheetUrl);

    const tabs = await getTabNames(sheets, id);

    // Sample first 15 rows of each tab
    const tabSamples = {};
    for (const tab of tabs) {
      const rows = await readTab(sheets, id, tab);
      tabSamples[tab] = rows.slice(0, 15);
    }

    const sheetDescription = tabs.map(tab => {
      const rows = tabSamples[tab];
      const preview = rows.map((row, i) =>
        `  Fila ${i}: [${row.map(c => JSON.stringify(c || '')).join(', ')}]`
      ).join('\n');
      return `=== Hoja: "${tab}" (${rows.length} filas mostradas) ===\n${preview}`;
    }).join('\n\n');

    const prompt = `Analiza la estructura de esta hoja de cálculo de Google Sheets y determina:

1. Cuál hoja contiene los datos de contacto de estudiantes (apellidos, nombres, curso/grado/paralelo)
2. Cuál hoja contiene las calificaciones finales (nota final y apellidos de estudiantes)
3. Los índices de columna (empezando en 0) para cada dato relevante

Datos de la hoja de cálculo:

${sheetDescription}

Responde ÚNICAMENTE con un JSON válido en este formato exacto (sin texto adicional):
{
  "contactTab": "nombre exacto de la hoja de contactos",
  "gradeTab": "nombre exacto de la hoja de calificaciones",
  "cols": {
    "ape": <índice columna apellidos en contactos>,
    "nom": <índice columna nombres en contactos, o null si no hay>,
    "curso": <índice columna curso/paralelo en contactos>,
    "gradeApe": <índice columna apellidos en calificaciones>,
    "gradeNom": <índice columna nombres en calificaciones, o null si no hay>,
    "nota": <índice columna nota final en calificaciones>
  }
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente que analiza hojas de cálculo de Google Sheets. Responde únicamente con JSON válido.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[analyze-sheet]', err.message);
    res.json({ success: false, error: err.message });
  }
});

app.listen(8000, () => console.log('Servidor en http://localhost:8000'));
