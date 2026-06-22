// ── State ─────────────────────────────────────────────────────────────────────

let subjectCounter = 0;
const subjects = {}; // id → { name, sheetUrl, tabs, tabColumns, contactTab, gradeTab, cols }
let loadedGroups = [];
let formFields = []; // populated after analyzeForm()

const INITIAL_SUBJECTS = ['Arreglos Musicales', 'Ensamble de Guitarras', 'Guitarra Clásica'];

// ── Auth ──────────────────────────────────────────────────────────────────────

async function checkAuth() {
  const { authenticated } = await fetch('/api/auth-status').then(r => r.json());
  document.getElementById('authNeeded').classList.toggle('hidden', authenticated);
  document.getElementById('authOk').classList.toggle('hidden', !authenticated);
  if (new URLSearchParams(location.search).get('auth') === 'ok') history.replaceState({}, '', '/');
}

// ── Subject cards ─────────────────────────────────────────────────────────────

function addSubject(name = '', savedState = null) {
  const id = ++subjectCounter;
  const enabled = savedState ? savedState.enabled !== false : true;
  subjects[id] = {
    name,
    sheetUrl: savedState?.sheetUrl || '',
    tabs: [],
    tabColumns: {},
    contactTab: savedState?.contactTab || '',
    gradeTab: savedState?.gradeTab || '',
    cols: savedState?.cols || {},
    contenidos: savedState?.contenidos || '',
    enabled,
  };

  const card = document.createElement('div');
  card.id = `card-${id}`;
  card.className = `bg-white rounded-2xl shadow p-5 space-y-3 transition-opacity ${enabled ? '' : 'opacity-50'}`;
  card.innerHTML = subjectCardHTML(id, name, enabled);
  document.getElementById('subjectCards').appendChild(card);
  return id;
}

function updateCardStyle(id) {
  const card = document.getElementById(`card-${id}`);
  const enabled = subjects[id]?.enabled !== false;
  if (card) card.classList.toggle('opacity-50', !enabled);
  const label = document.getElementById(`chklabel-${id}`);
  if (label) {
    label.textContent = enabled ? 'Activa' : 'Inactiva';
    label.className = `text-xs font-medium ${enabled ? 'text-green-600' : 'text-gray-400'}`;
  }
}

