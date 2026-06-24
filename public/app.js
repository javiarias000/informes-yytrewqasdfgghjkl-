// ── Base URL (works behind code-server proxy /proxy/3001/ or direct) ──────────
const API = (() => {
  const p = location.pathname;
  return p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1);
})();

// ── State ──────────────────────────────────────────────────────────────────────
// savedSheets: [{ id, url, tabName, materia, contactTab, institution, contenidos }]
// enabledIds: Set<id>
// sheetData:  { id: { status, groups, contenidos } }
// tabTables:  { id: { status, columns, data } }
let savedSheets  = [];
let sheetData    = {};
let tabTables    = {};
let enabledIds   = new Set();
let expandedIds  = new Set(); // tabs with table visible
let loadedGroups = [];
let formFields   = [];

// ── Auth ───────────────────────────────────────────────────────────────────────
let _canWrite = false;

async function checkAuth() {
  const res = await fetch(API + 'api/auth-status').then(r => r.json());
  const { authenticated, canWrite } = res;
  _canWrite = !!canWrite;
  document.getElementById('authNeeded').classList.toggle('hidden', authenticated);
  document.getElementById('authOk').classList.toggle('hidden', !authenticated);
  if (new URLSearchParams(location.search).get('auth') === 'ok')
    history.replaceState({}, '', location.pathname);
  // Update ingreso reauth banner
  const banner = document.getElementById('ingresoReauthBanner');
  if (banner) banner.classList.toggle('hidden', !authenticated || canWrite);
}

// ── Sheet list UI ──────────────────────────────────────────────────────────────
function renderSheetList() {
  const list = document.getElementById('sheetList');
  list.innerHTML = '';

  if (!savedSheets.length) {
    list.innerHTML = '<div class="text-center py-6 text-gray-400 text-xs">No hay hojas guardadas. Agrega una con el botón de arriba.</div>';
    return;
  }

  // Group entries by URL so tabs from the same sheet appear together
  const byUrl = {};
  for (const sheet of savedSheets) {
    const key = sheet.url;
    if (!byUrl[key]) byUrl[key] = [];
    byUrl[key].push(sheet);
  }

  for (const [url, sheets] of Object.entries(byUrl)) {
    const first = sheets[0];

    // URL group header
    const header = document.createElement('div');
    header.className = 'px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between';
    header.innerHTML = `
      <div class="min-w-0 flex-1">
        <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">${esc(first.institution || 'Hoja de calificaciones')}</span>
        ${first.docenteNombre
          ? `<span class="ml-2 text-xs font-semibold text-indigo-700">👤 ${esc(first.docenteNombre)}</span>`
          : ''}
        ${first.materia
          ? `<span class="ml-2 text-xs text-gray-500">${esc(first.materia)}</span>`
          : ''}
      </div>
      <div class="flex gap-2 ml-2 shrink-0">
        ${(() => {
          const d = first.docenteNombre ? docentes.find(d => d.nombre === first.docenteNombre) : null;
          return d?.celular ? `<span class="text-xs text-green-600">📱 ${esc(d.celular)}</span>` : '';
        })()}
        <button onclick="deleteSheetGroup('${esc(url)}')"
          class="text-gray-300 hover:text-red-400 text-sm" title="Eliminar">✕</button>
      </div>`;
    list.appendChild(header);

    // One row per tab
    for (const sheet of sheets) {
      const data     = sheetData[sheet.id] || {};
      const checked  = enabledIds.has(sheet.id);
      const expanded = expandedIds.has(sheet.id);
      const loaded   = data.status === 'ok';

      const row = document.createElement('div');
      row.className = 'sheet-row flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 border-b border-gray-100';
      row.innerHTML = `
        <input type="checkbox" id="chk-${sheet.id}" ${checked ? 'checked' : ''}
          onchange="toggleSheet('${sheet.id}', this.checked)"
          class="w-4 h-4 accent-blue-600 cursor-pointer shrink-0" />
        <label for="chk-${sheet.id}" class="flex-1 cursor-pointer">
          <span class="font-bold text-base text-gray-900">${esc(sheet.tabName)}</span>
          ${sheet.materia ? `<span class="ml-2 text-xs text-gray-400">${esc(sheet.materia)}</span>` : ''}
        </label>
        ${statusBadge(data.status, data.groups)}
        ${loaded ? `
          <button onclick="toggleTabTable('${sheet.id}')"
            class="text-xs px-2 py-1 rounded-lg border transition shrink-0 ${expanded ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50'}">
            ${expanded ? '▲ Ocultar' : '▼ Ver tabla'}
          </button>` : ''}
        <button onclick="reloadTab('${sheet.id}')"
          class="text-gray-300 hover:text-blue-500 text-sm shrink-0" title="Recargar">↻</button>
      `;
      list.appendChild(row);

      // Expanded: table + contenidos
      if (expanded && loaded) {
        const expDiv = document.createElement('div');
        expDiv.className = 'border-b border-gray-100 bg-gray-50';

        // Table section
        const tableWrap = document.createElement('div');
        tableWrap.className = 'overflow-x-auto px-4 pt-3';
        tableWrap.id = `tbl-${sheet.id}`;
        const tt = tabTables[sheet.id];
        if (!tt || tt.status === 'idle') {
          tableWrap.innerHTML = '<p class="text-xs text-gray-400 py-2">Cargando tabla...</p>';
          loadTabTable(sheet.id); // fire off load
        } else if (tt.status === 'loading') {
          tableWrap.innerHTML = '<p class="text-xs text-blue-500 py-2 animate-pulse">⏳ Cargando tabla...</p>';
        } else if (tt.status === 'error') {
          tableWrap.innerHTML = `<p class="text-xs text-red-500 py-2">❌ ${esc(tt.error)}</p>`;
        } else {
          tableWrap.innerHTML = buildTableHTML(tt);
        }
        expDiv.appendChild(tableWrap);

        // Contenidos
        const contDiv = document.createElement('div');
        contDiv.className = 'px-4 pb-3 pt-2';
        contDiv.innerHTML = `
          <textarea id="cont-${sheet.id}" rows="2"
            placeholder="Contenidos trabajados (${esc(sheet.tabName)})..."
            oninput="updateContenidos('${sheet.id}', this.value)"
            class="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none bg-white"
          >${esc(data.contenidos || '')}</textarea>`;
        expDiv.appendChild(contDiv);
        list.appendChild(expDiv);
      } else if (checked && loaded && !expanded) {
        // Contenidos visible even when table is collapsed (if checked)
        const contDiv = document.createElement('div');
        contDiv.className = 'px-4 pb-3 bg-white border-b border-gray-100';
        contDiv.innerHTML = `
          <textarea id="cont-${sheet.id}" rows="2"
            placeholder="Contenidos trabajados (${esc(sheet.tabName)})..."
            oninput="updateContenidos('${sheet.id}', this.value)"
            class="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
          >${esc(data.contenidos || '')}</textarea>`;
        list.appendChild(contDiv);
      }
    }
  }
}

function updateContenidos(id, val) {
  if (sheetData[id]) sheetData[id].contenidos = val;
  save();
}

function statusBadge(status, groups) {
  if (!status || status === 'idle')
    return `<span class="text-xs text-gray-400 shrink-0">Sin cargar</span>`;
  if (status === 'loading')
    return `<span class="text-xs text-blue-500 shrink-0 animate-pulse">⏳ Cargando...</span>`;
  if (status === 'ok')
    return `<span class="text-xs text-green-600 font-medium shrink-0">✅ ${groups?.length || 0} cursos</span>`;
  if (status === 'unknown')
    return `<span class="text-xs text-yellow-600 shrink-0">⚠️ Sin coincidencia</span>`;
  return `<span class="text-xs text-red-500 shrink-0">❌ Error</span>`;
}

function shortUrl(url) {
  try {
    const m = (url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? `…${m[1].slice(0, 10)}…` : url;
  } catch(_) { return url || ''; }
}

// ── Add sheet form ─────────────────────────────────────────────────────────────
function openAddSheet() {
  document.getElementById('addSheetForm').classList.remove('hidden');
  document.getElementById('newSheetUrl').focus();
}
function closeAddSheet() {
  document.getElementById('addSheetForm').classList.add('hidden');
  document.getElementById('addSheetError').classList.add('hidden');
  document.getElementById('addSheetStatus').textContent = '';
  document.getElementById('newSheetMateria').value = '';
  document.getElementById('newSheetUrl').value  = '';
}

async function confirmAddSheet() {
  const rawUrl        = document.getElementById('newSheetUrl').value.trim();
  const materia       = document.getElementById('newSheetMateria').value.trim();
  const docenteNombre = document.getElementById('newSheetDocente')?.value.trim() || '';
  const url           = rawUrl.replace(/[?#].*$/, '').trim();
  const errEl   = document.getElementById('addSheetError');
  const statEl  = document.getElementById('addSheetStatus');

  if (!url) { errEl.textContent = 'Ingresa la URL.'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');

  // Check for duplicate
  if (savedSheets.some(s => s.url === url)) {
    errEl.textContent = 'Esta URL ya está en la lista.';
    errEl.classList.remove('hidden');
    return;
  }

  statEl.textContent = '⏳ Detectando hojas...';

  try {
    const res = await fetch(API + 'api/smart-load', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sheetUrl: url }),
    }).then(r => r.json());

    if (!res.success || !res.recognized) {
      errEl.textContent = '❌ ' + (res.error || 'Formato no reconocido');
      errEl.classList.remove('hidden');
      statEl.textContent = '';
      return;
    }

    // grade tabs = matchedTabs minus Contacto
    const gradeTabs = (res.gradeTabs || res.matchedTabs || [])
      .filter(t => !t.toLowerCase().includes('contacto'));

    if (!gradeTabs.length) {
      errEl.textContent = '⚠️ No se encontraron hojas de calificaciones en esta URL.';
      errEl.classList.remove('hidden');
      statEl.textContent = '';
      return;
    }

    // Create one entry per grade tab
    const groupId = 'sg_' + Date.now();
    for (const tab of gradeTabs) {
      const id = `${groupId}_${tab}`;
      savedSheets.push({
        id,
        url,
        groupId,
        tabName:        tab,
        materia:        materia || '',
        docenteNombre:  docenteNombre,
        contactTab:     res.contactTab || 'Contacto',
        institution:    res.format || '',
        contenidos:     '',
      });
      sheetData[id] = { status: 'idle', groups: [], contenidos: '' };
      enabledIds.add(id);
    }

    save();
    closeAddSheet();
    renderSheetList();

    // Auto-load the tabs that are enabled
    statEl.textContent = '';
    loadEnabledTabs(groupId);
  } catch (e) {
    errEl.textContent = '❌ ' + e.message;
    errEl.classList.remove('hidden');
    statEl.textContent = '';
  }
}

async function loadEnabledTabs(groupId) {
  const toLoad = savedSheets.filter(s => s.groupId === groupId && enabledIds.has(s.id));
  for (const sheet of toLoad) {
    await loadSheetData(sheet.id);
  }
}

// ── Load one tab's data ────────────────────────────────────────────────────────
async function loadSheetData(id) {
  const sheet = savedSheets.find(s => s.id === id);
  if (!sheet) return;

  sheetData[id] = { ...(sheetData[id] || {}), status: 'loading' };
  renderSheetList();

  try {
    const res = await fetch(API + 'api/smart-load', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        sheetUrl:    sheet.url,
        gradeTab:    sheet.tabName,
        subjectName: sheet.materia || sheet.tabName,
      }),
    }).then(r => r.json());

    if (res.success && res.recognized && res.groups?.length > 0) {
      sheetData[id] = {
        status:     'ok',
        groups:     res.groups,
        contenidos: sheetData[id]?.contenidos || '',
      };
    } else if (res.success && res.recognized) {
      sheetData[id] = {
        status:     'unknown',
        groups:     [],
        contenidos: sheetData[id]?.contenidos || '',
        warning:    res.warning,
      };
    } else {
      sheetData[id] = {
        status:     'error',
        groups:     [],
        contenidos: sheetData[id]?.contenidos || '',
        error:      res.error,
      };
    }
  } catch (e) {
    sheetData[id] = { status: 'error', groups: [], contenidos: sheetData[id]?.contenidos || '', error: e.message };
  }

  save();
  renderSheetList();
}

async function reloadTab(id) {
  sheetData[id] = { ...(sheetData[id] || {}), status: 'idle', groups: [] };
  delete tabTables[id];
  await loadSheetData(id);
}

function toggleTabTable(id) {
  if (expandedIds.has(id)) expandedIds.delete(id);
  else                     expandedIds.add(id);
  renderSheetList();
}

async function loadTabTable(id) {
  const sheet = savedSheets.find(s => s.id === id);
  if (!sheet) return;

  tabTables[id] = { status: 'loading' };
  // update only the table wrapper without full re-render
  const wrap = document.getElementById(`tbl-${id}`);
  if (wrap) wrap.innerHTML = '<p class="text-xs text-blue-500 py-2 animate-pulse">⏳ Cargando tabla...</p>';

  try {
    const res = await fetch(API + 'api/tab-table', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sheetUrl: sheet.url, tabName: sheet.tabName }),
    }).then(r => r.json());

    if (res.success) {
      tabTables[id] = { status: 'ok', columns: res.columns, data: res.data, label: res.label };
    } else {
      tabTables[id] = { status: 'error', error: res.error };
    }
  } catch (e) {
    tabTables[id] = { status: 'error', error: e.message };
  }

  const wrap2 = document.getElementById(`tbl-${id}`);
  if (wrap2) {
    const tt = tabTables[id];
    if (tt.status === 'ok') wrap2.innerHTML = buildTableHTML(tt);
    else wrap2.innerHTML = `<p class="text-xs text-red-500 py-2">❌ ${esc(tt.error)}</p>`;
  }
}

function buildTableHTML(tt) {
  const gradeCol = tt.columns[tt.columns.length - 1]; // last col = promedio/nota

  // Group rows by Curso for a cleaner display
  const byCurso = {};
  for (const row of tt.data) {
    const c = row['Curso'] || '—';
    if (!byCurso[c]) byCurso[c] = [];
    byCurso[c].push(row);
  }

  // Columns excluding Curso (shown as group header instead)
  const dataCols = tt.columns.filter(c => c !== 'Curso');

  let tbody = '';
  for (const [curso, students] of Object.entries(byCurso)) {
    // Curso group header row
    tbody += `<tr class="bg-indigo-50">
      <td colspan="${dataCols.length}" class="px-3 py-1.5 text-xs font-bold text-indigo-700 border border-gray-200">
        📚 ${esc(curso)} — ${students.length} estudiante${students.length !== 1 ? 's' : ''}
      </td>
    </tr>`;

    for (const row of students) {
      const grade = parseFloat(row[gradeCol]) || 0;
      const low   = grade > 0 && grade < 7;
      tbody += `<tr class="${low ? 'bg-red-50' : 'hover:bg-gray-50'}">
        ${dataCols.map(c => {
          const isGrade = c === gradeCol;
          const val     = row[c] || '';
          let cls = 'border border-gray-200 px-2 py-1 text-xs text-gray-700';
          if (isGrade) cls += low
            ? ' font-bold text-center text-red-700 bg-red-100'
            : ' font-bold text-center text-green-700 bg-green-50';
          return `<td class="${cls}">${esc(val)}</td>`;
        }).join('')}
      </tr>`;
    }
  }

  const headers = dataCols.map(c =>
    `<th class="border border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-600 whitespace-nowrap bg-gray-100">${esc(c)}</th>`
  ).join('');

  return `
    <p class="text-xs font-semibold text-gray-500 mb-1">${esc(tt.label || '')} — ${tt.data.length} estudiantes · ${Object.keys(byCurso).length} cursos</p>
    <div class="overflow-x-auto rounded-xl border border-gray-200 mb-2">
      <table class="w-full text-xs border-collapse">
        <thead><tr>${headers}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>`;
}

