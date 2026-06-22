let loadedGroups = [];

const contenidosBySubject = {
  'Arreglos Musicales': () => document.getElementById('contArreglos').value.trim(),
  'Ensamble de Guitarras': () => document.getElementById('contEnsamble').value.trim(),
  'Guitarra Clásica': () => document.getElementById('contGuitarra').value.trim(),
};

// ── Auth ──────────────────────────────────────────────────────────────────────

async function checkAuth() {
  const { authenticated } = await fetch('/api/auth-status').then(r => r.json());
  document.getElementById('authNeeded').classList.toggle('hidden', authenticated);
  document.getElementById('authOk').classList.toggle('hidden', !authenticated);
  if (new URLSearchParams(location.search).get('auth') === 'ok') {
    history.replaceState({}, '', '/');
  }
}

// ── Load data ─────────────────────────────────────────────────────────────────

async function loadData() {
  const arreglosUrl = document.getElementById('arreglosUrl').value.trim();
  const ensambleUrl = document.getElementById('ensambleUrl').value.trim();
  const guitarraUrl = document.getElementById('guitarraUrl').value.trim();
  const docente = document.getElementById('docente').value.trim();

  if (!arreglosUrl || !ensambleUrl || !guitarraUrl) {
    return showError('Completa las 3 URLs de Google Sheets.');
  }
  if (!docente) return showError('Ingresa el nombre del docente.');

  setLoading('loadSpinner', 'loadBtn', true);
  document.getElementById('loadError').classList.add('hidden');
  document.getElementById('previewSection').classList.add('hidden');

  try {
    const res = await fetch('/api/load-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arreglosUrl, ensambleUrl, guitarraUrl }),
    }).then(r => r.json());

    if (!res.success) return showError('Error al leer los Sheets: ' + res.error);

    loadedGroups = res.groups;
    renderPreviews(res.groups);
  } catch (e) {
    showError('Error de red: ' + e.message);
  } finally {
    setLoading('loadSpinner', 'loadBtn', false);
  }
}