function subjectCardHTML(id, name, enabled = true) {
  return `
    <div class="flex items-center justify-between">
      <input value="${esc(name)}" placeholder="Nombre de la materia (ej: Guitarra Clásica)"
        oninput="subjects[${id}].name = this.value; saveToStorage()"
        class="font-semibold text-gray-700 bg-transparent border-b border-gray-200 focus:outline-none focus:border-blue-400 flex-1 mr-3" />
      <div class="flex items-center gap-3 shrink-0">
        <label class="flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" id="chk-${id}" ${enabled ? 'checked' : ''}
            onchange="subjects[${id}].enabled = this.checked; saveToStorage(); updateCardStyle(${id})"
            class="w-4 h-4 accent-green-500 cursor-pointer" />
          <span id="chklabel-${id}" class="text-xs font-medium ${enabled ? 'text-green-600' : 'text-gray-400'}">
            ${enabled ? 'Activa' : 'Inactiva'}
          </span>
        </label>
        <button onclick="removeSubject(${id})" class="text-gray-300 hover:text-red-400 text-lg leading-none">✕</button>
      </div>
    </div>

    <!-- URL + explore -->
    <div class="flex gap-2">
      <input id="url-${id}" type="text" placeholder="URL de Google Sheets..."
        oninput="subjects[${id}].sheetUrl = this.value; saveToStorage()"
        class="flex-1 border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 text-xs" />
      <button onclick="autoDetect(${id})"
        class="bg-purple-100 hover:bg-purple-200 text-purple-700 font-semibold px-4 py-2 rounded-xl transition text-xs whitespace-nowrap">
        🤖 Auto-detectar
      </button>
      <button onclick="exploreTabs(${id})"
        class="bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold px-4 py-2 rounded-xl transition text-xs whitespace-nowrap">
        Explorar hojas
      </button>
    </div>
    <p id="err-${id}" class="text-red-500 text-xs hidden"></p>

    <!-- Tab + column selectors (shown after exploring) -->
    <div id="config-${id}" class="hidden space-y-3">

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Hoja de contactos (nombres + curso)</label>
          <select id="ctab-${id}" onchange="onContactTabChange(${id})"
            class="w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 text-xs">
            <option value="">— selecciona hoja —</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Hoja de calificaciones (nota final)</label>
          <select id="gtab-${id}" onchange="onGradeTabChange(${id})"
            class="w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 text-xs">
            <option value="">— selecciona hoja —</option>
          </select>
        </div>
      </div>

      <!-- Contact columns -->
      <div id="ccols-${id}" class="hidden bg-blue-50 rounded-xl p-3 space-y-2">
        <p class="text-xs font-semibold text-blue-700">Columnas de la hoja de contactos</p>
        <div class="grid grid-cols-3 gap-2">
          <div>
            <label class="block text-xs text-gray-500 mb-1">Apellidos</label>
            <select id="col-ape-${id}" onchange="subjects[${id}].cols.ape = +this.value; saveToStorage()"
              class="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">—</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Nombres <span class="text-gray-300">(opcional)</span></label>
            <select id="col-nom-${id}" onchange="subjects[${id}].cols.nom = this.value === '' ? null : +this.value; saveToStorage()"
              class="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">— ninguna —</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Curso / Paralelo</label>
            <select id="col-curso-${id}" onchange="subjects[${id}].cols.curso = +this.value; saveToStorage()"
              class="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">—</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Grade columns -->
      <div id="gcols-${id}" class="hidden bg-green-50 rounded-xl p-3 space-y-2">
        <p class="text-xs font-semibold text-green-700">Columnas de la hoja de calificaciones</p>
        <div class="grid grid-cols-3 gap-2">
          <div>
            <label class="block text-xs text-gray-500 mb-1">Apellidos</label>
            <select id="col-gape-${id}" onchange="subjects[${id}].cols.gradeApe = +this.value; saveToStorage()"
              class="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">—</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Nombres <span class="text-gray-300">(opcional)</span></label>
            <select id="col-gnom-${id}" onchange="subjects[${id}].cols.gradeNom = this.value === '' ? null : +this.value; saveToStorage()"
              class="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">— ninguna —</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Nota Final</label>
            <select id="col-nota-${id}" onchange="subjects[${id}].cols.nota = +this.value; saveToStorage()"
              class="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">—</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Contenidos de esta materia -->
      <div>
        <label class="block text-xs font-medium text-gray-500 mb-1">Contenidos trabajados en el 2do quimestre</label>
        <textarea id="contenidos-${id}" rows="2" placeholder="Temas cubiertos en esta materia..."
          oninput="subjects[${id}].contenidos = this.value; saveToStorage()"
          class="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"></textarea>
      </div>

      <!-- Status -->
      <div id="status-${id}" class="text-xs text-gray-400"></div>
    </div>
  `;
}

function removeSubject(id) {
  delete subjects[id];
  document.getElementById(`card-${id}`).remove();
  saveToStorage();
}

// ── Form analysis (AI) ───────────────────────────────────────────────────────

const MAPPING_INFO = {
  auto_curso:        { icon: '🔗', label: 'Auto: Curso y tutor del estudiante',      color: '#dbeafe', text: '#1d4ed8' },
  auto_materia:      { icon: '🎵', label: 'Auto: Nombre de la materia',              color: '#dbeafe', text: '#1d4ed8' },
  text_docente:      { icon: '👤', label: 'Nombre del docente (lo escribe el usuario)', color: '#ffedd5', text: '#c2410c' },
  text_contenidos:   { icon: '📝', label: 'Contenidos por materia (en cada tarjeta)', color: '#dcfce7', text: '#15803d' },
  auto_dificultades: { icon: '⚠️', label: 'Auto: Estudiantes con dificultades',      color: '#fef9c3', text: '#a16207' },
  text_acciones:     { icon: '🛠️', label: 'Acciones correctivas (lo escribe el usuario)', color: '#ffedd5', text: '#c2410c' },
  informe_completo:  { icon: '📄', label: 'Informe completo (contenidos + dificultades + acciones)', color: '#f3e8ff', text: '#7e22ce' },
  ignore:            { icon: '🚫', label: 'Se omite',                                color: '#f3f4f6', text: '#6b7280' },
};