function toggleSheet(id, checked) {
  if (checked) enabledIds.add(id);
  else         enabledIds.delete(id);
  save();
  renderSheetList();
  // Auto-load if not yet loaded
  if (checked && (!sheetData[id] || sheetData[id].status === 'idle')) {
    loadSheetData(id);
  }
}

function deleteSheetGroup(url) {
  if (!confirm('¿Eliminar esta hoja y todos sus tabs?')) return;
  const toDelete = savedSheets.filter(s => s.url === url);
  for (const s of toDelete) {
    delete sheetData[s.id];
    enabledIds.delete(s.id);
  }
  savedSheets = savedSheets.filter(s => s.url !== url);
  save();
  renderSheetList();
}

// ── Load all & preview ─────────────────────────────────────────────────────────
async function loadAll() {
  document.getElementById('loadError').classList.add('hidden');
  document.getElementById('previewSection').classList.add('hidden');

  const active = savedSheets.filter(s => enabledIds.has(s.id));
  if (!active.length) { showLoadError('Selecciona al menos una hoja.'); return false; }

  // Load tabs that haven't been loaded yet
  const pending = active.filter(s => !sheetData[s.id] || sheetData[s.id].status === 'idle');
  for (const s of pending) await loadSheetData(s.id);

  document.getElementById('loadSpinner').classList.remove('hidden');
  try {
    const allGroups = [];
    for (const sheet of active) {
      const data = sheetData[sheet.id];
      if (!data || data.status !== 'ok') continue;
      const materia = sheet.materia || sheet.tabName;
      for (const g of data.groups) {
        allGroups.push({ ...g, materia, tabName: sheet.tabName, sheetId: sheet.id });
      }
    }

    if (!allGroups.length) {
      showLoadError('No se encontraron datos. Verifica que las hojas estén cargadas correctamente.');
      return false;
    }

    loadedGroups = allGroups;
    renderPreviews(allGroups);
    return true;
  } catch (e) {
    showLoadError('Error: ' + e.message);
    return false;
  } finally {
    document.getElementById('loadSpinner').classList.add('hidden');
  }
}

// ── Load + Send ────────────────────────────────────────────────────────────────
async function sendAll() {
  const ok = await loadAll();
  if (!ok) return;
  await submitForms();
}

// ── Form analysis ──────────────────────────────────────────────────────────────
const MAPPING_INFO = {
  auto_curso:        { icon: '🔗', label: 'Auto: Curso y tutor',                color: '#dbeafe', text: '#1d4ed8' },
  auto_materia:      { icon: '🎵', label: 'Auto: Nombre de la materia',         color: '#dbeafe', text: '#1d4ed8' },
  text_docente:      { icon: '👤', label: 'Nombre del docente',                 color: '#ffedd5', text: '#c2410c' },
  text_contenidos:   { icon: '📝', label: 'Contenidos por materia',             color: '#dcfce7', text: '#15803d' },
  auto_dificultades: { icon: '⚠️', label: 'Auto: Estudiantes con dificultades', color: '#fef9c3', text: '#a16207' },
  text_acciones:     { icon: '🛠️', label: 'Acciones correctivas',               color: '#ffedd5', text: '#c2410c' },
  informe_completo:  { icon: '📄', label: 'Informe completo',                   color: '#f3e8ff', text: '#7e22ce' },
  ignore:            { icon: '🚫', label: 'Se omite',                           color: '#f3f4f6', text: '#6b7280' },
};

async function analyzeForm() {
  const url = document.getElementById('formUrl').value.trim();
  if (!url) { document.getElementById('formAnalysisStatus').textContent = '⚠️ Ingresa la URL del formulario.'; return; }

  const statusEl = document.getElementById('formAnalysisStatus');
  const spinner  = document.getElementById('analyzeSpinner');
  spinner.classList.remove('hidden');
  statusEl.textContent = '⏳ Analizando...';
  document.getElementById('formFieldsSection').classList.add('hidden');

  try {
    const res = await fetch(API + 'api/analyze-form', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ formUrl: url }),
    }).then(r => r.json());

    if (!res.success) { statusEl.textContent = '❌ ' + res.error; return; }
    formFields = res.fields;
    renderFormFields(res.fields);
    statusEl.textContent = `✅ ${res.fields.length} campo(s) detectados.`;
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

  const box = document.createElement('div');
  box.className = 'bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2';
  box.innerHTML = '<p class="text-xs font-semibold text-gray-600 mb-2">Campos del formulario:</p>';
  fields.forEach(f => {
    const info = MAPPING_INFO[f.mapping] || { icon: '❓', label: f.mapping, color: '#f3f4f6', text: '#374151' };
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 text-xs';
    row.innerHTML = `
      <span class="font-medium text-gray-700 flex-1">${esc(f.label)}</span>
      <span style="background:${info.color};color:${info.text}" class="px-2 py-0.5 rounded-full font-medium text-xs shrink-0">${info.icon} ${info.label}</span>`;
    box.appendChild(row);
  });
  section.appendChild(box);

  const hasMappings = (...types) => types.some(t => fields.some(f => f.mapping === t));
  if (hasMappings('text_docente'))
    section.appendChild(makeField('docente', 'text', '👤 Docente', 'Ej: Arias Pérez Jorge Eduardo'));
  if (hasMappings('text_acciones', 'informe_completo'))
    section.appendChild(makeTextarea('acciones', '🛠️ Acciones con estudiantes con dificultades', 'Ej: Reunión con padres...'));
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

// ── Preview ────────────────────────────────────────────────────────────────────
function renderPreviews(groups) {
  const list = document.getElementById('previewList');
  list.innerHTML = '';

  groups.forEach((g, idx) => {
    const card = document.createElement('div');
    card.className = `bg-white rounded-2xl shadow p-4 border-l-4 ${g.dropdownOption ? 'border-green-400' : 'border-yellow-400'}`;
    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <p class="font-semibold text-gray-800">
            <span class="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded mr-2">${esc(g.tabName)}</span>
            ${g.materia ? `<span class="text-gray-500 text-xs mr-1">${esc(g.materia)} —</span>` : ''}
            <span class="font-bold">${esc(g.curso)}</span>
          </p>
          ${g.dropdownOption
            ? `<p class="text-green-700 text-xs mt-0.5">✅ ${esc(g.dropdownOption)}</p>`
            : `<p class="text-yellow-700 text-xs mt-0.5">⚠️ Sin coincidencia en el desplegable</p>`}
          <p class="text-gray-400 text-xs mt-0.5">${g.students.length} estudiante(s) · ${g.dificultades.length} con dificultades</p>
        </div>
        <button onclick="toggleDetail(${idx})" class="text-blue-500 text-xs hover:underline ml-4 shrink-0">Ver detalle</button>
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
  document.getElementById('waResultsList')?.classList.add('hidden');
  renderWaSendPanel();
}

// ── WhatsApp send panel (in Nuevo informe) ─────────────────────────────────────
let _waEntries = []; // built each time we render the panel

function buildWaEntries() {
  // One entry per unique docenteNombre across all loaded groups
  const map = {}; // docenteNombre (or __sheet_id) → entry

  for (const g of loadedGroups) {
    const sheet         = savedSheets.find(s => s.id === g.sheetId);
    const docenteNombre = sheet?.docenteNombre || '';
    const key           = docenteNombre || `__sheet_${g.sheetId}`;

    if (!map[key]) {
      const docRec = docenteNombre ? docentes.find(d => d.nombre === docenteNombre) : null;
      map[key] = {
        docenteNombre,
        docentePhone: docRec?.celular || '',
        groups: [],
        sheetId: g.sheetId, // for sheets with no docente assigned
      };
    }
    map[key].groups.push(g);
  }

  return Object.values(map);
}

function renderWaSendPanel() {
  const panel = document.getElementById('waSendPanel');
  if (!panel) return;

  _waEntries = buildWaEntries();
  if (!_waEntries.length) { panel.classList.add('hidden'); return; }

  panel.classList.remove('hidden');

  const notConnected = document.getElementById('waPanelNotConnected');
  const statusEl     = document.getElementById('waPanelStatus');
  notConnected.classList.toggle('hidden', waConnected);
  if (statusEl) {
    statusEl.textContent = waConnected ? '✅ WhatsApp conectado' : '';
    statusEl.className   = waConnected ? 'text-xs text-green-600 font-medium' : 'text-xs';
  }

  const list = document.getElementById('waSendList');
  list.innerHTML = _waEntries.map((e, i) => {
    const hasPhone = !!e.docentePhone;
    const canCheck = waConnected && hasPhone;
    const disabledAttr = canCheck ? '' : 'disabled';

    return `<div class="flex flex-wrap items-center gap-3 px-5 py-3">
      <input type="checkbox" id="wa-chk-${i}" ${canCheck ? 'checked' : ''} ${disabledAttr}
        class="w-4 h-4 accent-green-600 cursor-pointer shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          ${e.docenteNombre
            ? `<span class="font-semibold text-gray-800">👤 ${esc(e.docenteNombre)}</span>
               ${hasPhone
                 ? `<span class="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-200">📱 ${esc(e.docentePhone)}</span>`
                 : `<span class="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">Sin teléfono registrado</span>`
               }`
            : `<select onchange="updateWaPanelDocente(${i}, this.value)"
                 class="text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-300 bg-white">
                 <option value="">— Seleccionar docente —</option>
                 ${docentes.map(d => `<option value="${esc(d.nombre)}">${esc(d.nombre)} · ${esc(d.celular || '–')}</option>`).join('')}
               </select>`
          }
        </div>
        <div class="flex flex-wrap gap-1 mt-1.5">
          ${e.groups.map(g => `
            <span class="text-xs px-2 py-0.5 rounded-lg border ${g.dificultades.length ? 'bg-orange-50 border-orange-200 text-orange-800' : 'bg-indigo-50 border-indigo-200 text-indigo-700'}">
              ${g.tabName ? `<b>${esc(g.tabName)}</b> · ` : ''}${esc(g.curso)}
              · ${g.students.length} est.
              ${g.dificultades.length ? `· ⚠️ ${g.dificultades.length} dif.` : ''}
            </span>`).join('')}
        </div>
      </div>
    </div>`;
  }).join('');
}

function updateWaPanelDocente(idx, nombre) {
  const entry  = _waEntries[idx];
  const docRec = docentes.find(d => d.nombre === nombre);
  entry.docenteNombre = nombre;
  entry.docentePhone  = docRec?.celular || '';
  renderWaSendPanel(); // re-render to update checkbox state
}

function toggleAllWaChecks(checked) {
  _waEntries.forEach((e, i) => {
    const chk = document.getElementById(`wa-chk-${i}`);
    if (chk && !chk.disabled) chk.checked = checked;
  });
}

async function sendSelectedWA() {
  if (!waInstance) { alert('Conecta WhatsApp primero (sección WhatsApp).'); return; }

  const toSend = _waEntries.filter((e, i) => {
    const chk = document.getElementById(`wa-chk-${i}`);
    return chk?.checked && e.docentePhone;
  });

  if (!toSend.length) { alert('Selecciona al menos un docente con teléfono registrado.'); return; }

  document.getElementById('waSendSpinner').classList.remove('hidden');
  const results = [];

  for (const e of toSend) {
    const msg = buildWaMessage(e.groups, e.docenteNombre, e.groups[0]?.tabName || '');
    const res = await fetch(API + 'api/wa/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName: waInstance, phone: e.docentePhone, message: msg }),
    }).then(r => r.json());
    results.push({ label: e.docenteNombre, success: res.success, error: res.error });
    if (toSend.length > 1) await new Promise(r => setTimeout(r, 600));
  }

  document.getElementById('waSendSpinner').classList.add('hidden');

  const resContainer = document.getElementById('waResultsList');
  resContainer.classList.remove('hidden');
  resContainer.innerHTML = `
    <p class="text-xs font-semibold text-gray-600 mb-1">Resultado WhatsApp:</p>
    ${results.map(r => `
      <div class="flex items-center gap-2 text-xs py-1">
        <span>${r.success ? '✅' : '❌'}</span>
        <span class="font-medium">${esc(r.label)}</span>
        ${r.error ? `<span class="text-red-500 opacity-80">${esc(r.error)}</span>` : ''}
      </div>`).join('')}`;
}

function toggleDetail(idx) {
  const el = document.getElementById(`detail-${idx}`);
  el.classList.toggle('hidden');
  if (!el.classList.contains('hidden')) {
    const g = loadedGroups[idx];
    const contenidos = sheetData[g.sheetId]?.contenidos || '(sin contenidos)';
    document.getElementById(`ft-${idx}`).textContent =
      buildFormText(contenidos, g.dificultades, document.getElementById('acciones')?.value.trim() || '');
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

// ── Submit ─────────────────────────────────────────────────────────────────────
async function submitForms() {
  const docente  = document.getElementById('docente')?.value.trim()  || '';
  const acciones = document.getElementById('acciones')?.value.trim() || '';
  const formUrl  = document.getElementById('formUrl').value.trim();

  const needsDocente = formFields.length === 0 || formFields.some(f => f.mapping === 'text_docente');
  if (needsDocente && !docente) { alert('Ingresa el nombre del docente.'); return; }
  if (!formUrl) { alert('Ingresa y analiza la URL del formulario primero.'); return; }

  const toSend  = loadedGroups.filter(g => g.dropdownOption);
  const skipped = loadedGroups.length - toSend.length;
  if (!toSend.length) { alert('No hay cursos con coincidencia en el formulario.'); return; }
  if (!confirm(`Enviar ${toSend.length} formulario(s)?${skipped ? `\n(${skipped} omitido(s))` : ''}`)) return;

  document.getElementById('sendSpinner').classList.remove('hidden');

  const submissions = toSend.map(g => {
    const contenidos    = sheetData[g.sheetId]?.contenidos || '';
    const sheet         = savedSheets.find(s => s.id === g.sheetId);
    const docenteNombre = sheet?.docenteNombre || docente;
    const docenteRec    = docentes.find(d => d.nombre === docenteNombre);
    return {
      dropdownOption: g.dropdownOption,
      docente,
      materia:        g.materia,
      contenidos,
      acciones,
      dificultades:   g.dificultades,
      students:       g.students,
      formText:       buildFormText(contenidos, g.dificultades, acciones),
      tabName:        g.tabName    || sheet?.tabName || '',
      sheetId:        g.sheetId,
      docenteNombre,
      docentePhone:   docenteRec?.celular || '',
    };
  });

  try {
    const res = await fetch(API + 'api/submit-forms', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ submissions, formUrl, formFields }),
    }).then(r => r.json());
    renderResults(res.results, skipped);
    loadHistory(); // refresh historial after submit
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    document.getElementById('sendSpinner').classList.add('hidden');
  }
}