function showError(msg) {
  const el = document.getElementById('loadError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setLoading(spinnerId, btnId, on) {
  document.getElementById(spinnerId).classList.toggle('hidden', !on);
  const btn = document.getElementById(btnId);
  if (btn) btn.disabled = on;
}

// ── Preview rendering ─────────────────────────────────────────────────────────

function renderPreviews(groups) {
  const list = document.getElementById('previewList');
  list.innerHTML = '';

  let hasWarning = false;

  groups.forEach((g, idx) => {
    const noMatch = !g.dropdownOption;
    if (noMatch) hasWarning = true;

    const card = document.createElement('div');
    card.className = `bg-white rounded-2xl shadow p-4 border-l-4 ${noMatch ? 'border-yellow-400' : 'border-green-400'}`;
    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <p class="font-semibold text-gray-800 text-sm">${esc(g.materia)} &mdash; Curso: <span class="font-bold">${esc(g.curso)}</span></p>
          ${noMatch
            ? `<p class="text-yellow-700 text-xs mt-1">⚠️ Curso no encontrado en el desplegable del formulario</p>`
            : `<p class="text-green-700 text-xs mt-1">✅ ${esc(g.dropdownOption)}</p>`
          }
          <p class="text-gray-500 text-xs mt-1">${g.students.length} estudiante(s) &bull; ${g.dificultades.length} con dificultades</p>
        </div>
        <button onclick="toggleDetail(${idx})" class="text-blue-500 text-xs hover:underline ml-4 whitespace-nowrap">Ver detalle</button>
      </div>

      <div id="detail-${idx}" class="hidden mt-3 space-y-2">
        <div class="text-xs font-medium text-gray-500 uppercase tracking-wide">Estudiantes</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-1">
          ${g.students.map(s => `
            <div class="flex items-center gap-2 text-xs px-3 py-1 rounded-lg ${s.promedio < 7 ? 'bg-red-50 text-red-800' : 'bg-gray-50 text-gray-700'}">
              <span>${s.promedio < 7 ? '⚠️' : '✅'}</span>
              <span>${esc(s.nombre)}</span>
              <span class="ml-auto font-mono font-semibold">${s.promedio}</span>
            </div>
          `).join('')}
        </div>

        <div class="mt-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Texto del formulario</div>
        <pre class="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-700 whitespace-pre-wrap leading-relaxed" id="formtext-${idx}"></pre>
      </div>
    `;
    list.appendChild(card);
  });

  document.getElementById('matchWarn').classList.toggle('hidden', !hasWarning);
  document.getElementById('previewSection').classList.remove('hidden');
  document.getElementById('resultsSection').classList.add('hidden');
}

function toggleDetail(idx) {
  const el = document.getElementById(`detail-${idx}`);
  el.classList.toggle('hidden');
  if (!el.classList.contains('hidden')) {
    const g = loadedGroups[idx];
    const contenidos = contenidosBySubject[g.materia]?.() || '';
    const acciones = document.getElementById('acciones').value.trim();
    document.getElementById(`formtext-${idx}`).textContent = buildFormText(contenidos, g.dificultades, acciones);
  }
}

function buildFormText(contenidos, dificultades, acciones) {
  const lines = [];
  lines.push('1 - Contenidos trabajados en el 2do quimestre:');
  lines.push(contenidos || '(sin contenidos ingresados)');
  lines.push('');
  lines.push('2 - Apellidos y nombres del estudiante que presente dificultades académicas o faltas:');
  if (dificultades.length === 0) {
    lines.push('Ninguno');
  } else {
    dificultades.forEach(d => lines.push(`- ${d.nombre} (promedio: ${d.promedio}/10)`));
  }
  lines.push('');
  lines.push('3 - Actividades realizadas:');
  lines.push(dificultades.length === 0 ? 'No aplica' : (acciones || '(sin acciones ingresadas)'));
  return lines.join('\n');
}

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function submitForms() {
  const docente = document.getElementById('docente').value.trim();
  const acciones = document.getElementById('acciones').value.trim();

  if (!docente) return alert('Ingresa el nombre del docente antes de enviar.');

  const toSend = loadedGroups.filter(g => g.dropdownOption);
  const skipped = loadedGroups.length - toSend.length;

  const msg = `Se enviarán ${toSend.length} formulario(s)${skipped > 0 ? ` (${skipped} cursos sin coincidencia serán omitidos)` : ''}.\n¿Continuar?`;
  if (!confirm(msg)) return;

  const submissions = toSend.map(g => ({
    dropdownOption: g.dropdownOption,
    docente,
    materia: g.materia,
    formText: buildFormText(contenidosBySubject[g.materia]?.() || '', g.dificultades, acciones),
  }));

  document.getElementById('sendSpinner').classList.remove('hidden');

  try {
    const res = await fetch('/api/submit-forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissions }),
    }).then(r => r.json());

    renderResults(res.results, skipped);
  } catch (e) {
    alert('Error al enviar: ' + e.message);
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
    el.className = `flex items-center gap-3 px-4 py-3 rounded-xl text-sm ${r.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`;
    el.innerHTML = `
      <span>${r.success ? '✅' : '❌'}</span>
      <span class="flex-1 font-medium">${esc(r.label)}</span>
      ${r.error ? `<span class="text-xs opacity-70">${esc(r.error)}</span>` : ''}
    `;
    list.appendChild(el);
  });

  if (skipped > 0) {
    const el = document.createElement('div');
    el.className = 'flex items-center gap-3 px-4 py-3 rounded-xl text-sm bg-yellow-50 text-yellow-800';
    el.innerHTML = `<span>⚠️</span><span>${skipped} curso(s) omitido(s) por no coincidir con el desplegable del formulario.</span>`;
    list.appendChild(el);
  }

  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth' });
}

// ── Init ──────────────────────────────────────────────────────────────────────
checkAuth();
