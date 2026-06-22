// ── State ─────────────────────────────────────────────────────────────────────

let subjectCounter = 0;
const subjects = {}; // id → { name, sheetUrl, tabs, tabColumns, contactTab, gradeTab, cols }
let loadedGroups = [];

const INITIAL_SUBJECTS = ['Arreglos Musicales', 'Ensamble de Guitarras', 'Guitarra Clásica'];

// ── Auth ──────────────────────────────────────────────────────────────────────

async function checkAuth() {
  const { authenticated } = await fetch('/api/auth-status').then(r => r.json());
  document.getElementById('authNeeded').classList.toggle('hidden', authenticated);
  document.getElementById('authOk').classList.toggle('hidden', !authenticated);
  if (new URLSearchParams(location.search).get('auth') === 'ok') history.replaceState({}, '', '/');
}

// ── Subject cards ─────────────────────────────────────────────────────────────

function addSubject(name = '') {
  const id = ++subjectCounter;
  subjects[id] = { name, sheetUrl: '', tabs: [], tabColumns: {}, contactTab: '', gradeTab: '', cols: {} };

  const card = document.createElement('div');
  card.id = `card-${id}`;
  card.className = 'bg-white rounded-2xl shadow p-5 space-y-3';
  card.innerHTML = subjectCardHTML(id, name);
  document.getElementById('subjectCards').appendChild(card);
}

function subjectCardHTML(id, name) {
  return `
    <div class="flex items-center justify-between">
      <input value="${esc(name)}" placeholder="Nombre de la materia (ej: Guitarra Clásica)"
        oninput="subjects[${id}].name = this.value"
        class="font-semibold text-gray-700 bg-transparent border-b border-gray-200 focus:outline-none focus:border-blue-400 w-64" />
      <button onclick="removeSubject(${id})" class="text-gray-300 hover:text-red-400 text-lg leading-none">✕</button>
    </div>

    <!-- URL + explore -->
    <div class="flex gap-2">
      <input id="url-${id}" type="text" placeholder="URL de Google Sheets..."
        oninput="subjects[${id}].sheetUrl = this.value"
        class="flex-1 border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 text-xs" />
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
            <select id="col-ape-${id}" onchange="subjects[${id}].cols.ape = +this.value"
              class="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">—</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Nombres <span class="text-gray-300">(opcional)</span></label>
            <select id="col-nom-${id}" onchange="subjects[${id}].cols.nom = this.value === '' ? null : +this.value"
              class="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">— ninguna —</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Curso / Paralelo</label>
            <select id="col-curso-${id}" onchange="subjects[${id}].cols.curso = +this.value"
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
            <select id="col-gape-${id}" onchange="subjects[${id}].cols.gradeApe = +this.value"
              class="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">—</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Nombres <span class="text-gray-300">(opcional)</span></label>
            <select id="col-gnom-${id}" onchange="subjects[${id}].cols.gradeNom = this.value === '' ? null : +this.value"
              class="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">— ninguna —</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">Nota Final</label>
            <select id="col-nota-${id}" onchange="subjects[${id}].cols.nota = +this.value"
              class="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">—</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Contenidos de esta materia -->
      <div>
        <label class="block text-xs font-medium text-gray-500 mb-1">Contenidos trabajados en el 2do quimestre</label>
        <textarea rows="2" placeholder="Temas cubiertos en esta materia..."
          oninput="subjects[${id}].contenidos = this.value"
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
}

async function onGradeTabChange(id) {
  const tab = document.getElementById(`gtab-${id}`).value;
  subjects[id].gradeTab = tab;
  if (!tab) return;
  document.getElementById(`gcols-${id}`).classList.remove('hidden');
  await loadColumnsInto(id, tab, ['col-gape', 'col-gnom', 'col-nota'], 'grade');
}

// ── Load all subjects ─────────────────────────────────────────────────────────

async function loadAll() {
  document.getElementById('loadError').classList.add('hidden');
  const docente = document.getElementById('docente').value.trim();
  if (!docente) { showLoadError('Ingresa el nombre del docente.'); return; }

  const configs = Object.entries(subjects).map(([id, s]) => ({
    name: s.name || `Materia ${id}`,
    sheetUrl: s.sheetUrl,
    contactTab: s.contactTab,
    gradeTab: s.gradeTab,
    cols: s.cols,
  })).filter(c => c.sheetUrl && c.contactTab && c.gradeTab);

  if (!configs.length) { showLoadError('Configura al menos una materia completa.'); return; }

  document.getElementById('loadSpinner').classList.remove('hidden');
  document.getElementById('previewSection').classList.add('hidden');

  try {
    const res = await fetch('/api/load-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjects: configs }),
    }).then(r => r.json());

    if (!res.success) { showLoadError(res.error); return; }
    loadedGroups = res.groups;
    renderPreviews(res.groups);
  } catch (e) {
    showLoadError(e.message);
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
    document.getElementById(`ft-${idx}`).textContent = buildFormText(contenidos, g.dificultades, document.getElementById('acciones').value.trim());
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
  const docente  = document.getElementById('docente').value.trim();
  const acciones = document.getElementById('acciones').value.trim();
  if (!docente) { alert('Ingresa el nombre del docente.'); return; }

  const toSend = loadedGroups.filter(g => g.dropdownOption);
  if (!confirm(`Enviar ${toSend.length} formulario(s)?\n(${loadedGroups.length - toSend.length} sin coincidencia serán omitidos)`)) return;

  document.getElementById('sendSpinner').classList.remove('hidden');

  const submissions = toSend.map(g => {
    const subj = Object.values(subjects).find(s => s.name === g.materia);
    const contenidos = subj?.contenidos || '';
    return {
      dropdownOption: g.dropdownOption,
      docente,
      materia: g.materia,
      formText: buildFormText(contenidos, g.dificultades, acciones),
    };
  });

  try {
    const res = await fetch('/api/submit-forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissions }),
    }).then(r => r.json());
    renderResults(res.results, loadedGroups.length - toSend.length);
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
  el.textContent = msg; el.classList.remove('hidden');
}

function setStatus(id, msg) {
  const el = document.getElementById(`status-${id}`);
  if (el) el.textContent = msg;
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

checkAuth();
INITIAL_SUBJECTS.forEach(name => addSubject(name));