function renderResults(results, skipped) {
  const section = document.getElementById('resultsSection');
  const list    = document.getElementById('resultsList');
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

// ── Nuevo Informe – método selector ───────────────────────────────────────────
let nuevoMethod  = null;
let nuevoSheetId = null;
let nuevoGroups  = []; // groups loaded from selected sheet

function selectNuevoMethod(method) {
  nuevoMethod = method;

  const isWa   = method === 'wa';
  const isForm = method === 'form';

  // Highlight selected button
  const btnWa   = document.getElementById('btnMethodWa');
  const btnForm = document.getElementById('btnMethodForm');
  if (btnWa)   btnWa.className   = btnWa.className.replace(/border-\w+-\d+|bg-\w+-\d+/g, '') +
    (isWa   ? ' border-green-500 bg-green-50'   : ' border-gray-200');
  if (btnForm) btnForm.className = btnForm.className.replace(/border-\w+-\d+|bg-\w+-\d+/g, '') +
    (isForm ? ' border-indigo-500 bg-indigo-50' : ' border-gray-200');

  // Update send button label/color
  const btn   = document.getElementById('nuevoSendBtn');
  const label = document.getElementById('nuevoSendLabel');
  if (isWa) {
    if (btn)   btn.className = btn.className.replace(/bg-\w+-600|hover:bg-\w+-700/g, 'bg-green-600 hover:bg-green-700');
    if (label) label.textContent = '💬 Enviar por WhatsApp';
  } else {
    if (btn)   btn.className = btn.className.replace(/bg-\w+-600|hover:bg-\w+-700/g, 'bg-indigo-600 hover:bg-indigo-700');
    if (label) label.textContent = '📋 Enviar por Formulario';
  }

  // Show/hide Form URL field
  document.getElementById('nuevoFormUrlRow')?.classList.toggle('hidden', !isForm);

  // Show/hide WA warning if not connected
  if (isWa && !waConnected) {
    setNuevoInfo('⚠️ WhatsApp no conectado. Ve a la sección WhatsApp primero.');
  } else {
    setNuevoInfo('');
  }

  // Show the form section
  document.getElementById('nuevoFormSection').classList.remove('hidden');

  // Populate sheet selector
  populateNuevoSheetSelect();
}

function populateNuevoSheetSelect() {
  const sel = document.getElementById('nuevoSheetSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Selecciona una hoja —</option>';

  // Group by URL/institution for optgroups
  const byUrl = {};
  for (const s of savedSheets) {
    const key = s.institution || s.url;
    if (!byUrl[key]) byUrl[key] = [];
    byUrl[key].push(s);
  }

  for (const [label, sheets] of Object.entries(byUrl)) {
    const grp = document.createElement('optgroup');
    grp.label = label;
    for (const s of sheets) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = [s.tabName, s.materia, s.docenteNombre].filter(Boolean).join(' · ') || s.tabName || s.id;
      grp.appendChild(opt);
    }
    sel.appendChild(grp);
  }
}

async function onNuevoSheetChange(id) {
  nuevoSheetId = id;
  nuevoGroups  = [];
  document.getElementById('nuevoCursosSection').classList.add('hidden');
  document.getElementById('nuevoDocenteRow').classList.remove('hidden');

  if (!id) return;

  const sheet = savedSheets.find(s => s.id === id);

  // Pre-fill docente
  const nameEl  = document.getElementById('nuevoDocenteName');
  const phoneEl = document.getElementById('nuevoDocentePhone');
  if (nameEl && sheet?.docenteNombre) {
    nameEl.value = sheet.docenteNombre;
    onNuevoDocenteInput(sheet.docenteNombre);
  } else if (nameEl) {
    nameEl.value = '';
    if (phoneEl) { phoneEl.textContent = ''; phoneEl.classList.add('hidden'); }
  }

  // Load data
  document.getElementById('nuevoLoading').classList.remove('hidden');
  if (!sheetData[id] || sheetData[id].status !== 'ok') {
    await loadSheetData(id);
  }
  document.getElementById('nuevoLoading').classList.add('hidden');

  const data = sheetData[id];
  if (!data || data.status !== 'ok') {
    setNuevoInfo('❌ No se pudieron cargar los datos de esta hoja.');
    return;
  }

  nuevoGroups = data.groups || [];
  await renderNuevoCursos();
}

let _currentDocente = null; // docente record currently shown in card

function onNuevoDocenteInput(val) {
  const d = docentes.find(d => d.nombre.toLowerCase() === val.toLowerCase());
  renderDocenteCard(d || null);
}

// ── Docente Card (Read + Update) ───────────────────────────────────────────────
function renderDocenteCard(d) {
  _currentDocente = d;
  const card = document.getElementById('docenteCard');
  if (!card) return;

  if (!d) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  // Cancel any active edit
  document.getElementById('docenteCardView').classList.remove('hidden');
  document.getElementById('docenteCardEdit').classList.add('hidden');

  // Populate view
  const set = (id, val, prefix = '') => {
    const el = document.getElementById(id);
    if (!el) return;
    if (val) { el.textContent = prefix + val; el.classList.remove('hidden'); }
    else      { el.classList.add('hidden'); }
  };
  set('dc-nombre',     d.nombre);
  set('dc-cargo',      d.cargo);
  set('dc-phone',      d.celular,             '📱 ');
  set('dc-email-inst', d.correoInstitucional,  '📧 ');
  set('dc-email-pers', d.correoPersonal,        '📧 ');
}

function startEditDocente() {
  if (!_currentDocente) return;
  document.getElementById('docenteCardView').classList.add('hidden');
  document.getElementById('docenteCardEdit').classList.remove('hidden');
  document.getElementById('docenteEditStatus').classList.add('hidden');
  // Pre-fill edit fields
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('dc-edit-nombre',     _currentDocente.nombre);
  set('dc-edit-phone',      _currentDocente.celular || '');
  set('dc-edit-email-inst', _currentDocente.correoInstitucional || '');
  set('dc-edit-email-pers', _currentDocente.correoPersonal      || '');
}

function cancelEditDocente() {
  document.getElementById('docenteCardView').classList.remove('hidden');
  document.getElementById('docenteCardEdit').classList.add('hidden');
}

async function saveDocenteEdit() {
  const nombre    = document.getElementById('dc-edit-nombre')?.value.trim()     || _currentDocente?.nombre;
  const celular   = document.getElementById('dc-edit-phone')?.value.trim()      || '';
  const emailInst = document.getElementById('dc-edit-email-inst')?.value.trim() || '';
  const emailPers = document.getElementById('dc-edit-email-pers')?.value.trim() || '';

  const statusEl = document.getElementById('docenteEditStatus');

  const res = await fetch(API + 'api/docentes/upsert', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre,
      celular,
      correoInstitucional: emailInst,
      correoPersonal:      emailPers,
    }),
  }).then(r => r.json());

  if (!res.success) {
    if (statusEl) { statusEl.textContent = '❌ ' + (res.error || 'Error al guardar'); statusEl.classList.remove('hidden'); }
    return;
  }

  // Update local docentes list
  const idx = docentes.findIndex(d => d.nombre === (res.docente?.nombre || nombre));
  if (idx >= 0) docentes[idx] = res.docente;
  else           docentes.push(res.docente);

  // Update datalist
  const dl = document.getElementById('docentesList');
  if (dl) dl.innerHTML = docentes.map(d => `<option value="${esc(d.nombre)}" data-phone="${d.celular}">`).join('');

  // Update name input if name changed
  const nameInput = document.getElementById('nuevoDocenteName');
  if (nameInput) nameInput.value = res.docente.nombre;

  // Re-render card
  renderDocenteCard(res.docente);

  if (statusEl) { statusEl.textContent = '✅ Guardado'; statusEl.classList.remove('hidden'); }
}

function tutorBadgeHtml(docenteRec) {
  if (!docenteRec) return '<span class="text-xs text-gray-400 italic">Sin tutor asignado</span>';
  const parts = [`<span class="font-medium text-gray-700">👤 ${esc(docenteRec.nombre)}</span>`];
  if (docenteRec.cargo)               parts.push(`<span class="text-xs text-gray-400">${esc(docenteRec.cargo)}</span>`);
  if (docenteRec.celular)             parts.push(`<span class="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">📱 ${esc(docenteRec.celular)}</span>`);
  if (docenteRec.correoInstitucional) parts.push(`<span class="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full">📧 ${esc(docenteRec.correoInstitucional)}</span>`);
  if (docenteRec.correoPersonal && docenteRec.correoPersonal !== docenteRec.correoInstitucional)
    parts.push(`<span class="text-xs bg-gray-50 text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full">📧 ${esc(docenteRec.correoPersonal)}</span>`);
  return parts.join(' ');
}

function tutorEditFormHtml(idx, docenteRec) {
  const d = docenteRec || {};
  return `
    <div id="nc-tutor-edit-${idx}" class="hidden px-5 py-3 bg-indigo-50 border-t border-indigo-100 space-y-2">
      <p class="text-xs font-semibold text-indigo-700">✏️ Editar datos del tutor</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label class="text-xs text-gray-500">Nombre completo</label>
          <input id="nc-te-nombre-${idx}" type="text" value="${esc(d.nombre||'')}"
            class="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Celular</label>
          <input id="nc-te-phone-${idx}" type="text" value="${esc(d.celular||'')}" placeholder="0984865981"
            class="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Correo institucional</label>
          <input id="nc-te-einst-${idx}" type="email" value="${esc(d.correoInstitucional||'')}"
            class="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Correo personal</label>
          <input id="nc-te-epers-${idx}" type="email" value="${esc(d.correoPersonal||'')}"
            class="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
        </div>
      </div>
      <div class="flex gap-2 pt-1">
        <button onclick="saveCourseDocente(${idx})"
          class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2 rounded-lg transition">
          💾 Guardar
        </button>
        <button onclick="document.getElementById('nc-tutor-edit-${idx}').classList.add('hidden')"
          class="px-4 bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 text-xs font-semibold py-2 rounded-lg transition">
          Cancelar
        </button>
      </div>
      <p id="nc-te-status-${idx}" class="text-xs text-green-600 hidden"></p>
    </div>`;
}

// Cache of tutor→curso mapping from DB (loaded once per session)
let _tutoresCursosCache = null;

// Mirror of server.js parseCursoKey — normalizes raw sheet curso names to "grade_PARALELO"
// e.g. "1ro A" → "1_A", "1er Bach A" → "9_A", "2do Bachillerato B" → "10_B"
function parseCursoKey(raw) {
  const lo = (raw || '').toLowerCase().trim();
  // Bachillerato: "1er Bach A", "2do Bach B", "1ro Bachillerato A"
  const bachM = lo.match(/(\d+)[a-z]*\s*bach[a-z]*\s+([abc])/i);
  if (bachM) {
    const n = parseInt(bachM[1]);
    const grade = n === 1 ? 9 : n === 2 ? 10 : n === 3 ? 11 : null;
    return grade ? `${grade}_${bachM[2].toUpperCase()}` : null;
  }
  // Básica: "1ro A", "3er A", "10o A"
  const gm = lo.match(/(\d+)/);
  const pm = lo.match(/\b([abc])\s*$/i);
  if (gm && pm) return `${parseInt(gm[1])}_${pm[1].toUpperCase()}`;
  return null;
}

async function loadTutoresCursos() {
  if (_tutoresCursosCache) return _tutoresCursosCache;
  try {
    const r = await fetch(API + 'api/tutores-cursos').then(r => r.json());
    _tutoresCursosCache = r.tutoresCursos || [];
  } catch { _tutoresCursosCache = []; }
  return _tutoresCursosCache;
}

function invalidateTutoresCache() { _tutoresCursosCache = null; }

