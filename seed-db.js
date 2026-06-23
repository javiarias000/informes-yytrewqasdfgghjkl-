// seed-db.js — Populates conservatorio.db from:
//   1. DATOS DOCENTES 2025 Conservatorio Bolívar.xlsx  → tabla docentes
//   2. Tutores por curso extraídos del Google Form     → tablas cursos + tutores_cursos
//
// Run: node seed-db.js
// Safe to re-run: uses UPSERT / INSERT OR IGNORE semantics

const path        = require('path');
const fs          = require('fs');
const XLSX        = require('xlsx');
const { getDb, upsertDocente, upsertCurso, linkTutorCurso } = require('./db');

// ──────────────────────────────────────────────
// 1. Datos de cursos + tutores (Google Form)
// ──────────────────────────────────────────────
// Fuente: https://forms.gle/qsWAZqp53ePtswCZ7
// "Informe de maestros para juntas de curso 2o quimestre" — Conservatorio Bolívar de Ambato
const TUTORES_FORM = [
  // Paralelo A
  { nombre: '1o A',               anio: 1,  paralelo: 'A', nivel: 'Básica Superior', tutor: 'Larreátegui Feijoó Inés María'       },
  { nombre: '2o A',               anio: 2,  paralelo: 'A', nivel: 'Básica Superior', tutor: 'Laura Guaman Christian Daniel'        },
  { nombre: '3o A',               anio: 3,  paralelo: 'A', nivel: 'Básica Superior', tutor: 'Túquerez Nuñez Diego Javier'          },
  { nombre: '4o A',               anio: 4,  paralelo: 'A', nivel: 'Básica Superior', tutor: 'Solis Solis Juan Francisco'           },
  { nombre: '5o A',               anio: 5,  paralelo: 'A', nivel: 'Básica Superior', tutor: 'Solis Solis Juan Francisco'           },
  { nombre: '7o A',               anio: 7,  paralelo: 'A', nivel: 'Básica Superior', tutor: 'Amancha Hidalgo Félix Marcelo'        },
  { nombre: '8o A',               anio: 8,  paralelo: 'A', nivel: 'Básica Superior', tutor: 'Quinapanta Tibán Angel Rodrigo'       },
  { nombre: '9o Año (1o Bach) A', anio: 9,  paralelo: 'A', nivel: 'Bachillerato',    tutor: 'Arévalo Castañeda Angel Jorge'        },
  { nombre: '10o Año (2o Bach) A',anio: 10, paralelo: 'A', nivel: 'Bachillerato',    tutor: 'Chicaiza Yanez Jeferson Alexander'   },
  { nombre: '11o Año (3o Bach) A',anio: 11, paralelo: 'A', nivel: 'Bachillerato',    tutor: 'Guananga Aysabucha Santiago Javier'  },
  // Paralelo B
  { nombre: '1o B',               anio: 1,  paralelo: 'B', nivel: 'Básica Superior', tutor: 'Reyes Garcés Elizabeth del Roció'    },
  { nombre: '2o B',               anio: 2,  paralelo: 'B', nivel: 'Básica Superior', tutor: 'Amores Valdivieso Jenny'             },
  { nombre: '3o B',               anio: 3,  paralelo: 'B', nivel: 'Básica Superior', tutor: 'Peña Nuñez Andrea Michelle'          },
  { nombre: '4o B',               anio: 4,  paralelo: 'B', nivel: 'Básica Superior', tutor: 'Guzñay Paca Inti Rafael'             },
  { nombre: '5o B',               anio: 5,  paralelo: 'B', nivel: 'Básica Superior', tutor: 'De la Cruz Changalombo Jorge Ramiro' },
  { nombre: '6o B',               anio: 6,  paralelo: 'B', nivel: 'Básica Superior', tutor: 'Acosta Zagal Karolina de los Angeles'},
  { nombre: '7o B',               anio: 7,  paralelo: 'B', nivel: 'Básica Superior', tutor: 'Toapanta Arequipa Danny Alexander'   },
  { nombre: '8o B',               anio: 8,  paralelo: 'B', nivel: 'Básica Superior', tutor: 'Peralta Aponte Christian'            },
  { nombre: '9o Año (1o Bach) B', anio: 9,  paralelo: 'B', nivel: 'Bachillerato',    tutor: 'Chicaiza Cuenca Rubén Geovany'       },
  { nombre: '10o Año (2o Bach) B',anio: 10, paralelo: 'B', nivel: 'Bachillerato',    tutor: 'Chico Espinoza Edwin Patricio'       },
  { nombre: '11o Año (3o Bach) B',anio: 11, paralelo: 'B', nivel: 'Bachillerato',    tutor: 'Tocto Villarreal Marco Antonio'      },
  // Paralelo C
  { nombre: '1o C',               anio: 1,  paralelo: 'C', nivel: 'Básica Superior', tutor: 'Paredes Santana Marco Antonio'       },
  { nombre: '2o C',               anio: 2,  paralelo: 'C', nivel: 'Básica Superior', tutor: 'Nuñez Cunalata Zoila Delia'          },
  { nombre: '3o C',               anio: 3,  paralelo: 'C', nivel: 'Básica Superior', tutor: 'Fonseca Sandoval Walter Guillermo'   },
  { nombre: '4o C',               anio: 4,  paralelo: 'C', nivel: 'Básica Superior', tutor: 'Chico Analuisa Fabricio Renato'      },
  { nombre: '5o C',               anio: 5,  paralelo: 'C', nivel: 'Básica Superior', tutor: 'Pérez Mayorga Edwin Israel'          },
  { nombre: '6o C',               anio: 6,  paralelo: 'C', nivel: 'Básica Superior', tutor: 'Caiza Caiza Roberto Carlos'          },
  { nombre: '7o C',               anio: 7,  paralelo: 'C', nivel: 'Básica Superior', tutor: 'Gutama Galán Juan Diego'             },
  { nombre: '8o C',               anio: 8,  paralelo: 'C', nivel: 'Básica Superior', tutor: 'Zumbana Quinapanta Santiago Maximiliano' },
  { nombre: '10o Año (2o Bach) C',anio: 10, paralelo: 'C', nivel: 'Bachillerato',    tutor: 'Jiménez Vega Mauricio Marmonte'     },
];

