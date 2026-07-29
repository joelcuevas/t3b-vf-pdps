/* =========================================================================
   Clasificación de teléfonos contra el Plan Nacional de Numeración
   -------------------------------------------------------------------------
   Responde si un número de 10 dígitos cae en algún rango que el IFT tenga
   asignado a una operadora, y si ese rango es móvil o fijo. Las etiquetas
   que devuelve son las que se ven en la hoja: "Móvil", "Fijo", "Inválido".

   Lo que NO dice: si la línea existe, si está activa o de quién es. El PNN
   asigna bloques a operadoras, no números a personas. Sirve para separar
   tecleos y números inventados de números plausibles — nada más.

   Los datos salen de pnn-data.js, que genera tools/build-pnn.mjs.
   ======================================================================== */

import { TODOS, MOVILES } from "./pnn-data.js";

/* Se expande al cargar el módulo: ~7 ms una sola vez por instancia de la
   función, contra ~65 ns por consulta. En una instancia caliente el costo
   de clasificar un lead es cero comparado con el POST a Apps Script. */
const todos = expand(TODOS);
const moviles = expand(MOVILES);

/* Devuelve "Móvil", "Fijo" o "Inválido" — tal cual se escriben en la hoja.

   "Inválido" cubre los dos modos de fallo: que el número no caiga en ningún
   rango asignado, y que no traiga 10 dígitos. El segundo no llega a la hoja
   porque api/lead.js lo rechaza antes con un 400, así que en la práctica la
   columna solo distingue asignado de no asignado. */
export function clasificar(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length !== 10) return "Inválido";

  const n = Number(d);
  // MOVILES es subconjunto de TODOS, así que basta una búsqueda para la
  // mayoría de los casos: si es móvil, ya no hay que mirar el otro índice.
  if (contiene(moviles, n)) return "Móvil";
  if (contiene(todos, n)) return "Fijo";
  return "Inválido";
}

/* ---------------------------------------------------------------------- */

/* Pares "salto,largo" en base 36 → dos arrays paralelos de inicios y fines.
   Float64Array y no Int32Array: un número nacional de 10 dígitos pasa de
   los 2,147,483,647 que aguanta un int32. */
function expand(blob) {
  const t = blob.split(",");
  const n = t.length / 2;
  const ini = new Float64Array(n);
  const fin = new Float64Array(n);

  let prev = 0;
  for (let i = 0; i < n; i++) {
    const s = prev + parseInt(t[i * 2], 36);
    const e = s + parseInt(t[i * 2 + 1], 36) - 1;
    ini[i] = s;
    fin[i] = e;
    prev = e + 1;
  }
  return { ini, fin, n };
}

/* Búsqueda binaria sobre intervalos disjuntos y ordenados. */
function contiene(tabla, x) {
  let lo = 0;
  let hi = tabla.n - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (x < tabla.ini[m]) hi = m - 1;
    else if (x > tabla.fin[m]) lo = m + 1;
    else return true;
  }
  return false;
}