async function renderNuevoCursos() {
  const section = document.getElementById('nuevoCursosSection');
  const list    = document.getElementById('nuevoCursosList');
  if (!nuevoGroups.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  const totalEst = nuevoGroups.reduce((a, g) => a + g.students.length, 0);
  const totalDif = nuevoGroups.reduce((a, g) => a + g.dificultades.length, 0);
  setNuevoInfo(`${nuevoGroups.length} curso(s) · ${totalEst} estudiantes · ${totalDif} con dificultades`);

  const tutoresCursos = await loadTutoresCursos();

  list.innerHTML = nuevoGroups.map((g, i) => {
    // Match g.curso (raw sheet value like "1ro A", "1er Bach A") → DB entry
    // using normalized key "grade_PARALELO" (e.g. "1_A", "9_A")
    const cursoKey = parseCursoKey(g.curso);
    const tcEntry  = cursoKey
      ? tutoresCursos.find(tc => tc.curso_key === cursoKey)
      : tutoresCursos.find(tc => tc.curso === g.curso);  // exact fallback

    // 2nd fallback: sheet's docenteNombre
    const sheet = savedSheets.find(s => s.id === (g.sheetId || nuevoSheetId));

    let tutorRec = null;
    if (tcEntry) {
      tutorRec = {
        id:                  tcEntry.docente_id,
        nombre:              tcEntry.tutor,
        cargo:               tcEntry.cargo,
        celular:             tcEntry.celular,
        correoInstitucional: tcEntry.correo_institucional,
        correoPersonal:      tcEntry.correo_personal,
      };
    } else if (sheet?.docenteNombre) {
      tutorRec = docentes.find(d => d.nombre === sheet.docenteNombre) || { nombre: sheet.docenteNombre };
    }

    return `
    <div class="border-b border-gray-100 last:border-0">
      <!-- Row header -->
      <div class="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 transition">
        <input type="checkbox" id="nc-${i}" checked class="w-4 h-4 accent-indigo-600 shrink-0 cursor-pointer" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-gray-800">${esc(g.curso)}</span>
            <span class="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">${g.students.length} est.</span>
            ${g.dificultades.length
              ? `<span class="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full font-medium">⚠️ ${g.dificultades.length} dif.</span>`
              : `<span class="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">✅ Sin dif.</span>`}
          </div>
        </div>
        <button onclick="toggleNuevoCursoDetail(${i})"
          class="shrink-0 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-lg px-2 py-1 hover:bg-indigo-50 transition whitespace-nowrap">
          📋 Ver tabla
        </button>
      </div>

      <!-- Tutor strip -->
      <div class="px-5 pb-3 flex items-center gap-2 flex-wrap" id="nc-tutor-strip-${i}">
        ${tutorBadgeHtml(tutorRec)}
        <button onclick="toggleCourseTutorEdit(${i})"
          title="Editar datos del tutor"
          class="ml-1 text-xs text-gray-400 hover:text-indigo-600 border border-gray-200 hover:border-indigo-300 rounded-lg px-2 py-0.5 transition">
          ✏️ Editar
        </button>
      </div>

      <!-- Inline tutor edit form -->
      ${tutorEditFormHtml(i, tutorRec)}

      <!-- Tabla de estudiantes (expandible) -->
      <div id="nc-det-${i}" class="hidden border-t border-gray-100 bg-gray-50">
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="bg-gray-100 border-b border-gray-200">
                <th class="px-4 py-2 text-left font-semibold text-gray-500 w-8">#</th>
                <th class="px-4 py-2 text-left font-semibold text-gray-500">Apellidos y Nombres</th>
                <th class="px-4 py-2 text-center font-semibold text-gray-500 w-16">Nota</th>
                <th class="px-4 py-2 text-center font-semibold text-gray-500 w-24">Estado</th>
              </tr>
            </thead>
            <tbody>
              ${[...g.students]
                .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
                .map((s, n) => `
                <tr class="${n % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-b border-gray-100">
                  <td class="px-4 py-1.5 text-gray-400">${n + 1}</td>
                  <td class="px-4 py-1.5 font-medium ${s.promedio < 7 ? 'text-red-700' : 'text-gray-700'}">${esc(s.nombre)}</td>
                  <td class="px-4 py-1.5 text-center font-mono font-bold ${s.promedio < 7 ? 'text-red-600' : 'text-green-700'}">${s.promedio}</td>
                  <td class="px-4 py-1.5 text-center">${s.promedio < 7
                    ? '<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Dificultad</span>'
                    : '<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Aprobado</span>'}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr class="bg-gray-100 border-t border-gray-200 font-semibold text-gray-600">
                <td colspan="2" class="px-4 py-2">Total: ${g.students.length} estudiantes</td>
                <td class="px-4 py-2 text-center">${(g.students.reduce((a, s) => a + parseFloat(s.promedio || 0), 0) / (g.students.length || 1)).toFixed(1)}</td>
                <td class="px-4 py-2 text-center text-orange-600">${g.dificultades.length} con dificultad</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleCourseTutorEdit(i) {
  document.getElementById(`nc-tutor-edit-${i}`)?.classList.toggle('hidden');
}

async function saveCourseDocente(i) {
  const nombre = document.getElementById(`nc-te-nombre-${i}`)?.value.trim();
  const phone  = document.getElementById(`nc-te-phone-${i}`)?.value.trim();
  const eInst  = document.getElementById(`nc-te-einst-${i}`)?.value.trim();
  const ePers  = document.getElementById(`nc-te-epers-${i}`)?.value.trim();
  const status = document.getElementById(`nc-te-status-${i}`);

  if (!nombre) { if (status) { status.textContent = '⚠️ El nombre es requerido'; status.classList.remove('hidden'); } return; }

  const res = await fetch(API + 'api/docentes/upsert', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, celular: phone, correoInstitucional: eInst, correoPersonal: ePers }),
  }).then(r => r.json());

  if (!res.success) {
    if (status) { status.textContent = '❌ ' + (res.error || 'Error'); status.classList.remove('hidden'); }
    return;
  }

  // Update local docentes list
  const idx = docentes.findIndex(d => d.nombre === nombre);
  if (idx >= 0) docentes[idx] = res.docente;
  else           docentes.push(res.docente);

  // Invalidate tutores-cursos cache so next renderNuevoCursos sees fresh data
  invalidateTutoresCache();

  // Update the sheet's docenteNombre so the card also reflects the change
  const sheet = savedSheets.find(s => s.id === nuevoSheetId);
  if (sheet && !sheet.docenteNombre) {
    sheet.docenteNombre = nombre;
    save();
  }

  // Update the name input at the top if empty
  const nameInput = document.getElementById('nuevoDocenteName');
  if (nameInput && !nameInput.value) nameInput.value = nombre;

  // Update tutor badge in the strip without full re-render
  const strip = document.getElementById(`nc-tutor-strip-${i}`);
  if (strip) {
    const editBtn = strip.querySelector('button');
    strip.innerHTML = tutorBadgeHtml(res.docente);
    strip.appendChild(editBtn || Object.assign(document.createElement('button'), {
      onclick: () => toggleCourseTutorEdit(i),
      className: 'ml-1 text-xs text-gray-400 hover:text-indigo-600 border border-gray-200 hover:border-indigo-300 rounded-lg px-2 py-0.5 transition',
      textContent: '✏️ Editar',
    }));
  }

  // Hide edit form, show success
  if (status) { status.textContent = '✅ Guardado'; status.classList.remove('hidden'); }
  setTimeout(() => {
    document.getElementById(`nc-tutor-edit-${i}`)?.classList.add('hidden');
    renderDocenteCard(res.docente); // sync main docente card too
  }, 800);
}

function toggleNuevoCursoDetail(i) {
  document.getElementById(`nc-det-${i}`)?.classList.toggle('hidden');
}

function setNuevoInfo(msg) {
  const el = document.getElementById('nuevoSendInfo');
  if (el) el.textContent = msg;
}

async function submitNuevoInforme() {
  if (!nuevoMethod) { alert('Elige primero el método de envío.'); return; }
  if (!nuevoSheetId) { alert('Selecciona una hoja.'); return; }
  if (!nuevoGroups.length) { alert('No hay cursos cargados.'); return; }

  const contenidos = document.getElementById('nuevoContenidos')?.value.trim() || '';
  const acciones   = document.getElementById('nuevoAcciones')?.value.trim()   || '';
  const docenteVal = document.getElementById('nuevoDocenteName')?.value.trim() || '';

  // Which courses are checked?
  const selected = nuevoGroups.filter((_, i) => document.getElementById(`nc-${i}`)?.checked);
  if (!selected.length) { alert('Selecciona al menos un curso.'); return; }

  const spinner = document.getElementById('nuevoSendSpinner');
  const resBox  = document.getElementById('nuevoResultados');
  spinner.classList.remove('hidden');
  resBox.classList.add('hidden');

  let results = [];

  if (nuevoMethod === 'wa') {
    // ── WhatsApp ──────────────────────────────────────────────────────────────
    if (!waConnected) { spinner.classList.add('hidden'); alert('WhatsApp no conectado.'); return; }

    const docenteNombre = docenteVal;
    const docenteRec    = docentes.find(d => d.nombre === docenteNombre);
    const phone         = docenteRec?.celular
      || savedSheets.find(s => s.id === nuevoSheetId)?.docentePhone || '';

    if (!phone) {
      spinner.classList.add('hidden');
      alert('No se encontró el teléfono del docente. Asegúrate de seleccionarlo correctamente.');
      return;
    }

    const groups = selected.map(g => ({
      curso:        g.curso,
      students:     g.students,
      dificultades: g.dificultades,
    }));
    const msg = buildWaMessage(groups, docenteNombre, selected[0].tabName || '');
    const res = await fetch(API + 'api/wa/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName: waInstance, phone, message: msg }),
    }).then(r => r.json());

    results = [{ label: `${docenteNombre} – ${selected.length} curso(s)`, success: res.success, error: res.error }];

  } else {
    // ── Google Forms ──────────────────────────────────────────────────────────
    const formUrl = document.getElementById('formUrl')?.value.trim();
    if (!formUrl) { spinner.classList.add('hidden'); alert('Ingresa la URL del formulario.'); return; }

    const submissions = selected.map(g => ({
      dropdownOption: g.dropdownOption || g.curso,
      docente:        docenteVal,
      materia:        g.materia || savedSheets.find(s => s.id === nuevoSheetId)?.materia || '',
      contenidos,
      acciones,
      dificultades:   g.dificultades,
      students:       g.students,
      formText:       buildFormText(contenidos, g.dificultades, acciones),
      tabName:        g.tabName || '',
      sheetId:        nuevoSheetId,
      docenteNombre:  docenteVal,
      docentePhone:   docentes.find(d => d.nombre === docenteVal)?.celular || '',
    }));

    if (!confirm(`Enviar ${submissions.length} formulario(s)?`)) {
      spinner.classList.add('hidden'); return;
    }

    const res = await fetch(API + 'api/submit-forms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissions, formUrl, formFields }),
    }).then(r => r.json());

    results = res.results || [];
    loadHistory();
  }

  spinner.classList.add('hidden');
  resBox.classList.remove('hidden');
  resBox.innerHTML = results.map(r => `
    <div class="flex items-center gap-2 text-xs py-1">
      <span>${r.success ? '✅' : '❌'}</span>
      <span class="font-medium flex-1">${esc(r.label)}</span>
      ${r.error ? `<span class="text-red-500">${esc(r.error)}</span>` : ''}
    </div>`).join('');
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function showLoadError(msg) {
  const el = document.getElementById('loadError');
  el.textContent = '⚠️ ' + msg;
  el.classList.remove('hidden');
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Persistence ────────────────────────────────────────────────────────────────
function save() {
  try {
    localStorage.setItem('sheets_v3', JSON.stringify(savedSheets));
    localStorage.setItem('enabled_v3', JSON.stringify([...enabledIds]));
    // Persist contenidos only
    const meta = {};
    for (const [id, d] of Object.entries(sheetData)) {
      meta[id] = { contenidos: d.contenidos || '' };
    }
    localStorage.setItem('sheetmeta_v3', JSON.stringify(meta));
    const fu = document.getElementById('formUrl')?.value;
    if (fu) localStorage.setItem('formUrl_v3', fu);
  } catch(e) {}
}

async function loadFromStorage() {
  try {
    const raw = localStorage.getItem('sheets_v3');
    if (!raw) return;
    savedSheets = JSON.parse(raw);
    enabledIds  = new Set(JSON.parse(localStorage.getItem('enabled_v3') || '[]'));
    const meta  = JSON.parse(localStorage.getItem('sheetmeta_v3') || '{}');

    for (const sheet of savedSheets) {
      sheetData[sheet.id] = {
        status:     'idle',
        groups:     [],
        contenidos: meta[sheet.id]?.contenidos || '',
      };
    }

    const fu = localStorage.getItem('formUrl_v3');
    if (fu) { const el = document.getElementById('formUrl'); if (el) el.value = fu; }

    renderSheetList();
    populateNuevoSheetSelect();

    // Reload ALL sheets in background (not just enabled)
    for (const sheet of savedSheets) {
      loadSheetData(sheet.id); // fire and forget
    }
  } catch(e) {}
}

document.getElementById('formUrl').addEventListener('input', save);

// ── Navigation ─────────────────────────────────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  const nav  = document.getElementById('nav-' + name);
  if (view) view.classList.add('active');
  if (nav)  nav.classList.add('active');
  if (name === 'historial') loadHistory();
  if (name === 'padres')   initPadresView();
  if (name === 'ingreso')  initIngresoView();
}

// ── Historial de envíos ────────────────────────────────────────────────────────
let historialData = [];

async function loadHistory() {
  try {
    const res = await fetch(API + 'api/submissions').then(r => r.json());
    historialData = res.submissions || [];
    filterHistory();
  } catch(e) {}
}

function filterHistory() {
  const q      = (document.getElementById('historialSearch')?.value || '').toLowerCase();
  const filter = document.getElementById('historialFilter')?.value || 'all';

  let data = historialData.filter(s => {
    const text = [s.curso, s.materia, s.docenteNombre, s.docente, s.tabName].join(' ').toLowerCase();
    if (q && !text.includes(q)) return false;
    if (filter === 'wa-pending') return !s.waSentAt;
    if (filter === 'wa-sent')    return !!s.waSentAt;
    return true;
  });

  renderHistory(data);
}

function renderHistory(data) {
  if (!data) data = historialData;
  const list     = document.getElementById('historialList');
  const emptyEl  = document.getElementById('historialEmpty');

  // Stats (always from full data)
  const total      = historialData.length;
  const waSent     = historialData.filter(s => s.waSentAt).length;
  const waPending  = historialData.filter(s => !s.waSentAt).length;
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('statTotal',     total);
  setEl('statWaSent',    waSent);
  setEl('statWaPending', waPending);

  if (!list) return;

  if (!data.length) {
    list.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  // Group by date
  const byDate = {};
  for (const s of data) {
    const d = new Date(s.sentAt).toLocaleDateString('es-EC', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(s);
  }

  list.innerHTML = Object.entries(byDate).map(([date, items]) => `
    <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">${date}</div>
    ${items.map(s => historialRow(s)).join('')}
  `).join('');
}

function historialRow(s) {
  const date   = new Date(s.sentAt).toLocaleTimeString('es-EC', { hour:'2-digit', minute:'2-digit' });
  const waOk   = !!s.waSentAt;
  const waTime = waOk ? new Date(s.waSentAt).toLocaleTimeString('es-EC', { hour:'2-digit', minute:'2-digit' }) : null;
  const canWa  = waConnected && s.docentePhone && !waOk;
  const canForm = !!s.formUrl;
  const sentCount = s.formSentCount || 1;

  return `<div class="flex flex-wrap items-center gap-2 px-4 py-3 hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
    <div class="flex-1 min-w-0">
      <div class="flex flex-wrap items-center gap-1.5">
        ${s.tabName ? `<span class="text-xs font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">${esc(s.tabName)}</span>` : ''}
        <span class="text-sm font-semibold text-gray-800">${esc(s.curso)}</span>
        ${s.materia ? `<span class="text-xs text-gray-400">· ${esc(s.materia)}</span>` : ''}
      </div>
      <div class="flex flex-wrap items-center gap-3 mt-0.5">
        ${s.docenteNombre ? `<span class="text-xs text-gray-500">👤 ${esc(s.docenteNombre)}</span>` : ''}
        <span class="text-xs text-gray-400">${date}</span>
        ${s.dificultades?.length ? `<span class="text-xs text-orange-600">⚠️ ${s.dificultades.length} con dificultades</span>` : `<span class="text-xs text-green-600">✅ Sin dificultades</span>`}
        ${sentCount > 1 ? `<span class="text-xs text-blue-500">Form: ${sentCount}x</span>` : ''}
      </div>
    </div>
    <div class="flex items-center gap-2 shrink-0 flex-wrap">
      <span class="text-xs px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 font-medium">📋 Form ✅</span>
      ${waOk
        ? `<span class="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-700 font-medium">💬 WA ✅ ${waTime}</span>`
        : `<span class="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-400">💬 WA ⬜</span>`
      }
      <div class="flex gap-1">
        ${canWa ? `<button onclick="sendHistoryWA('${esc(s.id)}')"
          class="text-xs px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white font-semibold transition">
          💬 WA
        </button>` : ''}
        ${canForm ? `<button onclick="resendForm('${esc(s.id)}')"
          class="text-xs px-3 py-1.5 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-semibold transition">
          📋 Reenviar Form
        </button>` : ''}
        <button onclick="toggleHistorialDetail('${esc(s.id)}')"
          class="text-xs px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition">
          ···
        </button>
      </div>
    </div>
    <div id="hdet-${esc(s.id)}" class="hidden w-full mt-2 p-3 bg-gray-50 rounded-xl text-xs text-gray-600 space-y-1">
      <p><strong>Docente:</strong> ${esc(s.docenteNombre || s.docente || '–')}</p>
      ${s.docentePhone ? `<p><strong>Teléfono:</strong> ${esc(s.docentePhone)}</p>` : ''}
      <p><strong>Contenidos:</strong> ${esc(s.contenidos || '–')}</p>
      ${s.dificultades?.length ? `<p><strong>Dificultades:</strong> ${s.dificultades.map(d => esc(d.nombre) + ' (' + d.promedio + '/10)').join(', ')}</p>` : ''}
      ${s.waSentAt ? `<p><strong>WA enviado:</strong> ${new Date(s.waSentAt).toLocaleString('es-EC')}</p>` : ''}
      ${s.lastFormSentAt ? `<p><strong>Último reenvío Form:</strong> ${new Date(s.lastFormSentAt).toLocaleString('es-EC')}</p>` : ''}
    </div>
  </div>`;
}

function toggleHistorialDetail(id) {
  const el = document.getElementById('hdet-' + id);
  if (el) el.classList.toggle('hidden');
}

async function sendHistoryWA(submissionId) {
  const s = historialData.find(x => x.id === submissionId);
  if (!s) return;
  if (!waInstance) { alert('Conecta WhatsApp primero (sección WhatsApp).'); return; }

  const groups = [{ curso: s.curso, students: s.students || [], dificultades: s.dificultades || [] }];
  const msg = buildWaMessage(groups, s.docenteNombre || s.docente, s.tabName);

  const sendRes = await fetch(API + 'api/wa/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceName: waInstance, phone: s.docentePhone, message: msg }),
  }).then(r => r.json());

  if (!sendRes.success) { alert('Error al enviar WA: ' + (sendRes.error || 'desconocido')); return; }

  await fetch(API + `api/submissions/${submissionId}/mark-wa-sent`, { method: 'POST' });
  await loadHistory();
}

async function resendForm(submissionId) {
  if (!confirm('¿Reenviar este informe al formulario Google?')) return;
  const res = await fetch(API + `api/submissions/${submissionId}/resend-form`, { method: 'POST' }).then(r => r.json());
  if (!res.success) { alert('Error al reenviar: ' + (res.error || 'desconocido')); return; }
  alert('✅ Reenviado correctamente al formulario.');
  await loadHistory();
}

// ── WhatsApp / Evolution API ───────────────────────────────────────────────────
let waInstance  = localStorage.getItem('wa_instance') || '';
let docentes    = []; // loaded from server
let waConnected = false;
let waPollTimer = null;

async function initWa() {
  // Load docentes list
  try {
    const res = await fetch(API + 'api/docentes').then(r => r.json());
    docentes = res.docentes || [];
    const dl = document.getElementById('docentesList');
    dl.innerHTML = docentes.map(d => `<option value="${esc(d.nombre)}" data-phone="${d.celular}">`).join('');
  } catch(e) {}

  if (waInstance) await checkWaStatusSilent();
}

function openWaSetup() {
  document.getElementById('waSetupForm').classList.toggle('hidden');
  if (waInstance) document.getElementById('waInstanceName').value = waInstance;
}

async function connectWa() {
  const name = document.getElementById('waInstanceName').value.trim();
  const errEl = document.getElementById('waSetupError');
  if (!name) { errEl.textContent = 'Ingresa un nombre.'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');

  waInstance = name;
  localStorage.setItem('wa_instance', name);

  const res = await fetch(API + 'api/wa/instance', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceName: name }),
  }).then(r => r.json());

  document.getElementById('waSetupForm').classList.add('hidden');

  if (!res.success) {
    setWaStatus('error', res.error);
    return;
  }

  if (res.qr) {
    // Show QR
    document.getElementById('waQrImg').src = res.qr.startsWith('data:') ? res.qr : 'data:image/png;base64,' + res.qr;
    document.getElementById('waQrSection').classList.remove('hidden');
    document.getElementById('waConnected').classList.add('hidden');
    setWaStatus('qr', 'Escanea el QR');
    startWaPoll(name);
  } else {
    await pollWaStatus();
  }
}

