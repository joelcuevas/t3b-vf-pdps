/* =========================================================================
   Apps Script — receptor de leads
   -------------------------------------------------------------------------
   Pegar en la hoja: Extensiones → Apps Script → reemplazar Código.gs.

   Hoja nueva: corre initSheet() UNA VEZ desde el editor y te crea la pestaña
   "Leads" con sus encabezados. Después agrega a la derecha las columnas de
   seguimiento que quieras (estatus, notas, quién llamó…): el script nunca
   las toca porque busca cada campo por NOMBRE de encabezado, no por posición.

   Hoja QUE YA EXISTE con datos: corre migrateSheet() UNA VEZ. Renombra
   created_at → submitted_at e inserta scanned_at. NO corras initSheet(): esa
   escribe encabezados por posición y te pisaría la primera columna propia.

   ⚠️ Una fila se escribe en DOS momentos:
       1. al abrir la ficha  → action "scan":   id, scanned_at y el contexto
                                                 (tienda, producto, utm)
       2. al enviar teléfono → action "submit": completa esa misma fila
   Por eso una fila con scanned_at y sin submitted_at es normal: alguien
   escaneó el QR y no dejó su teléfono. Son la mayoría.

   Implementar → Nueva implementación → Aplicación web
       Ejecutar como:      Yo
       Quién tiene acceso: Cualquier persona
   "Cualquier persona" hace pública SOLO esta URL, no la hoja. La hoja
   conserva sus permisos: solo la ve quien tú compartas. Este endpoint
   escribe y responde {ok, id, row} — nunca lee ni devuelve datos de la hoja.

   ⚠️ Cada vez que edites este código hay que crear una NUEVA VERSIÓN de la
   implementación (Implementar → Gestionar implementaciones → editar → Versión:
   Nueva). Si solo guardas, la URL /exec sigue sirviendo el código viejo.
   ======================================================================== */

// Debe coincidir con la variable SHEET_SECRET en Vercel.
const SECRET = "PEGA_AQUI_EL_MISMO_SECRETO_QUE_EN_VERCEL";

const SHEET_NAME = "Leads";

// Déjalo vacío si el script está DENTRO de la hoja (Extensiones → Apps Script).
// Si lo creaste como proyecto suelto desde script.google.com, pega aquí el id
// de la hoja: es el tramo largo de su URL, entre /d/ y /edit.
const SHEET_ID = "";

/* Un proyecto suelto no tiene "hoja activa": getActiveSpreadsheet() devuelve
   null y todo revienta con un error poco claro. Esto lo dice explícito. */
function getSS() {
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error(
      "No hay hoja activa. Este script no está ligado a ninguna hoja de " +
      "cálculo. Ábrelo desde la hoja (Extensiones → Apps Script) o pon el id " +
      "de la hoja en la constante SHEET_ID."
    );
  }
  return ss;
}

// Columnas que escribe el script, en el orden en que las crea initSheet().
// Las que agregues para seguimiento (estatus, notas, quién llamó…) van
// DESPUÉS de éstas y nunca se tocan.
const FIELDS = [
  "id",
  "scanned_at",    // abrió la ficha; es el escaneo del QR
  "submitted_at",  // mandó su teléfono. Vacío = escaneó y no envió
  "phone",
  "phone_valid",   // "Móvil" / "Fijo" / "Inválido", contra el PNN del IFT
  "store_id",
  "store_name",
  "product_id",
  "product_name",
  "utm_source",    // de la URL
  "utm_campaign",  // variante de landing; la fija el servidor
  "user_input_1",  // monto quincenal del botón elegido, en pesos (480)
  "user_input_2",  // quincenas de ese botón (4 / 8 / 12)
];

// Lo que se conoce al abrir la ficha. El resto todavía no existe: el cliente
// no ha elegido plazo ni ha escrito su teléfono.
const SCAN_FIELDS = [
  "id",
  "scanned_at",
  "store_id",
  "store_name",
  "product_id",
  "product_name",
  "utm_source",
  "utm_campaign",
];

// Lo que agrega el envío sobre la fila que ya existe. NO incluye las de
// SCAN_FIELDS: reescribirlas dejaría al envío pisar el contexto del escaneo.
const SUBMIT_FIELDS = [
  "submitted_at",
  "phone",
  "phone_valid",
  "user_input_1",
  "user_input_2",
];

// Encabezados anteriores que se siguen aceptando. Sin esto, renombrar una
// columna hace que su dato deje de escribirse sin ningún error visible: el
// resto de la fila entra bien y solo esa celda queda vacía.
const LEGACY_HEADERS = {
  utm_source: ["utm"],
  submitted_at: ["created_at"],
};