// ──────────────────────────────────────────────
// Name normalization for fuzzy matching
// Removes accents, lowercases, sorts tokens alphabetically
// so "Jenny Amores Valdivieso" matches "Amores Valdivieso Jenny"
// ──────────────────────────────────────────────
function normTokens(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // remove accents
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .sort();
}

function tokenOverlap(a, b) {
  const sa = new Set(normTokens(a));
  return normTokens(b).filter(t => sa.has(t)).length;
}

// Find best docente match for a tutor name string
function findBestMatch(tutorName, docenteList) {
  let best = null, bestScore = 0;
  for (const d of docenteList) {
    const score = tokenOverlap(tutorName, d.nombre);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return bestScore >= 2 ? best : null;
}

// ──────────────────────────────────────────────
// Read DATOS DOCENTES xlsx
// ──────────────────────────────────────────────
function readDocentesXlsx() {
  const dir   = path.join(__dirname, 'Datos');
  const found = fs.readdirSync(dir).find(f => f.includes('DOCENTES'));
  if (!found) { console.warn('⚠️  DATOS DOCENTES xlsx not found — skip xlsx seed'); return []; }
  const wb   = XLSX.readFile(path.join(dir, found));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['GENERAL'], { header: 1, defval: '' });

  function normalizePhone(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('593')) return digits;
    if (digits.startsWith('0'))   return '593' + digits.slice(1);
    if (digits.length === 9)      return '593' + digits;
    return digits;
  }

  const docentes = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    const nombre = String(r[1] || '').trim();
    if (!nombre) continue;
    docentes.push({
      nombre,
      cargo:                String(r[4] || '').trim() || null,
      correoInstitucional:  String(r[5] || '').trim() || null,
      correoPersonal:       String(r[6] || '').trim() || null,
      celular:              normalizePhone(r[7]),
      fuente:               'xlsx',
    });
  }
  return docentes;
}

// ──────────────────────────────────────────────
// Main seed
// ──────────────────────────────────────────────
(async () => {
  console.log('\n📦 Iniciando seed de base de datos Conservatorio Bolívar...\n');

  // Step 1: seed docentes from XLSX
  console.log('── Paso 1: Docentes desde DATOS DOCENTES.xlsx ──');
  const xlsxDocentes = readDocentesXlsx();
  const insertedDocentes = [];
  for (const d of xlsxDocentes) {
    const rec = await upsertDocente(d);
    insertedDocentes.push(rec);
    console.log(`  ✅ ${rec.nombre}`);
  }
  console.log(`\n  → ${insertedDocentes.length} docentes insertados/actualizados\n`);

  // Step 2: seed courses + tutors from Google Form data
  console.log('── Paso 2: Cursos y tutores desde Google Form ──');
  const report = { matched: [], unmatched: [] };

  for (const entry of TUTORES_FORM) {
    // Insert or find the curso
    const curso = await upsertCurso({
      nombre:   entry.nombre,
      anio:     entry.anio,
      paralelo: entry.paralelo,
      nivel:    entry.nivel,
    });

    // Fuzzy-match tutor name against the docente list
    const refreshed = [...insertedDocentes];
    let docenteRec = findBestMatch(entry.tutor, refreshed);

    if (!docenteRec) {
      // Insert tutor as new docente (fuente: 'form') so the link can be made
      console.log(`  ⚠️  No match para tutor "${entry.tutor}" → insertando como nuevo docente`);
      docenteRec = await upsertDocente({ nombre: entry.tutor, fuente: 'form' });
      insertedDocentes.push(docenteRec);
    }

    await linkTutorCurso({ cursoId: curso.id, docenteId: docenteRec.id });

    const matched = docenteRec.fuente !== 'form';
    report[matched ? 'matched' : 'unmatched'].push({
      curso:  entry.nombre,
      tutor:  entry.tutor,
      docente: docenteRec.nombre,
    });

    const icon = matched ? '🔗' : '🆕';
    console.log(`  ${icon} ${entry.nombre.padEnd(22)} ← ${entry.tutor}`);
    if (matched && entry.tutor !== docenteRec.nombre) {
      console.log(`       → matched con: ${docenteRec.nombre}`);
    }
  }

  // Summary
  console.log('\n── Resumen ──');
  console.log(`  ✅ ${report.matched.length} tutores vinculados a docentes existentes (xlsx)`);
  console.log(`  🆕 ${report.unmatched.length} tutores nuevos (no estaban en xlsx)`);

  if (report.unmatched.length) {
    console.log('\n  Tutores insertados como nuevos (revisar manualmente):');
    report.unmatched.forEach(r => console.log(`    • ${r.tutor} (${r.curso})`));
  }

  console.log('\n✅ Seed completado. Base de datos: conservatorio.db\n');
  process.exit(0);
})();
