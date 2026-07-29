/* =========================================================================
   Compila el Plan Nacional de Numeración → pnn-data.js
   -------------------------------------------------------------------------
     npm run build:pnn                    (usa el pnn_*.csv de la raíz)
     npm run build:pnn -- otro-archivo.csv

   El CSV del IFT trae ~178,000 rangos y pesa 15 MB: demasiado para subirlo
   a Vercel y para parsearlo en cada arranque. Pero la mayoría de los rangos
   son contiguos entre sí, así que al fusionarlos quedan ~22,500 intervalos.
   Eso, delta-codificado en base 36, cabe en ~170 KB.

   El CSV crudo NO se commitea (está en .gitignore); el generado sí. Para
   actualizar: bajar el CSV nuevo del IFT, correr esto, commitear pnn-data.js.

   Fuente: https://sns.ift.org.mx:8081/sns-frontend/planes-numeracion/descarga-publica.xhtml
   ======================================================================== */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

// Columnas del CSV: ZONA, NUMERACION_INICIAL, NUMERACION_FINAL, OCUPACION,
// MODALIDAD, RAZON_SOCIAL, FECHA_ASIGNACION
const INICIAL = 1;
const FINAL = 2;
const MODALIDAD = 4;

// CPP y MPP son las dos modalidades móviles; FIJO es todo lo demás. La
// portabilidad no mueve un número de rango, así que esta distinción sigue
// siendo confiable aunque la operadora ya no sea la que dice el archivo.
const MOVIL = new Set(["CPP", "MPP"]);

const csvPath = process.argv[2] ? join(process.cwd(), process.argv[2]) : findCsv();
const csv = readFileSync(csvPath, "utf8");

const todos = [];
const moviles = [];
let filas = 0;

// Se parte por comas a secas: RAZON_SOCIAL sí trae comas entrecomilladas,
// pero está después de las columnas que nos interesan y nunca las corre.
for (const linea of csv.split("\n").slice(1)) {
  const c = linea.split(",");
  if (c.length < 5) continue;

  const ini = Number(c[INICIAL]);
  const fin = Number(c[FINAL]);
  if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin < ini) continue;

  filas++;
  todos.push([ini, fin]);
  if (MOVIL.has(c[MODALIDAD].trim())) moviles.push([ini, fin]);
}

if (!filas) {
  console.error(`Sin filas usables en ${csvPath}. ¿Cambió el formato del CSV?`);
  process.exit(1);
}

const blobTodos = encode(fusionar(todos));
const blobMoviles = encode(fusionar(moviles));

const salida = `/* =========================================================================
   GENERADO — no editar a mano. Se rehace con: npm run build:pnn
   -------------------------------------------------------------------------
   Plan Nacional de Numeración, rangos asignados, fusionados y delta-
   codificados en base 36 como pares "salto,largo":

       salto — cuántos números hay entre el fin del intervalo anterior y
               el inicio de éste
       largo — cuántos números abarca

   Lo expande y lo consulta pnn.js. Ver tools/build-pnn.mjs.

   Fuente:  ${csvPath.split("/").pop()}
   Generado: ${new Date().toISOString().slice(0, 10)}
   Rangos del archivo: ${filas.toLocaleString("es-MX")}
   Intervalos tras fusionar: ${blobTodos.n.toLocaleString("es-MX")} (móviles: ${blobMoviles.n.toLocaleString("es-MX")})
   ======================================================================== */

export const TODOS = "${blobTodos.blob}";

export const MOVILES = "${blobMoviles.blob}";
`;

writeFileSync(join(ROOT, "pnn-data.js"), salida);

console.log(`  ${filas.toLocaleString("es-MX")} rangos leídos de ${csvPath.split("/").pop()}`);
console.log(`  ${blobTodos.n.toLocaleString("es-MX")} intervalos (${blobMoviles.n.toLocaleString("es-MX")} móviles)`);
console.log(`  pnn-data.js — ${Math.round(salida.length / 1024)} KB`);

/* ---------------------------------------------------------------------- */

/* Los rangos vienen desordenados y muchos son colindantes (…4999 seguido de
   …5000). Ordenarlos y pegar los que se tocan es lo que baja 178,000 a
   22,500. `s <= fin + 1` pega también los adyacentes, no solo los que se
   traslapan. */
function fusionar(rangos) {
  rangos.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of rangos) {
    const ultimo = out[out.length - 1];
    if (ultimo && s <= ultimo[1] + 1) ultimo[1] = Math.max(ultimo[1], e);
    else out.push([s, e]);
  }
  return out;
}

function encode(intervalos) {
  const partes = [];
  let prev = 0;
  for (const [s, e] of intervalos) {
    partes.push((s - prev).toString(36), (e - s + 1).toString(36));
    prev = e + 1;
  }
  return { blob: partes.join(","), n: intervalos.length };
}

/* El nombre del CSV trae la fecha de publicación, así que cambia cada vez.
   Se busca por patrón en vez de exigir un nombre fijo. */
function findCsv() {
  const encontrados = readdirSync(ROOT).filter((f) => /^pnn_.*\.csv$/i.test(f));
  if (!encontrados.length) {
    console.error(`No hay ningún pnn_*.csv en ${ROOT}. Bájalo del IFT o pasa la ruta como argumento.`);
    process.exit(1);
  }
  return join(ROOT, encontrados.sort().pop());
}