// Caché del siguiente id y la siguiente fila. Antes se leía la columna 'id'
// completa en cada escritura; eso costaba una lectura por lead. Ahora hay una
// escritura por ESCANEO, que son bastantes más, y esa lectura se nota.
const PROP_ROW = "next_row";
const PROP_ID = "last_id_num";

/* Devuelve la columna de un campo, aceptando su encabezado anterior. */
function columnFor(headers, field) {
  let col = headers.indexOf(field);
  if (col === -1) {
    const aliases = LEGACY_HEADERS[field] || [];
    for (let i = 0; i < aliases.length && col === -1; i++) {
      col = headers.indexOf(aliases[i]);
    }
  }
  return col + 1;
}

function doPost(e) {
  // Serializa las escrituras: dos leads simultáneos no pueden tomar el mismo
  // id ni la misma row.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json({ ok: false, error: "busy" });
  }

  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== SECRET) return json({ ok: false, error: "unauthorized" });

    const sh = getSS().getSheetByName(SHEET_NAME);
    if (!sh) return json({ ok: false, error: "missing_sheet_" + SHEET_NAME });

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

    // 1. Escaneo: abre la fila con el contexto y devuelve dónde quedó.
    if (d.action === "scan") {
      return json(appendRow(sh, headers, d, SCAN_FIELDS, { scan: true }));
    }

    // 2. Envío sobre una fila existente.
    if (d.action === "submit" && d.id) {
      const r = updateRow(sh, headers, d);
      if (r) return json(r);
      // No se encontró la fila (hoja limpiada, id de una implementación
      // anterior). Cae al append de abajo: mejor una fila suelta que perder
      // el lead.
    }

    // 3. Append completo. Es el camino cuando el escaneo no llegó a
    //    escribirse, y el que usaba la versión anterior del handler.
    return json(appendRow(sh, headers, d, FIELDS, { submit: true }));
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* -------------------------------------------------------------------------
   Escritura
   ---------------------------------------------------------------------- */

/* Valores de TODOS los campos. Cuál se escribe lo decide la lista `fields`
   que recibe writeFields(), no este objeto. */
function buildValues(d, id, opts) {
  return {
    id: id,
    // Solo lo estampa el escaneo. En el append de respaldo se deja vacío a
    // propósito: ahí el escaneo ocurrió minutos antes y no se registró, así
    // que poner la hora del envío sería inventar el dato. Vacío = no se sabe.
    scanned_at: opts.scan ? new Date() : "",
    submitted_at: opts.submit ? new Date() : "",
    phone: "'" + String(d.phone || ""), // apóstrofo: conserva el 0 inicial
    // Lo calcula api/lead.js contra el Plan Nacional de Numeración. Si
    // llegara vacío es que el lead lo mandó una versión vieja del handler.
    phone_valid: String(d.phone_valid || ""),
    store_id: String(d.store_id || ""),
    store_name: String(d.store_name || ""),
    product_id: String(d.product_id || ""),
    product_name: String(d.product_name || ""),
    utm_source: String(d.utm_source || ""),
    utm_campaign: String(d.utm_campaign || ""),
    // Número, no texto: son pesos y quincenas, y en la hoja se suman y se
    // promedian.
    user_input_1: numberOrBlank(d.user_input_1),
    user_input_2: numberOrBlank(d.user_input_2),
  };
}

/* Escribe celda por celda buscando cada field por NOMBRE de encabezado. Así
   puedes reordenar o insertar columnas sin romper nada. */
function writeFields(sh, headers, row, values, fields) {
  const omitidos = [];
  fields.forEach(function (field) {
    const col = columnFor(headers, field);
    if (col > 0) sh.getRange(row, col).setValue(values[field]);
    else omitidos.push(field);
  });

  // Si la hoja no tiene alguna columna, el dato se pierde sin avisar.
  // Queda en el registro de ejecuciones para poder verlo.
  if (omitidos.length) {
    Logger.log("Sin columna en la hoja, no se escribieron: %s", omitidos.join(", "));
  }
}

function appendRow(sh, headers, d, fields, opts) {
  const res = reserveRow(sh, headers);
  writeFields(sh, headers, res.row, buildValues(d, res.id, opts), fields);
  commitReservation(res);
  SpreadsheetApp.flush();
  // `row` viaja de regreso para que el envío no tenga que buscar la fila:
  // api/lead.js lo firma junto con el id y lo devuelve tal cual.
  return { ok: true, id: res.id, row: res.row };
}