async function analyzeForm() {
  const url = document.getElementById('formUrl').value.trim();
  if (!url) { document.getElementById('formAnalysisStatus').textContent = '⚠️ Ingresa la URL del formulario.'; return; }

  const statusEl = document.getElementById('formAnalysisStatus');
  const spinner  = document.getElementById('analyzeSpinner');
  spinner.classList.remove('hidden');
  statusEl.textContent = '⏳ Analizando campos del formulario...';
  document.getElementById('formFieldsSection').classList.add('hidden');

  try {
    const res = await fetch('/api/analyze-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formUrl: url }),
    }).then(r => r.json());

    if (!res.success) { statusEl.textContent = '❌ ' + res.error; return; }

    formFields = res.fields;
    renderFormFields(res.fields);
    statusEl.textContent = `✅ ${res.fields.length} campo(s) detectados en el formulario.`;
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
  } finally {
    spinner.classList.add('hidden');
  }
}

function renderFormFields(fields) {
  const section = document.getElementById('formFieldsSection');
  section.innerHTML = '';
  section.classList.remove('hidden');

  // Field list
  const box = document.createElement('div');
  box.className = 'bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2';
  box.innerHTML = '<p class="text-xs font-semibold text-gray-600 mb-2">Campos detectados en el formulario:</p>';

  fields.forEach(f => {
    const info = MAPPING_INFO[f.mapping] || { icon: '❓', label: f.mapping, color: '#f3f4f6', text: '#374151' };
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 text-xs';
    row.innerHTML = `
      <span class="font-medium text-gray-700 flex-1">${esc(f.label)}</span>
      <span style="background:${info.color};color:${info.text}" class="px-2 py-0.5 rounded-full font-medium text-xs shrink-0">${info.icon} ${info.label}</span>`;
    if (f.description) {
      row.title = f.description;
    }
    box.appendChild(row);
  });
  section.appendChild(box);

  // Render required global inputs
  const hasMappings = (types) => types.some(t => fields.some(f => f.mapping === t));

  if (hasMappings(['text_docente'])) {
    section.appendChild(makeField(
      'docente', 'text',
      '👤 Docente que llena el formulario',
      'Ej: Arias Pérez Jorge Eduardo'
    ));
  }
  if (hasMappings(['text_acciones', 'informe_completo'])) {
    section.appendChild(makeTextarea(
      'acciones',
      '🛠️ Acciones con estudiantes con dificultades',
      'Ej: Reunión con padres, clases de recuperación...'
    ));
  }
  if (hasMappings(['text_contenidos', 'informe_completo'])) {
    const note = document.createElement('p');
    note.className = 'text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2';
    note.textContent = '📝 Los contenidos se escriben en cada tarjeta de materia (ya incluidos abajo).';
    section.appendChild(note);
  }
}

function makeField(id, type, label, placeholder) {
  const div = document.createElement('div');
  div.innerHTML = `
    <label class="block text-xs font-medium text-gray-500 mb-1">${label}</label>
    <input id="${id}" type="${type}" placeholder="${placeholder}"
      class="w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm" />`;
  return div;
}

function makeTextarea(id, label, placeholder) {
  const div = document.createElement('div');
  div.innerHTML = `
    <label class="block text-xs font-medium text-gray-500 mb-1">${label}</label>
    <textarea id="${id}" rows="2" placeholder="${placeholder}"
      class="w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none text-sm"></textarea>`;
  return div;
}

// ── AI auto-detection ─────────────────────────────────────────────────────────