function startWaPoll(name) {
  clearInterval(waPollTimer);
  let attempts = 0;
  waPollTimer = setInterval(async () => {
    attempts++;
    const connected = await checkWaStatusSilent();
    if (connected || attempts > 40) clearInterval(waPollTimer);
  }, 3000);
}

async function pollWaStatus() {
  await checkWaStatusSilent();
}

async function checkWaStatusSilent() {
  if (!waInstance) return false;
  try {
    const res = await fetch(API + 'api/wa/status/' + encodeURIComponent(waInstance)).then(r => r.json());
    const connected = res.state === 'open';
    if (connected) {
      clearInterval(waPollTimer);
      setWaStatus('connected', waInstance);
    } else if (res.state === 'connecting' || res.state === 'close') {
      if (!document.getElementById('waQrSection').classList.contains('hidden')) {
        // Still showing QR — keep polling
      } else {
        setWaStatus('disconnected', '');
      }
    }
    return connected;
  } catch(e) { return false; }
}

function setWaStatus(status, label) {
  const badge     = document.getElementById('waStatusBadge');
  const connected = document.getElementById('waConnected');
  const qr        = document.getElementById('waQrSection');
  const setupBtn  = document.getElementById('waBtnSetup');
  const instLabel = document.getElementById('waInstanceLabel');
  const waAllBtn  = document.getElementById('waSendAllBtn');
  const sideBar   = document.getElementById('waStatusSidebar');
  const navBadge  = document.getElementById('waNavBadge');

  waConnected = status === 'connected';
  waAllBtn?.classList.toggle('hidden', !waConnected);
  filterHistory();          // re-render historial WA buttons
  if (_waEntries.length) renderWaSendPanel(); // refresh panel checkbox states

  if (status === 'connected') {
    if (badge) { badge.textContent = '✅ Conectado'; badge.className = 'text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700'; }
    if (connected) { connected.classList.remove('hidden'); connected.classList.add('flex'); }
    if (qr)        qr.classList.add('hidden');
    if (instLabel) instLabel.textContent = 'Instancia: ' + label;
    if (setupBtn)  setupBtn.textContent = 'Reconectar';
    if (sideBar)   sideBar.textContent = 'WhatsApp: ✅ ' + label;
    if (navBadge)  navBadge.className = 'ml-auto w-2 h-2 rounded-full bg-green-400';
  } else if (status === 'qr') {
    if (badge) { badge.textContent = '⏳ Esperando escaneo'; badge.className = 'text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700'; }
    if (connected) connected.classList.add('hidden');
    if (setupBtn)  setupBtn.textContent = 'Configurar';
    if (sideBar)   sideBar.textContent = 'WhatsApp: ⏳ Escanea QR';
    if (navBadge)  navBadge.className = 'ml-auto w-2 h-2 rounded-full bg-yellow-400';
  } else if (status === 'error') {
    if (badge) { badge.textContent = '❌ Error'; badge.className = 'text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600'; }
    if (sideBar)  sideBar.textContent = 'WhatsApp: ❌';
    if (navBadge) navBadge.className = 'ml-auto w-2 h-2 rounded-full bg-red-400';
  } else {
    if (badge) { badge.textContent = 'No conectado'; badge.className = 'text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500'; }
    if (connected) connected.classList.add('hidden');
    if (setupBtn)  setupBtn.textContent = 'Configurar';
    if (sideBar)   sideBar.textContent = 'WhatsApp: no conectado';
    if (navBadge)  navBadge.className = 'ml-auto w-2 h-2 rounded-full bg-gray-400';
  }
}

function disconnectWa() {
  waInstance = '';
  localStorage.removeItem('wa_instance');
  clearInterval(waPollTimer);
  setWaStatus('disconnected', '');
  document.getElementById('waConnected').classList.add('hidden');
  document.getElementById('waQrSection').classList.add('hidden');
}

// ── Docente picker ─────────────────────────────────────────────────────────────
function onDocenteInput(val) {
  const d = docentes.find(d => d.nombre.toLowerCase() === val.toLowerCase());
  const phoneDiv = document.getElementById('docentePhone');
  const phoneVal = document.getElementById('docentePhoneVal');
  if (d?.celular) {
    phoneDiv.classList.remove('hidden');
    phoneVal.textContent = d.celular;
  } else {
    phoneDiv.classList.add('hidden');
  }
}

function getSelectedDocente() {
  const name = document.getElementById('newSheetDocente')?.value.trim() || '';
  return docentes.find(d => d.nombre.toLowerCase() === name.toLowerCase()) || null;
}

// ── WhatsApp sending ──────────────────────────────────────────────────────────
function buildWaMessage(sheetGroups, docenteName, tabName) {
  const periodo = tabName || 'Período';
  const lines = [
    `*📋 INFORME DE CALIFICACIONES — ${periodo}*`,
    `_Conservatorio Bolívar de Ambato_`,
    ``,
    `Estimado/a *${docenteName}*,`,
    `Su informe académico ha sido registrado. Resumen:`,
    ``,
  ];

  for (const g of sheetGroups) {
    lines.push(`📚 *${g.curso}* — ${g.students.length} estudiante${g.students.length !== 1 ? 's' : ''}`);
    if (g.dificultades.length) {
      lines.push(`   ⚠️ Con dificultades:`);
      g.dificultades.forEach(d => lines.push(`   • ${d.nombre} (${d.promedio}/10)`));
    } else {
      lines.push(`   ✅ Sin dificultades`);
    }
    lines.push('');
  }
  lines.push(`✅ _Formulario institucional enviado correctamente._`);
  return lines.join('\n');
}

async function sendWhatsAppAll() {
  if (!waConnected) { alert('Conecta WhatsApp primero.'); return; }
  if (!loadedGroups.length) { alert('Carga los datos primero.'); return; }

  // Group loadedGroups by sheetId → find docente per sheet
  const bySheet = {};
  for (const g of loadedGroups) {
    if (!bySheet[g.sheetId]) bySheet[g.sheetId] = [];
    bySheet[g.sheetId].push(g);
  }

  const results = [];
  for (const [sheetId, groups] of Object.entries(bySheet)) {
    const sheet   = savedSheets.find(s => s.id === sheetId);
    const docente = sheet?.docenteNombre ? docentes.find(d => d.nombre === sheet.docenteNombre) : null;

    if (!docente?.celular) {
      results.push({ label: sheet?.tabName || sheetId, success: false, error: 'Sin número de docente' });
      continue;
    }

    const msg = buildWaMessage(groups, docente.nombre, sheet.tabName);
    const res = await fetch(API + 'api/wa/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceName: waInstance, phone: docente.celular, message: msg }),
    }).then(r => r.json());

    results.push({
      label:   `${docente.nombre} (${sheet?.tabName})`,
      success: res.success,
      error:   res.error,
    });
    await new Promise(r => setTimeout(r, 500));
  }

  renderResults(results, 0);
}

// ══════════════════════════════════════════════════════════════════════════════
// INFORMES A REPRESENTANTES (PADRES)
// ══════════════════════════════════════════════════════════════════════════════

let _padresData     = null; // { label, tabName, students, total, conTelefono }
let _padresSheetId  = null;
let _padresMateria  = '';
let _padresDocente  = '';

const ETAPA_LABEL = {
  '1P': 'Primer Parcial', '2P': 'Segundo Parcial',
  '3P': 'Tercer Parcial', '4P': 'Cuarto Parcial',
  '1Q': 'Primer Quimestre', '2Q': 'Segundo Quimestre',
  'Anual': 'Anual',
  'A1': 'Asistencias 1er Parcial', 'A2': 'Asistencias 2do Parcial',
  'A3': 'Asistencias 3er Parcial', 'A4': 'Asistencias 4to Parcial',
};

// ── Padres Wizard ─────────────────────────────────────────────────────────────
let _padresWizardStep = 0;
let _padresWizardType = null; // 'calificaciones' | 'asistencias'

function _padresShowStep(n) {
  [0,1,2,3].forEach(i => {
    const el = document.getElementById('padres-p' + i);
    if (el) el.classList.toggle('hidden', i !== n);
  });
  const nav = document.getElementById('padres-nav');
  if (nav) nav.classList.toggle('hidden', n === 0);
  _padresWizardStep = n;
}

function initPadresView() {
  _padresWizardStep = 0;
  _padresWizardType = null;
  _padresSheetId    = null;
  _padresData       = null;
  _padresShowStep(0);
}

function padresSelectTipo(tipo) {
  _padresWizardType = tipo;
  document.getElementById('padres-c0').textContent = tipo === 'calificaciones' ? '📊 Calificaciones' : '📅 Asistencias';
  ['padres-c1','padres-c1-arr','padres-c2'].forEach(id => document.getElementById(id)?.classList.add('hidden'));

  const container = document.getElementById('padres-hojas-cards');
  if (!savedSheets.length) {
    container.innerHTML = '<p class="text-sm text-gray-400 col-span-3">No hay hojas guardadas. Agrega una en la sección "Hojas".</p>';
  } else {
    container.innerHTML = savedSheets.map(s => `
      <button onclick="padresSelectHoja('${s.id}')"
        class="flex flex-col gap-2 p-4 bg-white rounded-2xl shadow border-2 border-transparent hover:border-indigo-400 hover:shadow-md transition text-left">
        <span class="text-2xl">📄</span>
        <span class="font-semibold text-gray-800 text-sm leading-tight">${s.materia || 'Sin materia'}</span>
        <span class="text-xs text-gray-400">${s.docenteNombre || s.institution || '—'}</span>
      </button>`).join('');
  }
  _padresShowStep(1);
}

function padresSelectHoja(id) {
  _padresSheetId = id;
  const sheet = savedSheets.find(s => s.id === id);
  _padresMateria = sheet?.materia || '';
  _padresDocente = sheet?.docenteNombre || '';

  const c1 = document.getElementById('padres-c1');
  c1.textContent = sheet?.materia || id;
  c1.classList.remove('hidden');
  document.getElementById('padres-c1-arr')?.classList.remove('hidden');
  document.getElementById('padres-c2')?.classList.add('hidden');

  const isAtt = _padresWizardType === 'asistencias';
  const periods = isAtt
    ? [['A1','Asist.\n1er Parcial','📋'],['A2','Asist.\n2do Parcial','📋'],['A3','Asist.\n3er Parcial','📋'],['A4','Asist.\n4to Parcial','📋']]
    : [['1P','1er Parcial','1️⃣'],['2P','2do Parcial','2️⃣'],['3P','3er Parcial','3️⃣'],['4P','4to Parcial','4️⃣'],['1Q','1er\nQuimestre','Q1'],['2Q','2do\nQuimestre','Q2'],['Anual','Anual','🏆']];

  document.getElementById('padres-etapa-cards').innerHTML = periods.map(([tab, label, icon]) => `
    <button onclick="padresSelectEtapa('${tab}')"
      class="flex flex-col items-center gap-2 p-4 bg-white rounded-2xl shadow border-2 border-transparent hover:border-indigo-400 hover:shadow-md transition text-center">
      <span class="text-2xl">${icon}</span>
      <span class="font-semibold text-gray-800 text-sm whitespace-pre-line leading-tight">${label}</span>
    </button>`).join('');
  _padresShowStep(2);
}

async function padresSelectEtapa(tab) {
  const hiddenTab = document.getElementById('padresTabSelect');
  if (hiddenTab) hiddenTab.value = tab;
  const c2 = document.getElementById('padres-c2');
  c2.textContent = ETAPA_LABEL[tab] || tab;
  c2.classList.remove('hidden');
  _padresShowStep(3);
  await loadParentGrades();
}

function padresBack() {
  if (_padresWizardStep === 1) { initPadresView(); return; }
  if (_padresWizardStep === 2) { padresSelectTipo(_padresWizardType); return; }
  if (_padresWizardStep === 3) { padresSelectHoja(_padresSheetId); return; }
}

function onPadresSheetChange(id) { /* legacy — wizard sets _padresSheetId directly */ }

async function loadParentGrades() {
  if (!_padresSheetId) { alert('Selecciona una hoja primero.'); return; }
  const tabName = document.getElementById('padresTabSelect')?.value;
  if (!tabName) { alert('Selecciona una etapa.'); return; }

  const btn = document.querySelector('#view-padres button[onclick="loadParentGrades()"]');
  if (btn) { btn.textContent = '⏳ Cargando…'; btn.disabled = true; }

  try {
    const res = await fetch(API + 'api/parent-grades', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetId: _padresSheetId, tabName }),
    }).then(r => r.json());

    if (!res.success) { alert('Error: ' + res.error); return; }
    _padresData = res;
    renderParentStudentList(res);
  } finally {
    if (btn) { btn.textContent = '📥 Cargar estudiantes'; btn.disabled = false; }
  }
}