/* Completa el escaneo que ya está en la hoja. Devuelve null si esa fila no
   existe, para que el llamador caiga al append. */
function updateRow(sh, headers, d) {
  const idCol = columnFor(headers, "id");
  if (idCol === 0) throw new Error("la row 1 no tiene la columna 'id'");

  const row = locateRow(sh, idCol, d.id, d.row);
  if (!row) return null;

  // Un envío solo puede completar un escaneo PENDIENTE. Si la fila ya tiene
  // submitted_at es un reenvío (o alguien probando ids): se ignora en vez de
  // pisar un lead que ya está capturado. Responde ok para no disparar los
  // reintentos de api/lead.js, que aquí no arreglarían nada.
  const subCol = columnFor(headers, "submitted_at");
  if (subCol > 0) {
    const ya = sh.getRange(row, subCol).getValue();
    if (ya !== "" && ya !== null) {
      Logger.log("Envío duplicado sobre %s (fila %s), ignorado.", d.id, row);
      return { ok: true, id: d.id, row: row, status: "already_submitted" };
    }
  }

  writeFields(sh, headers, row, buildValues(d, d.id, { submit: true }), SUBMIT_FIELDS);
  SpreadsheetApp.flush();
  return { ok: true, id: d.id, row: row };
}

/* La fila que dice el cliente, confirmada contra la columna 'id'. Si no
   coincide —insertaron o borraron filas a mano— se busca de verdad. */
function locateRow(sh, idCol, id, hint) {
  const n = Number(hint);
  if (n > 1 && n <= sh.getMaxRows() && String(sh.getRange(n, idCol).getValue()) === String(id)) {
    return n;
  }
  return findRowById(sh, idCol, id);
}

function findRowById(sh, idCol, id) {
  const vals = sh.getRange(1, idCol, sh.getMaxRows(), 1).getValues();
  // De abajo hacia arriba: el id que se busca casi siempre es de los últimos.
  for (let i = vals.length - 1; i >= 1; i--) {
    if (String(vals[i][0]) === String(id)) return i + 1;
  }
  return 0;
}

/* -------------------------------------------------------------------------
   Reserva de fila e id
   ---------------------------------------------------------------------- */

/* Siguiente fila libre y siguiente id, sin leer la columna completa.
   La caché se valida con UNA lectura de dos celdas: la fila anterior debe
   tener id y la reservada debe estar vacía. Si no cuadra —pegaron o borraron
   filas a mano, o se perdieron las propiedades— se recalcula leyendo todo. */
function reserveRow(sh, headers) {
  const idCol = columnFor(headers, "id");
  if (idCol === 0) throw new Error("la row 1 no tiene la columna 'id'");

  const props = PropertiesService.getScriptProperties();
  let row = Number(props.getProperty(PROP_ROW)) || 0;
  let num = Number(props.getProperty(PROP_ID)) || 0;

  // Una hoja nueva trae 1000 filas y se llenan rápido cuando cada escaneo
  // escribe: setValue() más abajo de getMaxRows() revienta.
  if (row === sh.getMaxRows() + 1) sh.insertRowsAfter(sh.getMaxRows(), 500);

  if (!cacheOk(sh, idCol, row)) {
    row = lastRowWithId(sh, idCol) + 1;
    num = lastIdNum(sh, idCol);
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
  }

  return { row: row, id: "L-" + String(num + 1).padStart(6, "0"), num: num + 1 };
}

/* Se guarda DESPUÉS de escribir: si la escritura falla, la reserva no se
   consume y el siguiente lead reusa esa fila y ese id. */
function commitReservation(res) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PROP_ROW, String(res.row + 1));
  props.setProperty(PROP_ID, String(res.num));
}

function cacheOk(sh, idCol, row) {
  if (row <= 1 || row > sh.getMaxRows()) return false;
  const v = sh.getRange(row - 1, idCol, 2, 1).getValues();
  const anterior = v[0][0], reservada = v[1][0];
  return anterior !== "" && anterior !== null &&
         (reservada === "" || reservada === null);
}

/* Última row que tiene algo en la columna `id`. No getLastRow(): si alguien
   arrastró una fórmula en una columna de seguimiento, getLastRow() apuntaría
   demasiado abajo y dejaría un hueco de filas vacías. */
function lastRowWithId(sh, idCol) {
  const total = sh.getMaxRows();
  const vals = sh.getRange(1, idCol, total, 1).getValues();
  for (let i = total - 1; i >= 0; i--) {
    if (vals[i][0] !== "" && vals[i][0] !== null) return i + 1;
  }
  return 1; // solo el encabezado
}