async function autoDetect(id) {
  const url = document.getElementById(`url-${id}`).value.trim();
  subjects[id].sheetUrl = url;
  const errEl = document.getElementById(`err-${id}`);
  errEl.classList.add('hidden');

  if (!url) { showSubjError(id, 'Ingresa la URL del Sheet.'); return; }

  setStatus(id, '🤖 Analizando estructura con IA...');
  try {
    const res = await fetch('/api/analyze-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetUrl: url }),
    }).then(r => r.json());

    if (!res.success) { showSubjError(id, 'Error IA: ' + res.error); return; }

    // Populate tab selectors first
    const tabsRes = await fetch('/api/get-tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetUrl: url }),
    }).then(r => r.json());

    if (!tabsRes.success) { showSubjError(id, tabsRes.error); return; }

    subjects[id].tabs = tabsRes.tabs;
    populateTabSelects(id, tabsRes.tabs);
    document.getElementById(`config-${id}`).classList.remove('hidden');

    // Set AI-detected tabs
    document.getElementById(`ctab-${id}`).value = res.contactTab || '';
    subjects[id].contactTab = res.contactTab || '';
    document.getElementById(`gtab-${id}`).value = res.gradeTab || '';
    subjects[id].gradeTab = res.gradeTab || '';

    // Load columns for both tabs in parallel
    if (res.contactTab) {
      await loadColumnsInto(id, res.contactTab, ['col-ape', 'col-nom', 'col-curso'], 'contact');
      document.getElementById(`ccols-${id}`).classList.remove('hidden');
    }
    if (res.gradeTab) {
      await loadColumnsInto(id, res.gradeTab, ['col-gape', 'col-gnom', 'col-nota'], 'grade');
      document.getElementById(`gcols-${id}`).classList.remove('hidden');
    }

    // Override auto-select with AI-detected indices
    const { cols } = res;
    if (cols) {
      if (cols.ape != null)      { document.getElementById(`col-ape-${id}`).value  = cols.ape;      subjects[id].cols.ape      = cols.ape; }
      if (cols.nom != null)      { document.getElementById(`col-nom-${id}`).value  = cols.nom;      subjects[id].cols.nom      = cols.nom; }
      if (cols.curso != null)    { document.getElementById(`col-curso-${id}`).value = cols.curso;   subjects[id].cols.curso    = cols.curso; }
      if (cols.gradeApe != null) { document.getElementById(`col-gape-${id}`).value = cols.gradeApe; subjects[id].cols.gradeApe = cols.gradeApe; }
      if (cols.gradeNom != null) { document.getElementById(`col-gnom-${id}`).value = cols.gradeNom; subjects[id].cols.gradeNom = cols.gradeNom; }
      if (cols.nota != null)     { document.getElementById(`col-nota-${id}`).value = cols.nota;     subjects[id].cols.nota     = cols.nota; }
    }

    setStatus(id, `✅ IA detectó: contactos="${res.contactTab}", calificaciones="${res.gradeTab}"`);
    saveToStorage();
  } catch (e) {
    showSubjError(id, e.message);
  }
}

// ── Tab exploration ───────────────────────────────────────────────────────────

async function exploreTabs(id) {
  const url = document.getElementById(`url-${id}`).value.trim();
  subjects[id].sheetUrl = url;
  const errEl = document.getElementById(`err-${id}`);
  errEl.classList.add('hidden');

  if (!url) { showSubjError(id, 'Ingresa la URL del Sheet.'); return; }

  setStatus(id, '⏳ Cargando hojas...');
  try {
    const res = await fetch('/api/get-tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetUrl: url }),
    }).then(r => r.json());

    if (!res.success) { showSubjError(id, res.error); return; }

    subjects[id].tabs = res.tabs;
    populateTabSelects(id, res.tabs);
    document.getElementById(`config-${id}`).classList.remove('hidden');
    setStatus(id, `✅ ${res.tabs.length} hojas encontradas.`);
  } catch (e) {
    showSubjError(id, e.message);
  }
}