function renderParentStudentList(data) {
  const section = document.getElementById('padresResultSection');
  const empty   = document.getElementById('padresEmpty');
  const tbody   = document.getElementById('padresStudentList');
  const stat    = document.getElementById('padresStat');

  if (!data.students.length) {
    section?.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }
  section?.classList.remove('hidden');
  empty?.classList.add('hidden');

  const sinTel = data.total - data.conTelefono;
  if (stat) stat.textContent =
    `${data.total} estudiantes · ${data.conTelefono} con teléfono · ${sinTel} sin teléfono · ${data.students.filter(s=>s.estado==='DIFICULTAD').length} con dificultad`;

  const isAttTab = ['A1','A2','A3','A4'].includes(data.tabName);
  tbody.innerHTML = data.students.map((s, i) => {
    const hasPhone = !!s.telefono;
    const notaFmt  = isAttTab
      ? (s.pctAsistencia != null ? s.pctAsistencia.toFixed(1) + '%' : '—')
      : ((s.nota != null && s.nota !== 0) ? Number(s.nota).toFixed(2) : '—');
    const difBadge = isAttTab
      ? (s.estado === 'INASISTENCIAS'
          ? '<span class="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full">⚠️ Inasistencias</span>'
          : s.estado === 'BAJO_ASISTENCIA'
            ? '<span class="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full">⚠️ Bajo %</span>'
            : '<span class="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">✅ Regular</span>')
      : (s.estado === 'DIFICULTAD'
          ? '<span class="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full">⚠️ Dificultad</span>'
          : '<span class="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">✅ Aprobado</span>');

    return `
      <tr class="border-b border-gray-50 hover:bg-gray-50 transition" id="pr-row-${i}">
        <td class="px-4 py-2.5 text-center">
          <input type="checkbox" id="pr-chk-${i}" ${hasPhone ? 'checked' : 'disabled'}
            class="accent-indigo-600 ${!hasPhone ? 'opacity-30' : ''}" />
        </td>
        <td class="px-4 py-2.5 font-medium text-gray-800">${esc(s.nombre)}</td>
        <td class="px-4 py-2.5 text-gray-500 text-xs">${esc(s.curso) || '—'}</td>
        <td class="px-4 py-2.5 text-xs ${hasPhone ? 'text-green-700 font-mono' : 'text-gray-300 italic'}">
          ${hasPhone ? s.telefono : 'sin teléfono'}
        </td>
        <td class="px-4 py-2.5 text-center font-mono font-bold ${isAttTab ? (s.pctAsistencia < 75 ? 'text-red-600' : 'text-green-700') : (s.nota < 7 ? 'text-red-600' : 'text-green-700')}">${notaFmt}</td>
        <td class="px-4 py-2.5 text-center">${difBadge}</td>
        <td class="px-4 py-2.5 text-center">
          <button onclick="toggleParentPreview(${i})" class="text-xs text-gray-400 hover:text-indigo-600 border border-gray-200 rounded-lg px-2 py-0.5 hover:border-indigo-300 transition">👁</button>
        </td>
      </tr>
      <tr id="pr-preview-${i}" class="hidden bg-indigo-50 border-b border-indigo-100">
        <td colspan="7" class="px-6 py-3">
          <p class="text-xs font-semibold text-indigo-700 mb-2">Vista previa del mensaje WhatsApp:</p>
          <pre class="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed bg-white rounded-xl p-3 border border-indigo-100">${esc(buildParentMsgPreview(s, data.tabName))}</pre>
        </td>
      </tr>`;
  }).join('');
}

function buildParentMsgPreview(s, tabName) {
  const fmt = (v) => (v != null && v !== 0 && v !== '') ? Number(v).toFixed(2) : '—';
  const periodo = ETAPA_LABEL[tabName] || tabName;

  // Attendance tabs (A1-A4)
  if (['A1','A2','A3','A4'].includes(tabName)) {
    let msg = `📚 Conservatorio Bolívar de Ambato\nInforme de asistencias — Registro ${tabName}\n\n`;
    msg += `Estimado/a representante de ${s.nombre}:\n`;
    msg += `🎓 Curso: ${s.curso || '—'} | 📖 Asignatura: ${_padresMateria || '—'}\n\n`;
    msg += `📅 Asistencias [${tabName}]:\n`;
    msg += `• Clases registradas: ${s.totalClases ?? 0}\n`;
    msg += `• Asistencias: ${s.asistencias ?? 0}\n`;
    msg += `• Faltas justificadas: ${s.faltasJ ?? 0}\n`;
    msg += `• Faltas injustificadas: ${s.faltasI ?? 0}\n`;
    msg += `• Porcentaje: ${(s.pctAsistencia ?? 0).toFixed(1)}%\n`;
    if ((s.faltasI ?? 0) >= 3) {
      msg += '\n⚠️ Registra inasistencias injustificadas. Le invitamos a comunicarse con la institución.\n';
    } else if ((s.pctAsistencia ?? 100) < 75) {
      msg += '\n⚠️ Bajo porcentaje de asistencia.\n';
    } else {
      msg += '\n✅ Asistencia regular.\n';
    }
    msg += `\nAtentamente,\n${_padresDocente || 'Docente'}\nConservatorio Bolívar de Ambato`;
    return msg;
  }

  let msg = `📚 Conservatorio Bolívar de Ambato\nInforme de calificaciones — ${periodo}\n\n`;
  msg += `Estimado/a representante de ${s.nombre}:\n`;
  msg += `🎓 Curso: ${s.curso || '—'}  |  📖 Asignatura: ${_padresMateria || '—'}\n\n`;
  msg += `📊 Calificaciones ${periodo}:\n`;

  if (['1P','2P','3P','4P'].includes(tabName)) {
    msg += `• Promedio: ${fmt(s.nota)}\n`;
  } else if (['1Q','2Q'].includes(tabName)) {
    if (s.p1    != null) msg += `• 1er Parcial: ${fmt(s.p1)}\n`;
    if (s.p2    != null) msg += `• 2do Parcial: ${fmt(s.p2)}\n`;
    if (s.promParciales != null) msg += `• Prom. Parciales: ${fmt(s.promParciales)}\n`;
    if (s.examen!= null) msg += `• Examen Quimestral: ${fmt(s.examen)}\n`;
    msg += `• Nota Final: ${fmt(s.nota)}`;
    if (s.escala) msg += ` (${s.escala})`;
    msg += '\n';
    if (s.faltasJ || s.faltasI) {
      msg += `\n📅 Asistencia:\n`;
      if (s.faltasJ) msg += `• Justificadas: ${s.faltasJ}\n`;
      if (s.faltasI) msg += `• Injustificadas: ${s.faltasI}\n`;
    }
  } else if (tabName === 'Anual') {
    if (s.q1 != null) msg += `• 1er Quimestre: ${fmt(s.q1)}\n`;
    if (s.q2 != null) msg += `• 2do Quimestre: ${fmt(s.q2)}\n`;
    msg += `• Nota Final Anual: ${fmt(s.nota)}`;
    if (s.escala) msg += ` (${s.escala})`;
    msg += '\n';
    if (s.faltasJ || s.faltasI) {
      msg += `\n📅 Asistencia anual:\n`;
      if (s.faltasJ) msg += `• Justificadas: ${s.faltasJ}\n`;
      if (s.faltasI) msg += `• Injustificadas: ${s.faltasI}\n`;
    }
  }

  msg += s.estado === 'DIFICULTAD'
    ? '\n⚠️ Su representado/a presenta dificultades académicas. Le invitamos a comunicarse con la institución.\n'
    : '\n✅ Aprobado/a en esta etapa.\n';
  msg += `\nAtentamente,\n${_padresDocente || 'Docente'}\nConservatorio Bolívar de Ambato`;
  return msg;
}

function toggleParentPreview(i) {
  document.getElementById(`pr-preview-${i}`)?.classList.toggle('hidden');
}

function toggleAllParentChecks(checked) {
  if (!_padresData) return;
  _padresData.students.forEach((s, i) => {
    if (s.telefono) {
      const chk = document.getElementById(`pr-chk-${i}`);
      if (chk) chk.checked = checked;
    }
  });
}

async function sendParentReports() {
  if (!waConnected || !waInstance) {
    alert('WhatsApp no está conectado. Ve a la sección WhatsApp y escanea el QR primero.');
    return;
  }
  if (!_padresData) { alert('Carga los estudiantes primero.'); return; }

  const tabName  = _padresData.tabName;
  const periodo  = ETAPA_LABEL[tabName] || tabName;
  const selected = _padresData.students.filter((s, i) => {
    const chk = document.getElementById(`pr-chk-${i}`);
    return chk?.checked && s.telefono;
  });

  if (!selected.length) { alert('No hay estudiantes seleccionados con teléfono.'); return; }
  if (!confirm(`¿Enviar ${selected.length} mensajes a representantes vía WhatsApp?`)) return;

  // Show progress bar
  const bar   = document.getElementById('padresProgressBar');
  const fill  = document.getElementById('padresProgressFill');
  const lbl   = document.getElementById('padresProgressLabel');
  const cnt   = document.getElementById('padresProgressCount');
  bar?.classList.remove('hidden');
  if (fill)  fill.style.width = '0%';
  if (lbl)   lbl.textContent = 'Enviando mensajes…';
  if (cnt)   cnt.textContent = `0 / ${selected.length}`;

  const res = await fetch(API + 'api/wa/send-parent-report', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instance:      waInstance,
      materia:       _padresMateria,
      periodo,
      tabName,
      docenteNombre: _padresDocente,
      students:      selected,
    }),
  }).then(r => r.json());

  // Update progress to 100%
  if (fill)  fill.style.width = '100%';
  if (lbl)   lbl.textContent  = `✅ Completado`;
  if (cnt)   cnt.textContent  = `${res.sent ?? 0} / ${selected.length}`;

  // Mark rows with result
  if (res.results) {
    res.results.forEach((r, idx) => {
      const realIdx = _padresData.students.findIndex(s => s.nombre === r.nombre);
      if (realIdx < 0) return;
      const row = document.getElementById(`pr-row-${realIdx}`);
      if (!row) return;
      const last = row.querySelector('td:last-child');
      if (!last) return;
      if (r.status === 'sent') {
        last.innerHTML = '<span class="text-green-600 text-xs">✅ Enviado</span>';
      } else if (r.status === 'error') {
        last.innerHTML = `<span class="text-red-500 text-xs" title="${esc(r.error||'')}">❌ Error</span>`;
      }
    });
  }

  const errCount = (res.results || []).filter(r => r.status === 'error').length;
  if (errCount) alert(`Enviados: ${res.sent}. Errores: ${errCount}. Revisa los íconos ❌ en la lista.`);
}

// ══════════════════════════════════════════════════════════════════════════════
// INGRESO DE CALIFICACIONES / ASISTENCIAS
// ══════════════════════════════════════════════════════════════════════════════

let _ingresoData       = null;  // response from /api/tab-data
let _ingresoSheetId    = null;
let _ingresoCurrentUrl = null;  // full URL of selected sheet (for back navigation)
let _ingresoChanges    = {};    // { "sheetRow-col": { sheetRow, col, value } }

// ── Ingreso Wizard ────────────────────────────────────────────────────────────
let _ingresoWizardStep = 0;
let _ingresoWizardType = null; // 'calificaciones' | 'asistencias'

function _ingresoShowStep(n) {
  [0,1,2,3,4].forEach(i => {
    const el = document.getElementById('ingreso-p' + i);
    if (el) el.classList.toggle('hidden', i !== n);
  });
  const nav = document.getElementById('ingreso-nav');
  if (nav) nav.classList.toggle('hidden', n === 0);
  _ingresoWizardStep = n;
}

function initIngresoView() {
  _ingresoWizardStep = 0;
  _ingresoWizardType = null;
  _ingresoSheetId    = null;
  _ingresoCurrentUrl = null;
  _ingresoShowStep(0);
  const banner = document.getElementById('ingresoReauthBanner');
  if (banner) banner.classList.toggle('hidden', _canWrite);
}

function ingresoSelectTipo(tipo) {
  _ingresoWizardType = tipo;
  document.getElementById('ingreso-c0').textContent = tipo === 'calificaciones' ? '📊 Calificaciones' : '📋 Asistencias';
  ['ingreso-c1','ingreso-c1-arr','ingreso-c2'].forEach(id => document.getElementById(id)?.classList.add('hidden'));

  const seen = new Set();
  const unique = savedSheets.filter(s => { if (seen.has(s.url)) return false; seen.add(s.url); return true; });

  const container = document.getElementById('ingreso-hojas-cards');
  if (!unique.length) {
    container.innerHTML = '<p class="text-sm text-gray-400 col-span-3">No hay hojas guardadas. Agrega una en "Hojas".</p>';
  } else {
    container.innerHTML = unique.map(s => {
      const safeUrl = s.url.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      return `
      <button onclick="ingresoSelectHoja('${safeUrl}')"
        class="flex flex-col gap-2 p-4 bg-white rounded-2xl shadow border-2 border-transparent hover:border-indigo-400 hover:shadow-md transition text-left">
        <span class="text-2xl">📄</span>
        <span class="font-semibold text-gray-800 text-sm leading-tight">${s.materia || 'Sin materia'}</span>
        <span class="text-xs text-gray-400">${s.docenteNombre || s.institution || '—'}</span>
      </button>`;
    }).join('');
  }
  _ingresoShowStep(1);
}

function ingresoSelectHoja(url) {
  _ingresoCurrentUrl = url;
  _ingresoSheetId    = extractSheetIdFromUrl(url);
  const sheet = savedSheets.find(s => s.url === url);

  const c1 = document.getElementById('ingreso-c1');
  c1.textContent = sheet?.materia || url.slice(0, 40);
  c1.classList.remove('hidden');
  document.getElementById('ingreso-c1-arr')?.classList.remove('hidden');
  document.getElementById('ingreso-c2')?.classList.add('hidden');

  const isAtt = _ingresoWizardType === 'asistencias';
  const periods = isAtt
    ? [['A1','Asist.\n1er Parcial','📋'],['A2','Asist.\n2do Parcial','📋'],['A3','Asist.\n3er Parcial','📋'],['A4','Asist.\n4to Parcial','📋']]
    : [['1P','1er Parcial','1️⃣'],['2P','2do Parcial','2️⃣'],['3P','3er Parcial','3️⃣'],['4P','4to Parcial','4️⃣'],['1Q','1er\nQuimestre','Q1'],['2Q','2do\nQuimestre','Q2'],['Anual','Anual','🏆']];

  document.getElementById('ingreso-etapa-cards').innerHTML = periods.map(([tab, label, icon]) => `
    <button onclick="ingresoSelectEtapa('${tab}')"
      class="flex flex-col items-center gap-2 p-4 bg-white rounded-2xl shadow border-2 border-transparent hover:border-indigo-400 hover:shadow-md transition text-center">
      <span class="text-2xl">${icon}</span>
      <span class="font-semibold text-gray-800 text-sm whitespace-pre-line leading-tight">${label}</span>
    </button>`).join('');
  _ingresoShowStep(2);
}

async function ingresoSelectEtapa(tab) {
  const hiddenTab = document.getElementById('ingresoTabSelect');
  if (hiddenTab) hiddenTab.value = tab;
  const c2 = document.getElementById('ingreso-c2');
  c2.textContent = ETAPA_LABEL[tab] || tab;
  c2.classList.remove('hidden');
  _ingresoShowStep(3);
  await loadIngresoData();
}

function ingresoBack() {
  if (_ingresoWizardStep === 1) { initIngresoView(); return; }
  if (_ingresoWizardStep === 2) { ingresoSelectTipo(_ingresoWizardType); return; }
  if (_ingresoWizardStep === 3) { ingresoSelectHoja(_ingresoCurrentUrl || ''); return; }
  if (_ingresoWizardStep === 4) { _ingresoShowStep(3); _updateIngresoCrumb3(); return; }
}

function onIngresoSheetChange(urlVal) { /* legacy — wizard sets _ingresoSheetId directly */ }

// ── Wizard paso 3: cursos → estudiantes ──────────────────────────────────────
let _ingresoCurrentStudentIdx = -1;
let _ingresoStudentFilter     = '';
let _ingresoCurrentCurso      = null; // curso seleccionado, null = todos

function _updateIngresoCrumb3() {
  const tab = document.getElementById('ingresoTabSelect')?.value || '';
  const c2  = document.getElementById('ingreso-c2');
  c2.textContent = ETAPA_LABEL[tab] || tab;
  c2.classList.remove('hidden');
  const c3  = document.getElementById('ingreso-c3');
  const c3a = document.getElementById('ingreso-c3-arr');
  if (c3)  c3.remove();
  if (c3a) c3a.remove();
}

