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
async function checkAuth() {
  const { authenticated } = await fetch(API + 'api/auth-status').then(r => r.json());
  document.getElementById('authNeeded').classList.toggle('hidden', authenticated);
  document.getElementById('authOk').classList.toggle('hidden', !authenticated);
  if (new URLSearchParams(location.search).get('auth') === 'ok')
    history.replaceState({}, '', location.pathname);
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
        <span class="ml-2 text-xs text-gray-400 font-mono truncate">${esc(shortUrl(url))}</span>
      </div>
      <div class="flex gap-2 ml-2">
        ${first.materia
          ? `<span class="text-xs text-indigo-600 font-medium">${esc(first.materia)}</span>`
          : ''}
        <button onclick="deleteSheetGroup('${esc(url)}')"
          class="text-gray-300 hover:text-red-400 text-sm" title="Eliminar esta hoja y todos sus tabs">✕</button>
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
  const rawUrl  = document.getElementById('newSheetUrl').value.trim();
  const materia = document.getElementById('newSheetMateria').value.trim();
  const url     = rawUrl.replace(/[?#].*$/, '').trim();
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
        tabName:     tab,
        materia:     materia || '',
        contactTab:  res.contactTab || 'Contacto',
        institution: res.format || '',
        contenidos:  '',
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
  const gradeCol = tt.columns[tt.columns.length - 1]; // last col = grade/promedio
  const rows = tt.data.map(row => {
    const grade = parseFloat(row[gradeCol]) || 0;
    const low   = grade > 0 && grade < 7;
    return `<tr class="${low ? 'bg-red-50' : ''}">
      ${tt.columns.map(c => {
        const isGrade = c === gradeCol;
        return `<td class="border border-gray-200 px-2 py-1 text-xs ${isGrade ? 'font-bold text-center ' + (low ? 'text-red-700' : 'text-green-700') : 'text-gray-700'}">${esc(row[c] || '')}</td>`;
      }).join('')}
    </tr>`;
  }).join('');

  return `
    <p class="text-xs font-semibold text-gray-500 mb-1">${esc(tt.label || '')} — ${tt.data.length} estudiantes</p>
    <div class="overflow-x-auto rounded-xl border border-gray-200 mb-2">
      <table class="w-full text-xs border-collapse">
        <thead class="bg-gray-100 sticky top-0">
          <tr>${tt.columns.map(c => `<th class="border border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-600 whitespace-nowrap">${esc(c)}</th>`).join('')}</tr>
        </thead>
        <tbody>${rows}</tbody>
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
    const contenidos = sheetData[g.sheetId]?.contenidos || '';
    return {
      dropdownOption: g.dropdownOption,
      docente,
      materia:    g.materia,
      contenidos,
      acciones,
      dificultades: g.dificultades,
      formText:   buildFormText(contenidos, g.dificultades, acciones),
    };
  });

  try {
    const res = await fetch(API + 'api/submit-forms', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ submissions, formUrl, formFields }),
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

    // Reload ALL sheets in background (not just enabled)
    for (const sheet of savedSheets) {
      loadSheetData(sheet.id); // fire and forget
    }
  } catch(e) {}
}

document.getElementById('formUrl').addEventListener('input', save);

// ── Init ───────────────────────────────────────────────────────────────────────
checkAuth();
loadFromStorage();