function populateTabSelects(id, tabs) {
  ['ctab', 'gtab'].forEach(prefix => {
    const sel = document.getElementById(`${prefix}-${id}`);
    sel.innerHTML = '<option value="">— selecciona hoja —</option>';
    tabs.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    });
  });

  // Auto-select likely tabs
  const contactGuess = tabs.find(t => t.toLowerCase().includes('contacto'));
  const gradeGuess   = tabs.find(t => t.toLowerCase().includes('anual'));
  if (contactGuess) {
    document.getElementById(`ctab-${id}`).value = contactGuess;
    onContactTabChange(id);
  }
  if (gradeGuess) {
    document.getElementById(`gtab-${id}`).value = gradeGuess;
    onGradeTabChange(id);
  }
}

// ── Column loading ────────────────────────────────────────────────────────────

async function loadColumnsInto(id, tab, selectIds, storeKeys) {
  const res = await fetch('/api/get-columns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheetUrl: subjects[id].sheetUrl, tab }),
  }).then(r => r.json());

  if (!res.success) { showSubjError(id, res.error); return; }

  selectIds.forEach(selId => {
    const sel = document.getElementById(`${selId}-${id}`);
    const hasNone = sel.querySelector('option[value=""]');
    sel.innerHTML = '';
    if (hasNone) sel.innerHTML = `<option value="">${hasNone.textContent}</option>`;
    res.columns.forEach(col => {
      const opt = document.createElement('option');
      opt.value = col.idx;
      opt.textContent = `${col.idx + 1}. ${col.label}`;
      sel.appendChild(opt);
    });
  });

  // Auto-select common column names
  const autoSelect = (selId, keywords) => {
    const sel = document.getElementById(`${selId}-${id}`);
    const match = res.columns.find(c =>
      keywords.some(kw => c.label.toLowerCase().includes(kw))
    );
    if (match) sel.value = match.idx;
    return match ? match.idx : null;
  };

  if (storeKeys === 'contact') {
    const apeIdx  = autoSelect('col-ape',  ['apellido']);
    const nomIdx  = autoSelect('col-nom',  ['nombre']);
    const curIdx  = autoSelect('col-curso', ['curso', 'grado', 'paralelo']);
    subjects[id].cols.ape   = apeIdx;
    subjects[id].cols.nom   = nomIdx;
    subjects[id].cols.curso = curIdx;
  } else {
    const apeIdx  = autoSelect('col-gape', ['apellido', 'estudiante']);
    const nomIdx  = autoSelect('col-gnom', ['nombre']);
    const notaIdx = autoSelect('col-nota', ['nota final', 'nota_final', 'notafinal']);
    subjects[id].cols.gradeApe = apeIdx;
    subjects[id].cols.gradeNom = nomIdx;
    subjects[id].cols.nota     = notaIdx;
  }
}

async function onContactTabChange(id) {
  const tab = document.getElementById(`ctab-${id}`).value;
  subjects[id].contactTab = tab;
  if (!tab) return;
  document.getElementById(`ccols-${id}`).classList.remove('hidden');
  await loadColumnsInto(id, tab, ['col-ape', 'col-nom', 'col-curso'], 'contact');
  saveToStorage();
}

async function onGradeTabChange(id) {
  const tab = document.getElementById(`gtab-${id}`).value;
  subjects[id].gradeTab = tab;
  if (!tab) return;
  document.getElementById(`gcols-${id}`).classList.remove('hidden');
  await loadColumnsInto(id, tab, ['col-gape', 'col-gnom', 'col-nota'], 'grade');
  saveToStorage();
}

// ── Load all subjects ─────────────────────────────────────────────────────────