function renderIngresoStudentList(data) {
  console.log('[ingreso] data recibido:', { students: data?.students?.length, courses: data?.courses, type: data?.type });
  _ingresoStudentFilter = '';
  const inp = document.getElementById('ingreso-search');
  if (inp) inp.value = '';

  // Siempre mostrar vista de cursos (con "Todos" si no hay cursos detectados)
  _showIngresoCursosView(data || { students: [], courses: [], editableCols: [], type: 'grade' });
}

// ── Paleta de colores para las burbujas de curso ─────────────────────────────
const CURSO_COLORS = [
  'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200',
  'bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-200',
  'bg-violet-100 text-violet-800 border-violet-200 hover:bg-violet-200',
  'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200',
  'bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-200',
  'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200',
  'bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-200',
  'bg-sky-100 text-sky-800 border-sky-200 hover:bg-sky-200',
];

// ── Sub-vista A: cursos ──────────────────────────────────────────────────────
function _showIngresoCursosView(data) {
  document.getElementById('ingreso-p3-cursos').classList.remove('hidden');
  document.getElementById('ingreso-p3-students').classList.add('hidden');

  const courses  = data?.courses || [];
  const total    = data?.students?.length || 0;
  const grid     = document.getElementById('ingreso-cursos-grid');
  const tab      = document.getElementById('ingresoTabSelect')?.value || '';
  const isAtt    = data?.type === 'attendance';
  const tipoTxt  = isAtt ? 'asistencias' : 'calificaciones';

  // Siempre hay un botón "Todos" al inicio
  const todosBtn = `
    <button onclick="ingresoSelectCurso(null)"
      class="flex flex-col items-start gap-1 px-5 py-3.5 rounded-2xl border-2 shadow-sm transition font-medium bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200">
      <span class="text-base font-bold">📋 Todos los cursos</span>
      <span class="text-xs opacity-70">${total} estudiante${total!==1?'s':''} en total</span>
    </button>`;

  const sinCursoCount = data.students.filter(s => !s.curso).length;

  const cursoBtns = courses.map((c, i) => {
    const n     = data.students.filter(s => s.curso === c).length;
    const color = CURSO_COLORS[i % CURSO_COLORS.length];
    const safe  = c.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `
    <button onclick="ingresoSelectCurso('${safe}')"
      class="flex flex-col items-start gap-1 px-5 py-3.5 rounded-2xl border-2 shadow-sm transition font-medium ${color}">
      <span class="text-base font-bold">${c}</span>
      <span class="text-xs opacity-70">${n} estudiante${n!==1?'s':''}</span>
    </button>`;
  }).join('');

  const sinCursoBtn = sinCursoCount ? `
    <button onclick="ingresoSelectCurso('__NONE__')"
      class="flex flex-col items-start gap-1 px-5 py-3.5 rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 shadow-sm transition font-medium">
      <span class="text-base font-bold">⚠️ Sin curso asignado</span>
      <span class="text-xs opacity-70">${sinCursoCount} estudiante${sinCursoCount!==1?'s':''} — clic para asignar</span>
    </button>` : '';

  grid.innerHTML = todosBtn + cursoBtns + sinCursoBtn;
}

function ingresoSelectCurso(curso) {
  _ingresoCurrentCurso = curso;
  _showIngresoStudentsView(_ingresoData, curso);
}

function ingresoVolverCursos() {
  _showIngresoCursosView(_ingresoData);
}

// ── Sub-vista B: lista de estudiantes ────────────────────────────────────────
function _showIngresoStudentsView(data, curso) {
  document.getElementById('ingreso-p3-cursos').classList.add('hidden');
  document.getElementById('ingreso-p3-students').classList.remove('hidden');

  const badge   = document.getElementById('ingreso-curso-badge');
  const btnBack = document.getElementById('ingreso-btn-cursos');
  if (curso) {
    badge.textContent = curso; badge.classList.remove('hidden');
    btnBack?.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
    btnBack?.classList.add('hidden');
  }

  const inp = document.getElementById('ingreso-search');
  if (inp) inp.value = '';
  _ingresoStudentFilter = '';
  _renderStudentCards(data, curso);
}