/* Ids secuenciales legibles: L-000001, L-000002… */
function lastIdNum(sh, idCol) {
  const row = lastRowWithId(sh, idCol);
  if (row <= 1) return 0;
  const ultimo = String(sh.getRange(row, idCol).getValue());
  return parseInt(ultimo.replace(/\D/g, ""), 10) || 0;
}

/* Celda numérica, o vacía si no llegó nada usable. Devolver "" en vez de 0
   evita que un lead sin dato se cuente como un pago de cero. */
function numberOrBlank(v) {
  if (v === undefined || v === null || v === "") return "";
  const n = Number(v);
  return isNaN(n) ? "" : n;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* -------------------------------------------------------------------------
   Ejecuta esto UNA VEZ desde el editor para crear la hoja con sus
   encabezados en el orden correcto.

   ⚠️ En una hoja QUE YA EXISTE no lo corras si tienes columnas propias de
   seguimiento: escribe los encabezados en las columnas 1..FIELDS.length y
   pisaría la primera de las tuyas. Para una hoja con datos usa migrateSheet().
   ---------------------------------------------------------------------- */
function initSheet() {
  const ss = getSS();
  Logger.log("Hoja de cálculo: %s", ss.getName());

  let sh = ss.getSheetByName(SHEET_NAME);
  if (sh) {
    Logger.log("La pestaña '%s' ya existía; se actualizan sus encabezados.", SHEET_NAME);
  } else {
    sh = ss.insertSheet(SHEET_NAME);
    Logger.log("Pestaña '%s' creada.", SHEET_NAME);
  }

  sh.getRange(1, 1, 1, FIELDS.length).setValues([FIELDS]).setFontWeight("bold");
  sh.setFrozenRows(1);
  formatDateColumns(sh);
  ss.setSpreadsheetTimeZone("America/Mexico_City");
  resetCache();
  SpreadsheetApp.flush();

  Logger.log("Listo. Columnas: %s", FIELDS.join(" · "));
  Logger.log("Pestañas ahora: %s",
    ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
}

/* -------------------------------------------------------------------------
   Hoja que YA tiene datos: corre esto UNA VEZ. Es idempotente, correrlo de
   más no hace nada.

     created_at → submitted_at   solo el rótulo; el dato que guardaba era
                                 justo la hora del envío, así que sigue siendo
                                 exacto.
     scanned_at                  columna nueva, antes de submitted_at. Queda
                                 VACÍA en las filas anteriores: de esos leads
                                 nunca se midió el escaneo, y rellenarla con
                                 el envío falsearía el tiempo entre uno y otro.

   Las columnas de seguimiento se recorren una posición a la derecha. Sus
   fórmulas se ajustan solas y el script las sigue ignorando.
   ---------------------------------------------------------------------- */
function migrateSheet() {
  const sh = getSS().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error("No existe la pestaña '" + SHEET_NAME + "'.");

  let headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  const viejo = headers.indexOf("created_at");
  if (viejo !== -1) {
    sh.getRange(1, viejo + 1).setValue("submitted_at");
    Logger.log("Renombrada: created_at → submitted_at (columna %s).", viejo + 1);
  } else if (headers.indexOf("submitted_at") === -1) {
    throw new Error("No encuentro ni 'created_at' ni 'submitted_at' en la fila 1.");
  } else {
    Logger.log("'submitted_at' ya existía, no se renombró nada.");
  }

  headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  if (headers.indexOf("scanned_at") === -1) {
    const destino = headers.indexOf("submitted_at") + 1;
    sh.insertColumnBefore(destino);
    sh.getRange(1, destino).setValue("scanned_at").setFontWeight("bold");
    Logger.log("Insertada 'scanned_at' en la columna %s.", destino);
  } else {
    Logger.log("'scanned_at' ya existía, no se insertó nada.");
  }

  formatDateColumns(sh);
  resetCache();
  SpreadsheetApp.flush();

  Logger.log("Encabezados ahora: %s",
    sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].join(" · "));
}

/* Formato de fecha por NOMBRE de columna. Antes era "B:B" fijo, y con
   scanned_at de por medio esa posición ya no es la que era. */
function formatDateColumns(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  ["scanned_at", "submitted_at"].forEach(function (field) {
    const col = columnFor(headers, field);
    if (col > 0) {
      sh.getRange(2, col, sh.getMaxRows() - 1, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
    }
  });
}

/* La caché de fila/id se recalcula sola en la siguiente escritura. */
function resetCache() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_ROW);
  props.deleteProperty(PROP_ID);
}