async function loadAll() {
  document.getElementById('loadError').classList.add('hidden');

  // Only process enabled subjects
  const enabledEntries = Object.entries(subjects).filter(([, s]) => s.enabled !== false);
  if (!enabledEntries.length) { showLoadError('Activa al menos una materia con el checkbox "Activa".'); return; }

  const incomplete = enabledEntries.filter(([, s]) => !s.sheetUrl || !s.contactTab || !s.gradeTab);
  const configs    = enabledEntries
    .filter(([, s]) => s.sheetUrl && s.contactTab && s.gradeTab)
    .map(([id, s]) => ({
      name: s.name || `Materia ${id}`,
      sheetUrl: s.sheetUrl,
      contactTab: s.contactTab,
      gradeTab: s.gradeTab,
      cols: s.cols,
    }));

  if (!configs.length) {
    const missing = incomplete.map(([, s]) => {
      const parts = [];
      if (!s.sheetUrl)    parts.push('URL de Sheet');
      if (!s.contactTab)  parts.push('hoja de contactos');
      if (!s.gradeTab)    parts.push('hoja de calificaciones');
      return `"${s.name || 'Sin nombre'}": falta ${parts.join(', ')}`;
    });
    showLoadError('Falta configurar:\n' + missing.join('\n'));
    return;
  }

  if (incomplete.length) {
    console.warn('[loadAll] Materias incompletas (se omiten):', incomplete.map(([, s]) => s.name));
  }

  document.getElementById('loadSpinner').classList.remove('hidden');
  document.getElementById('previewSection').classList.add('hidden');

  try {
    const res = await fetch('/api/load-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjects: configs }),
    }).then(r => r.json());

    if (!res.success) { showLoadError(res.error); return; }

    if (!res.groups || !res.groups.length) {
      showLoadError('No se encontraron estudiantes. Verifica las columnas seleccionadas.');
      return;
    }

    loadedGroups = res.groups;
    renderPreviews(res.groups);
  } catch (e) {
    showLoadError('Error de red: ' + e.message);
  } finally {
    document.getElementById('loadSpinner').classList.add('hidden');
  }
}

// ── Preview ───────────────────────────────────────────────────────────────────