// Genera el HTML de una tarjeta de estudiante
function _studentCardHtml(s, data, isAtt) {
  const origIdx = data.students.indexOf(s);
  const noCurso = !s.curso;

  let badge = '';
  if (noCurso) {
    badge = `<span class="ml-auto text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">+ Asignar</span>`;
  } else if (!isAtt && data.editableCols.length) {
    const vals  = data.editableCols.map(c => parseFloat(s.values[c.index]) || 0).filter(v => v > 0);
    if (vals.length) {
      const avg   = (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
      const color = parseFloat(avg) >= 7 ? 'text-green-600' : 'text-red-500';
      badge = `<span class="ml-auto text-xs font-bold ${color}">${avg}</span>`;
    } else {
      badge = `<span class="ml-auto text-xs text-gray-300">—</span>`;
    }
  } else if (isAtt) {
    const dc = data.editableCols.filter(c => c.isDate);
    const p  = dc.reduce((n,c) => n + (String(s.values[c.index]).toUpperCase()==='A'?1:0), 0);
    if (dc.length) badge = `<span class="ml-auto text-xs text-gray-400">${p}/${dc.length}</span>`;
  }

  const borderCls  = noCurso ? 'border-orange-200 bg-orange-50 hover:border-orange-400' : 'border-transparent hover:border-indigo-400';
  const avatarCls  = noCurso ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700';
  const clickFn    = noCurso ? `abrirAsignacionCurso(${origIdx})` : `ingresoSeleccionarEstudiante(${origIdx})`;

  return `
  <button onclick="${clickFn}"
    class="flex items-center gap-3 p-3.5 bg-white rounded-2xl shadow border-2 ${borderCls} hover:shadow-md transition text-left w-full">
    <span class="w-8 h-8 rounded-full ${avatarCls} text-sm font-bold flex items-center justify-center flex-shrink-0">
      ${(s.nombre.trim()[0]||'?').toUpperCase()}
    </span>
    <span class="flex-1 font-medium text-gray-800 text-sm leading-tight">${s.nombre}</span>
    ${badge}
  </button>`;
}

function _renderStudentCards(data, curso) {
  const list  = document.getElementById('ingreso-student-list');
  const empty = document.getElementById('ingreso-student-empty');
  const count = document.getElementById('ingreso-p3-count');
  const isAtt = data.type === 'attendance';
  const q     = _ingresoStudentFilter.toLowerCase();

  let filtered = curso === '__NONE__'
    ? data.students.filter(s => !s.curso)
    : curso
      ? data.students.filter(s => s.curso === curso)
      : data.students;
  if (q) filtered = filtered.filter(s => s.nombre.toLowerCase().includes(q));

  if (count) count.textContent = `${filtered.length} estudiante${filtered.length!==1?'s':''}`;

  if (!filtered.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Curso específico → lista plana
  if (curso !== null) {
    list.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3';
    list.innerHTML = filtered.map(s => _studentCardHtml(s, data, isAtt)).join('');
    return;
  }

  // Todos los cursos → agrupar con cabeceras de sección
  const groups = new Map();
  for (const s of filtered) {
    const k = s.curso || 'Sin curso asignado';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }

  list.className = 'space-y-6'; // cambia layout a vertical para las secciones
  list.innerHTML = [...groups.entries()].map(([nombre, alumnos], gi) => {
    const color = CURSO_COLORS[gi % CURSO_COLORS.length];
    const cards = alumnos.map(s => _studentCardHtml(s, data, isAtt)).join('');
    return `
    <div>
      <!-- Cabecera del curso -->
      <div class="flex items-center gap-3 mb-3">
        <span class="px-3 py-1 rounded-full text-xs font-bold border ${color}">${nombre}</span>
        <span class="text-xs text-gray-400">${alumnos.length} estudiante${alumnos.length!==1?'s':''}</span>
        <div class="flex-1 h-px bg-gray-100"></div>
      </div>
      <!-- Tarjetas de estudiantes -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        ${cards}
      </div>
    </div>`;
  }).join('');
}

function filtrarEstudiantesIngreso(q) {
  _ingresoStudentFilter = q;
  if (_ingresoData) _renderStudentCards(_ingresoData, _ingresoCurrentCurso);
}

// ── Wizard: asignar curso a estudiante sin curso ──────────────────────────────

let _assignIdx = null;
let _assignAno = null;

const _ANIOS_ASSIGN = [
  { label:'1ro Básica',  key:'1o A' , base:'1o'  },
  { label:'2do Básica',  key:'2o A' , base:'2o'  },
  { label:'3ro Básica',  key:'3o A' , base:'3o'  },
  { label:'4to Básica',  key:'4o A' , base:'4o'  },
  { label:'5to Básica',  key:'5o A' , base:'5o'  },
  { label:'6to Básica',  key:'6o A' , base:'6o'  },
  { label:'7mo Básica',  key:'7o A' , base:'7o'  },
  { label:'8vo Básica',  key:'8o A' , base:'8o'  },
  { label:'1er Bach',    key:'9o A' , base:'9o Año (1o Bach)' },
  { label:'2do Bach',    key:'10o A', base:'10o Año (2o Bach)'},
  { label:'3er Bach',    key:'11o A', base:'11o Año (3o Bach)'},
];

function abrirAsignacionCurso(idx) {
  _assignIdx = idx;
  _assignAno = null;
  const student = _ingresoData.students[idx];

  document.getElementById('assign-nombre').textContent = student.nombre;

  // Cursos ya existentes en este sheet
  const courses = _ingresoData.courses || [];
  const list = document.getElementById('assign-cursos-list');
  if (courses.length) {
    list.innerHTML = courses.map((c, i) => {
      const safe  = c.replace(/'/g, "\\'");
      const color = CURSO_COLORS[i % CURSO_COLORS.length];
      return `<button onclick="confirmarAsignacion('${safe}')" class="px-4 py-2 rounded-xl border-2 text-sm font-semibold transition ${color}">${c}</button>`;
    }).join('');
    document.getElementById('assign-no-cursos').classList.add('hidden');
  } else {
    list.innerHTML = '';
    document.getElementById('assign-no-cursos').classList.remove('hidden');
  }

  // Reset sección nueva
  document.getElementById('assign-nuevo-section').classList.add('hidden');
  document.getElementById('assign-nuevo-arrow').textContent = '▶';
  document.getElementById('assign-paralelo-section').classList.add('hidden');

  document.getElementById('ingreso-assign-modal').classList.remove('hidden');
}

function cerrarAsignacion() {
  document.getElementById('ingreso-assign-modal').classList.add('hidden');
  _assignIdx = null;
  _assignAno = null;
}

function toggleAsignaNuevo() {
  const sec   = document.getElementById('assign-nuevo-section');
  const arrow = document.getElementById('assign-nuevo-arrow');
  const hidden = sec.classList.toggle('hidden');
  arrow.textContent = hidden ? '▶' : '▼';
  if (!hidden) {
    // Renderizar botones de años
    document.getElementById('assign-anos').innerHTML = _ANIOS_ASSIGN.map(a =>
      `<button onclick="seleccionarAnoAsignacion('${a.base}','${a.label}')"
        class="px-3 py-1.5 rounded-xl border text-sm font-medium bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 transition">${a.label}</button>`
    ).join('');
    document.getElementById('assign-paralelo-section').classList.add('hidden');
  }
}

function seleccionarAnoAsignacion(base, label) {
  _assignAno = { base, label };
  // Resaltar año seleccionado
  document.querySelectorAll('#assign-anos button').forEach(b => {
    const sel = b.textContent.trim() === label;
    b.className = sel
      ? 'px-3 py-1.5 rounded-xl border text-sm font-medium bg-indigo-600 text-white border-indigo-600 transition'
      : 'px-3 py-1.5 rounded-xl border text-sm font-medium bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 transition';
  });
  // Mostrar paralelos
  const ps = document.getElementById('assign-paralelo-section');
  ps.classList.remove('hidden');
  document.getElementById('assign-paralelos').innerHTML = ['A','B','C','D'].map(p => {
    const cursoStr = `${base} ${p}`;
    const safe = cursoStr.replace(/'/g,"\\'");
    return `<button onclick="confirmarAsignacion('${safe}')"
      class="w-12 h-12 rounded-xl border-2 text-base font-bold bg-green-50 text-green-700 border-green-200 hover:bg-green-500 hover:text-white hover:border-green-500 transition">${p}</button>`;
  }).join('');
}

async function confirmarAsignacion(cursoStr) {
  if (_assignIdx === null || !_ingresoData) return;
  const student = _ingresoData.students[_assignIdx];

  if (!student.contactoSheetRow) {
    alert(`"${student.nombre}" no tiene fila en la pestaña Contacto de este sheet. No se puede asignar automáticamente.`);
    cerrarAsignacion();
    return;
  }
  if (!_ingresoData.contactoTab || _ingresoData.contactoCursoCol == null || _ingresoData.contactoCursoCol < 0) {
    alert('No se encontró la columna Curso en la pestaña Contacto.');
    cerrarAsignacion();
    return;
  }

  // Indicador de carga en el botón pulsado
  const btn = event?.target;
  const orig = btn?.innerHTML;
  if (btn) { btn.innerHTML = '⏳'; btn.disabled = true; }

  try {
    const res = await fetch('/api/tab-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetId: _ingresoSheetId,
        tab:     _ingresoData.contactoTab,
        updates: [{ sheetRow: student.contactoSheetRow, col: _ingresoData.contactoCursoCol, value: cursoStr }],
      }),
    });
    const r = await res.json();

    if (!r.success) {
      alert('Error al guardar: ' + (r.error || 'Error desconocido'));
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
      return;
    }

    // Actualizar datos locales
    student.curso = cursoStr;
    if (!_ingresoData.courses.includes(cursoStr)) _ingresoData.courses.push(cursoStr);

    cerrarAsignacion();
    // Volver a la vista de cursos (actualizada)
    _showIngresoCursosView(_ingresoData);

  } catch(e) {
    alert('Error de red: ' + e.message);
    if (btn) { btn.innerHTML = orig; btn.disabled = false; }
  }
}

// ── Wizard paso 4: formulario CRUD del estudiante ─────────────────────────────

function ingresoSeleccionarEstudiante(idx) {
  if (!_ingresoData) return;
  _ingresoCurrentStudentIdx = idx;
  const student = _ingresoData.students[idx];
  const data    = _ingresoData;
  const tab     = document.getElementById('ingresoTabSelect')?.value || data.tab;
  const isAtt   = data.type === 'attendance';
  const isGrade = ['1P','2P','3P','4P'].includes(tab);

  // Breadcrumb
  _updateIngresoCrumb3();
  const nav = document.getElementById('ingreso-nav');
  if (nav) {
    let c3 = document.getElementById('ingreso-c3');
    if (!c3) {
      const arr = Object.assign(document.createElement('span'),
        { id:'ingreso-c3-arr', textContent:'›', className:'text-gray-300' });
      c3 = Object.assign(document.createElement('span'),
        { id:'ingreso-c3', className:'font-medium text-indigo-600 truncate max-w-xs' });
      nav.querySelector('.flex').appendChild(arr);
      nav.querySelector('.flex').appendChild(c3);
    }
    c3.textContent = student.nombre;
  }

  // Header
  document.getElementById('ingreso-form-etapa').textContent = ETAPA_LABEL[tab] || tab;
  document.getElementById('ingreso-form-nombre').textContent = student.nombre;
  document.getElementById('ingreso-form-sub').textContent    = isAtt ? 'Registro de asistencia' : 'Calificaciones por clase';
  document.getElementById('ingreso-form-num').textContent    = `${idx+1} / ${data.students.length}`;
  const cursoBadge = document.getElementById('ingreso-form-curso-badge');
  if (student.curso) { cursoBadge.textContent = student.curso; cursoBadge.classList.remove('hidden'); }
  else { cursoBadge.classList.add('hidden'); }

  // Editable fields — CRUD
  document.getElementById('ingreso-form-fields').innerHTML = data.editableCols.map(col => {
    const val    = String(student.values[col.index] ?? '');
    const hasVal = val !== '';
    const fieldId = 'if-' + col.index;

    if (isAtt && col.isDate) {
      const opts = ['','A','F.J','F.I'].map(o =>
        `<option value="${o}" ${val===o?'selected':''}>${o||'— —'}</option>`).join('');
      return `
      <div class="flex items-center gap-2">
        <label class="text-sm text-gray-600 w-24 flex-shrink-0">${col.name}</label>
        <select id="${fieldId}" data-col="${col.index}" data-orig="${val}"
          onchange="marcarCambioIngreso(${col.index})"
          class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
          ${opts}
        </select>
        <span id="if-dot-${col.index}" class="w-2 h-2 rounded-full flex-shrink-0" style="background:transparent"></span>
      </div>`;
    }

    return `
    <div class="flex items-center gap-2">
      <label class="text-sm text-gray-600 w-24 flex-shrink-0">${col.name}</label>
      <div class="relative flex-1">
        <input id="${fieldId}" type="${isGrade?'number':'text'}"
          data-col="${col.index}" data-orig="${val}" value="${val}"
          ${isGrade?'min="0" max="10" step="0.01"':''}
          oninput="marcarCambioIngreso(${col.index})"
          class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 ${hasVal?'pr-8':''}" />
        ${hasVal?`<button type="button" onclick="borrarCampoIngreso(${col.index})"
          title="Borrar" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-red-400 text-lg leading-none font-bold">×</button>`:''}
      </div>
      <span id="if-dot-${col.index}" class="w-2 h-2 rounded-full flex-shrink-0" style="background:transparent"></span>
    </div>`;
  }).join('');

  // Readonly fields (calculated)
  const roWrap = document.getElementById('ingreso-form-readonly-wrap');
  const roEl   = document.getElementById('ingreso-form-readonly');
  if (data.readonlyCols?.length) {
    roWrap.classList.remove('hidden');
    roEl.innerHTML = data.readonlyCols.map(col => {
      const val = String(student.values[col.index] ?? '—');
      return `
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-400 w-24 flex-shrink-0">${col.name}</span>
        <span class="flex-1 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">${val}</span>
      </div>`;
    }).join('');
    roEl.classList.add('hidden');
    document.getElementById('ingreso-readonly-arrow').textContent = '▶';
  } else {
    roWrap.classList.add('hidden');
  }

  const st = document.getElementById('ingreso-form-status');
  if (st) st.classList.add('hidden');

  _ingresoShowStep(4);
}

function marcarCambioIngreso(colIdx) {
  const el  = document.getElementById('if-' + colIdx);
  const dot = document.getElementById('if-dot-' + colIdx);
  if (!el || !dot) return;
  const changed = el.value !== (el.dataset.orig || '');
  dot.style.background = changed ? '#f97316' : 'transparent';
  // Show/hide × button dynamically for text/number inputs
  const wrap = el.parentElement;
  if (wrap && el.tagName === 'INPUT') {
    let btn = wrap.querySelector('button[title="Borrar"]');
    if (el.value && !btn) {
      btn = document.createElement('button');
      btn.type = 'button'; btn.title = 'Borrar';
      btn.className = 'absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-red-400 text-lg leading-none font-bold';
      btn.textContent = '×';
      btn.onclick = () => borrarCampoIngreso(colIdx);
      wrap.appendChild(btn);
    } else if (!el.value && btn) {
      btn.remove();
    }
  }
}

function borrarCampoIngreso(colIdx) {
  const el = document.getElementById('if-' + colIdx);
  if (!el) return;
  el.value = '';
  marcarCambioIngreso(colIdx);
}

function ingresoResetearEstudiante() {
  if (!_ingresoData) return;
  const data = _ingresoData;
  for (const col of data.editableCols) {
    const el  = document.getElementById('if-' + col.index);
    const dot = document.getElementById('if-dot-' + col.index);
    if (el)  { el.value = el.dataset.orig || ''; }
    if (dot) { dot.style.background = 'transparent'; }
  }
  const st = document.getElementById('ingreso-form-status');
  if (st) st.classList.add('hidden');
}

function toggleIngresoReadonly() {
  const el  = document.getElementById('ingreso-form-readonly');
  const arr = document.getElementById('ingreso-readonly-arrow');
  const hidden = el.classList.toggle('hidden');
  arr.textContent = hidden ? '▶' : '▼';
}

async function ingresoGuardarEstudiante() {
  const data    = _ingresoData;
  const student = data?.students[_ingresoCurrentStudentIdx];
  if (!student) return;

  const tab     = document.getElementById('ingresoTabSelect')?.value || data.tab;
  const updates = [];

  for (const col of data.editableCols) {
    const el = document.getElementById('if-' + col.index);
    if (!el) continue;
    if (el.value !== (el.dataset.orig ?? '')) {
      updates.push({ sheetRow: student.sheetRow, col: col.index, value: el.value });
    }
  }

  const st  = document.getElementById('ingreso-form-status');
  const btn = document.getElementById('ingreso-save-btn');

  if (!updates.length) {
    if (st) { st.textContent = 'Sin cambios'; st.className = 'text-xs font-medium text-gray-400'; st.classList.remove('hidden'); }
    return;
  }

  if (btn) { btn.textContent = '⏳ Guardando…'; btn.disabled = true; }
  try {
    const res = await fetch(API + 'api/tab-write', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetId: _ingresoSheetId, tab, updates }),
    }).then(r => r.json());

    if (res.success) {
      for (const u of updates) student.values[u.col] = u.value;
      for (const col of data.editableCols) {
        const el  = document.getElementById('if-' + col.index);
        const dot = document.getElementById('if-dot-' + col.index);
        if (el)  { el.dataset.orig = el.value; }
        if (dot) { dot.style.background = 'transparent'; }
      }
      if (st) {
        st.textContent = `✅ ${updates.length} campo${updates.length>1?'s':''} guardado${updates.length>1?'s':''}`;
        st.className = 'text-xs font-medium text-green-600';
        st.classList.remove('hidden');
      }
    } else {
      if (res.needsReauth) document.getElementById('ingresoReauthBanner')?.classList.remove('hidden');
      alert('Error: ' + (res.error || 'Error desconocido'));
    }
  } finally {
    if (btn) { btn.textContent = '💾 Guardar'; btn.disabled = false; }
  }
}

function ingresoSiguienteEstudiante() {
  const data = _ingresoData;
  if (!data) return;
  const list = _ingresoCurrentCurso
    ? data.students.filter(s => s.curso === _ingresoCurrentCurso)
    : data.students;
  const curIdx = list.findIndex(s => data.students.indexOf(s) === _ingresoCurrentStudentIdx);
  const next   = list[curIdx + 1];
  if (next) {
    ingresoSeleccionarEstudiante(data.students.indexOf(next));
  } else {
    _ingresoShowStep(3); _updateIngresoCrumb3();
  }
}

function ingresoAnteriorEstudiante() {
  const data = _ingresoData;
  if (!data) return;
  const list = _ingresoCurrentCurso
    ? data.students.filter(s => s.curso === _ingresoCurrentCurso)
    : data.students;
  const curIdx = list.findIndex(s => data.students.indexOf(s) === _ingresoCurrentStudentIdx);
  const prev   = list[curIdx - 1];
  if (prev) {
    ingresoSeleccionarEstudiante(data.students.indexOf(prev));
  }
}

function extractSheetIdFromUrl(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : url;
}

async function loadIngresoData() {
  if (!_ingresoSheetId) {
    // Try to get sheetId from the select
    const selEl = document.getElementById('ingresoSheetSelect');
    const val = selEl?.value;
    if (!val) { alert('Selecciona una hoja primero.'); return; }
    _ingresoSheetId = extractSheetIdFromUrl(val);
  }
  const tab = document.getElementById('ingresoTabSelect')?.value;
  if (!tab) { alert('Selecciona una pestaña.'); return; }

  const btn = document.querySelector('#view-ingreso button[onclick="loadIngresoData()"]');
  if (btn) { btn.textContent = '⏳ Cargando…'; btn.disabled = true; }

  try {
    const res = await fetch(`${API}api/tab-data?sheetId=${encodeURIComponent(_ingresoSheetId)}&tab=${encodeURIComponent(tab)}`).then(r => r.json());
    if (!res.success) {
      if (res.needsReauth) {
        const banner = document.getElementById('ingresoReauthBanner');
        if (banner) banner.classList.remove('hidden');
      }
      alert('Error: ' + res.error);
      return;
    }
    _ingresoData    = res;
    _ingresoChanges = {};
    renderIngresoStudentList(res);
  } finally {
    if (btn) { btn.textContent = '📥 Cargar'; btn.disabled = false; }
  }
}

function renderIngresoTable(data) {
  const container  = document.getElementById('ingresoTableContainer');
  const actionsEl  = document.getElementById('ingresoActions');
  const emptyEl    = document.getElementById('ingresoEmpty');
  const chip       = document.getElementById('ingresoInfoChip');
  const chipTxt    = document.getElementById('ingresoInfoText');
  const table      = document.getElementById('ingresoTable');

  if (!data.students.length) {
    container?.classList.add('hidden');
    actionsEl?.classList.add('hidden');
    emptyEl?.classList.remove('hidden');
    return;
  }

  emptyEl?.classList.add('hidden');
  container?.classList.remove('hidden');
  actionsEl?.classList.remove('hidden');

  const editType = data.type === 'attendance' ? 'asistencias' : 'calificaciones';
  const editCount = data.editableCols.length;
  if (chip) chip.classList.remove('hidden');
  if (chipTxt) chipTxt.textContent =
    `${data.students.length} estudiantes · ${data.tab} — ${data.label} · ${editCount > 0 ? 'editable' : 'solo lectura'}`;

  // Build header
  const allCols = [...data.editableCols, ...data.readonlyCols];
  const editSet = new Set(data.editableCols.map(c => c.index));

  const thead = document.createElement('thead');
  thead.innerHTML = `<tr class="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-semibold">
    <th class="px-3 py-2.5 text-right w-8">#</th>
    <th class="px-3 py-2.5 text-left">Apellidos y Nombres</th>
    ${allCols.map(c => `<th class="px-3 py-2.5 text-center ${editSet.has(c.index) ? '' : 'text-gray-400'}">${esc(c.name)}</th>`).join('')}
  </tr>`;

  const tbody = document.createElement('tbody');
  data.students.forEach((st, rowIdx) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-gray-50 hover:bg-gray-50 transition';
    tr.id = `ing-row-${rowIdx}`;

    let cells = `<td class="px-3 py-2 text-right text-gray-400 text-xs">${rowIdx + 1}</td>`;
    cells += `<td class="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">${esc(st.nombre)}</td>`;

    for (const col of allCols) {
      const val = st.values[col.index] ?? '';
      const isEditable = editSet.has(col.index);
      if (!isEditable) {
        cells += `<td class="px-3 py-2 text-center text-gray-400 bg-gray-50 text-xs">${esc(String(val))}</td>`;
        continue;
      }
      const changeKey = `${st.sheetRow}-${col.index}`;
      if (data.type === 'attendance' && col.isDate) {
        // Attendance date cell: select A / F.J / F.I
        const opts = ['','A','F.J','F.I'].map(v =>
          `<option value="${v}" ${String(val).toUpperCase() === v.toUpperCase() ? 'selected' : ''}>${v || '—'}</option>`
        ).join('');
        cells += `<td class="px-1 py-1 text-center">
          <select class="border border-gray-200 rounded px-1 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
            onchange="onCellChange(${st.sheetRow}, ${col.index}, this.value, ${rowIdx})"
            data-orig="${esc(String(val))}" data-key="${changeKey}">
            ${opts}
          </select></td>`;
      } else if (data.type === 'attendance' && !col.isDate) {
        // Summary attendance col: number input
        cells += `<td class="px-1 py-1 text-center">
          <input type="number" min="0" step="1" value="${esc(String(val))}"
            class="w-16 border border-gray-200 rounded px-2 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-300"
            onchange="onCellChange(${st.sheetRow}, ${col.index}, this.value, ${rowIdx})"
            data-orig="${esc(String(val))}" data-key="${changeKey}" />
        </td>`;
      } else {
        // Grade: number input 0-10
        cells += `<td class="px-1 py-1 text-center">
          <input type="number" min="0" max="10" step="0.01" value="${esc(String(val))}"
            class="w-20 border border-gray-200 rounded px-2 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-300"
            onchange="onCellChange(${st.sheetRow}, ${col.index}, this.value, ${rowIdx})"
            data-orig="${esc(String(val))}" data-key="${changeKey}" />
        </td>`;
      }
    }

    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });

  table.innerHTML = '';
  table.appendChild(thead);
  table.appendChild(tbody);

  updateIngresoSaveBtn();
}

function onCellChange(sheetRow, col, value, rowIdx) {
  const key = `${sheetRow}-${col}`;
  // Find original value
  if (_ingresoData) {
    const student = _ingresoData.students.find(s => s.sheetRow === sheetRow);
    const orig = String(student?.values[col] ?? '');
    if (value === orig || (value === '' && orig === '')) {
      delete _ingresoChanges[key];
    } else {
      _ingresoChanges[key] = { sheetRow, col, value };
    }
  }
  updateIngresoSaveBtn();
}

function updateIngresoSaveBtn() {
  const count = Object.keys(_ingresoChanges).length;
  const btn   = document.getElementById('ingresoSaveBtn');
  if (btn) {
    btn.textContent = `💾 Guardar cambios (${count} celda${count !== 1 ? 's' : ''} modificada${count !== 1 ? 's' : ''})`;
    btn.disabled = count === 0;
  }
}

async function saveIngresoChanges() {
  const updates = Object.values(_ingresoChanges);
  if (!updates.length) return;
  if (!_ingresoSheetId || !_ingresoData) return;

  const tab    = _ingresoData.tab;
  const btn    = document.getElementById('ingresoSaveBtn');
  const status = document.getElementById('ingresoSaveStatus');
  if (btn) { btn.textContent = '⏳ Guardando…'; btn.disabled = true; }
  if (status) status.textContent = '';

  try {
    const res = await fetch(API + 'api/tab-write', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetId: _ingresoSheetId, tab, updates }),
    }).then(r => r.json());

    if (res.success) {
      if (status) { status.textContent = `✅ ${res.updatedCells} celdas guardadas`; }
      _ingresoChanges = {};
      // Update orig values in data
      for (const u of updates) {
        const student = _ingresoData.students.find(s => s.sheetRow === u.sheetRow);
        if (student) student.values[u.col] = u.value;
      }
      updateIngresoSaveBtn();
    } else {
      if (res.needsReauth) {
        const banner = document.getElementById('ingresoReauthBanner');
        if (banner) banner.classList.remove('hidden');
      }
      if (status) { status.textContent = '❌ ' + res.error; }
      alert('Error al guardar: ' + res.error);
    }
  } catch (e) {
    if (status) { status.textContent = '❌ Error de red'; }
    alert('Error de red: ' + e.message);
  } finally {
    updateIngresoSaveBtn();
  }
}

function discardIngresoChanges() {
  if (!Object.keys(_ingresoChanges).length) return;
  if (!confirm('¿Descartar todos los cambios no guardados?')) return;
  _ingresoChanges = {};
  // Re-render from current data
  if (_ingresoData) renderIngresoTable(_ingresoData);
}

// ── Init ───────────────────────────────────────────────────────────────────────
checkAuth();
loadFromStorage();
initWa();
loadHistory();