function renderPreviews(groups) {
  const list = document.getElementById('previewList');
  list.innerHTML = '';
  let hasWarn = false;

  groups.forEach((g, idx) => {
    if (!g.dropdownOption) hasWarn = true;
    const card = document.createElement('div');
    card.className = `bg-white rounded-2xl shadow p-4 border-l-4 ${g.dropdownOption ? 'border-green-400' : 'border-yellow-400'}`;
    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <p class="font-semibold text-gray-800">${esc(g.materia)} — <span class="font-bold">${esc(g.curso)}</span></p>
          ${g.dropdownOption
            ? `<p class="text-green-700 text-xs mt-0.5">✅ ${esc(g.dropdownOption)}</p>`
            : `<p class="text-yellow-700 text-xs mt-0.5">⚠️ Curso sin coincidencia en el desplegable</p>`}
          <p class="text-gray-400 text-xs mt-0.5">${g.students.length} estudiante(s) · ${g.dificultades.length} con dificultades</p>
        </div>
        <button onclick="toggleDetail(${idx})" class="text-blue-500 text-xs hover:underline ml-4">Ver detalle</button>
      </div>
      <div id="detail-${idx}" class="hidden mt-3">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-1 mb-3">
          ${g.students.map(s => `
            <div class="flex items-center gap-2 text-xs px-3 py-1 rounded-lg ${s.promedio < 7 ? 'bg-red-50 text-red-800' : 'bg-gray-50 text-gray-700'}">
              <span>${s.promedio < 7 ? '⚠️' : '✅'}</span>
              <span class="flex-1">${esc(s.nombre)}</span>
              <span class="font-mono font-semibold">${s.promedio}</span>
            </div>`).join('')}
        </div>
        <pre class="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs whitespace-pre-wrap text-gray-600 leading-relaxed" id="ft-${idx}"></pre>
      </div>`;
    list.appendChild(card);
  });

  document.getElementById('previewSection').classList.remove('hidden');
  document.getElementById('resultsSection').classList.add('hidden');
}

function toggleDetail(idx) {
  const el = document.getElementById(`detail-${idx}`);
  el.classList.toggle('hidden');
  if (!el.classList.contains('hidden')) {
    const g = loadedGroups[idx];
    const subj = Object.values(subjects).find(s => s.name === g.materia);
    const contenidos = subj?.contenidos || '(sin contenidos)';
    document.getElementById(`ft-${idx}`).textContent = buildFormText(contenidos, g.dificultades, document.getElementById('acciones')?.value.trim() || '');
  }
}

function buildFormText(contenidos, dificultades, acciones) {
  return [
    '1 - Contenidos trabajados en el 2do quimestre:',
    contenidos,
    '',
    '2 - Apellidos y nombres del estudiante que presente dificultades académicas o faltas:',
    dificultades.length ? dificultades.map(d => `- ${d.nombre} (promedio: ${d.promedio}/10)`).join('\n') : 'Ninguno',
    '',
    '3 - Actividades realizadas:',
    dificultades.length ? (acciones || '(sin acciones)') : 'No aplica',
  ].join('\n');
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function submitForms() {
  const docente  = document.getElementById('docente')?.value.trim() || '';
  const acciones = document.getElementById('acciones')?.value.trim() || '';
  const formUrl  = document.getElementById('formUrl').value.trim();

  // Validate required fields based on form analysis
  const needsDocente = formFields.length === 0 || formFields.some(f => f.mapping === 'text_docente');
  if (needsDocente && !docente) { alert('Ingresa el nombre del docente.'); return; }

  if (!formUrl) { alert('Ingresa y analiza la URL del formulario primero.'); return; }

  const toSend = loadedGroups.filter(g => g.dropdownOption);
  const skipped = loadedGroups.length - toSend.length;
  if (!toSend.length) { alert('No hay cursos con coincidencia en el formulario para enviar.'); return; }
  if (!confirm(`Enviar ${toSend.length} formulario(s)?${skipped ? `\n(${skipped} omitido(s) sin coincidencia)` : ''}`)) return;

  document.getElementById('sendSpinner').classList.remove('hidden');

  const submissions = toSend.map(g => {
    const subj = Object.values(subjects).find(s => s.name === g.materia);
    const contenidos = subj?.contenidos || '';
    return {
      dropdownOption: g.dropdownOption,
      docente,
      materia: g.materia,
      contenidos,
      acciones,
      dificultades: g.dificultades,
      formText: buildFormText(contenidos, g.dificultades, acciones),
    };
  });

  try {
    const res = await fetch('/api/submit-forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissions, formUrl, formFields }),
    }).then(r => r.json());
    renderResults(res.results, skipped);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    document.getElementById('sendSpinner').classList.add('hidden');
  }
}

function renderResults(results, skipped) {
  const section = document.getElementById('resultsSection');
  const list = document.getElementById('resultsList');
  list.innerHTML = '';
  results.forEach(r => {
    const el = document.createElement('div');
    el.className = `flex items-center gap-2 px-3 py-2 rounded-xl text-xs ${r.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`;
    el.innerHTML = `<span>${r.success ? '✅' : '❌'}</span><span class="flex-1 font-medium">${esc(r.label)}</span>${r.error ? `<span class="opacity-60">${esc(r.error)}</span>` : ''}`;
    list.appendChild(el);
  });
  if (skipped) {
    const el = document.createElement('div');
    el.className = 'flex items-center gap-2 px-3 py-2 rounded-xl text-xs bg-yellow-50 text-yellow-800';
    el.innerHTML = `⚠️ ${skipped} curso(s) omitido(s) por no coincidir con el desplegable.`;
    list.appendChild(el);
  }
  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth' });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showSubjError(id, msg) {
  const el = document.getElementById(`err-${id}`);
  el.textContent = msg; el.classList.remove('hidden');
  setStatus(id, '');
}

function showLoadError(msg) {
  const el = document.getElementById('loadError');
  el.textContent = '⚠️ ' + msg;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showDebug(msg) {
  let el = document.getElementById('debugPanel');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'debugPanel';
    el.style.cssText = 'background:#1e1e2e;color:#cdd6f4;padding:12px;border-radius:10px;font-size:11px;white-space:pre-wrap;word-break:break-all;margin-top:8px;max-height:300px;overflow:auto';
    document.getElementById('loadError').insertAdjacentElement('afterend', el);
  }
  el.textContent = msg;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setStatus(id, msg) {
  const el = document.getElementById(`status-${id}`);
  if (el) el.textContent = msg;
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Persistencia localStorage ─────────────────────────────────────────────────

function saveToStorage() {
  try {
    const data = {};
    for (const [id, s] of Object.entries(subjects)) {
      data[id] = {
        name:       s.name,
        sheetUrl:   s.sheetUrl,
        contactTab: s.contactTab,
        gradeTab:   s.gradeTab,
        cols:       s.cols,
        contenidos: s.contenidos || '',
        enabled:    s.enabled !== false,
      };
    }
    localStorage.setItem('informes_subjects', JSON.stringify(data));
    localStorage.setItem('informes_counter',  String(subjectCounter));
    const fu = document.getElementById('formUrl')?.value;
    if (fu) localStorage.setItem('informes_formUrl', fu);
  } catch (e) { console.warn('save failed', e); }
}

async function loadFromStorage() {
  try {
    const saved = localStorage.getItem('informes_subjects');
    if (!saved) return false;
    const data = JSON.parse(saved);
    if (!Object.keys(data).length) return false;

    subjectCounter = parseInt(localStorage.getItem('informes_counter') || '0');

    for (const [id, s] of Object.entries(data)) {
      const numId = parseInt(id);
      const cardId = addSubject(s.name || '', s);

      // Restore URL input text
      const urlEl = document.getElementById(`url-${cardId}`);
      if (urlEl && s.sheetUrl) urlEl.value = s.sheetUrl;

      // Restore contenidos
      const contEl = document.getElementById(`contenidos-${cardId}`);
      if (contEl && s.contenidos) contEl.value = s.contenidos;

      // Restore tab config panel if tabs were selected
      if (s.contactTab || s.gradeTab) {
        document.getElementById(`config-${cardId}`).classList.remove('hidden');

        // Add saved tab as option so selector shows it
        for (const [prefix, tabVal] of [['ctab', s.contactTab], ['gtab', s.gradeTab]]) {
          if (!tabVal) continue;
          const sel = document.getElementById(`${prefix}-${cardId}`);
          if (!sel) continue;
          sel.innerHTML = `<option value="${esc(tabVal)}" selected>${esc(tabVal)}</option>`;
        }

        // Restore column sections
        if (s.contactTab && s.cols) {
          document.getElementById(`ccols-${cardId}`).classList.remove('hidden');
          restoreColSelect(`col-ape-${cardId}`,   s.cols.ape);
          restoreColSelect(`col-nom-${cardId}`,   s.cols.nom);
          restoreColSelect(`col-curso-${cardId}`, s.cols.curso);
        }
        if (s.gradeTab && s.cols) {
          document.getElementById(`gcols-${cardId}`).classList.remove('hidden');
          restoreColSelect(`col-gape-${cardId}`, s.cols.gradeApe);
          restoreColSelect(`col-gnom-${cardId}`, s.cols.gradeNom);
          restoreColSelect(`col-nota-${cardId}`, s.cols.nota);
        }

        setStatus(cardId, '📂 Configuración restaurada. Usa Auto-detectar para refrescar columnas.');
      }
    }

    // Restore formUrl
    const fu = localStorage.getItem('informes_formUrl');
    if (fu) {
      const fuEl = document.getElementById('formUrl');
      if (fuEl) fuEl.value = fu;
    }

    return true;
  } catch (e) {
    console.warn('restore failed', e);
    return false;
  }
}

function restoreColSelect(selId, val) {
  const sel = document.getElementById(selId);
  if (!sel || val == null) return;
  const label = sel.querySelector('option[value=""]')?.textContent || '—';
  sel.innerHTML = `<option value="">${label}</option><option value="${val}" selected>Col. ${parseInt(val) + 1} (guardado)</option>`;
}

// ── Init ──────────────────────────────────────────────────────────────────────

checkAuth();
loadFromStorage().then(restored => {
  if (!restored) INITIAL_SUBJECTS.forEach(name => addSubject(name));
});

// Save formUrl when user types it
document.getElementById('formUrl').addEventListener('input', saveToStorage);
