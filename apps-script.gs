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

   Formato de las fechas: lo fija DATE_FORMAT. Si lo cambias, corre
   reformatDates() UNA VEZ para que las filas ya escritas también lo tomen —
   initSheet() y migrateSheet() ya lo aplican solos.

   Teléfonos bloqueados: corre initBlockSheet() UNA VEZ. Crea la pestaña
   "Bloqueados" y siembra los primeros números. De ahí en adelante agregas
   números EN LA HOJA — no aquí — y aplican solos, sin implementación nueva.
   purgeBlocked() borra los que ya estén escritos en "Leads".
   ======================================================================== */

// Debe coincidir con la variable SHEET_SECRET en Vercel.
const SECRET = "PEGA_AQUI_EL_MISMO_SECRETO_QUE_EN_VERCEL";

const SHEET_NAME = "Leads";

// Cómo se ven —y cómo se exportan— scanned_at y submitted_at. El dato guardado
// es un Date; esto es solo su presentación. Los tokens son los de Sheets en
// inglés aunque la hoja esté en español: dd día, mm mes, yy año a dos cifras,
// hh:mm hora y minuto de 24 h (mm después de hh son minutos, no meses).
const DATE_FORMAT = "dd/mm/yy HH:mm";

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
  // Se escribe en los DOS momentos y quiere decir cosas distintas según cuál:
  //   escaneo → "Bot" o vacío. NO es "malicioso": es "esta apertura no es un
  //             cliente calificable". Incluye crawlers y previews, pero
  //             también una laptop del equipo, que es legítima y aun así no
  //             es un escaneo de QR en piso de venta.
  //   envío   → "Móvil" / "Fijo" / "Inválido" contra el PNN del IFT, que es
  //             el juicio sobre el TELÉFONO.
  // El envío pisa la marca a propósito: si dejó un número, la fila ya es un
  // lead y lo que importa saber de ella es si ese número sirve.
  "phone_valid",
  "store_id",
  "store_name",
  "product_id",
  "product_name",
  "utm_source",    // de la URL
  "utm_campaign",  // variante de landing; la fija el servidor
  "user_input_1",  // monto quincenal del botón elegido, en pesos (480)
  "user_input_2",  // quincenas de ese botón (4 / 8 / 12)
  "session_id",    // lo genera el navegador; amarra el escaneo con el envío
];

// Lo que se conoce al abrir la ficha. El resto todavía no existe: el cliente
// no ha elegido plazo ni ha escrito su teléfono.
const SCAN_FIELDS = [
  "id",
  "session_id",
  "scanned_at",
  "store_id",
  "store_name",
  "product_id",
  "product_name",
  "utm_source",
  "utm_campaign",
  // Aquí lleva la marca de bot, no la del PNN: en el escaneo todavía no hay
  // teléfono que clasificar.
  "phone_valid",
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

    // La sesión es lo único que amarra las dos escrituras. Todo lo demás
    // —incluida la idempotencia— cuelga de encontrar (o no) su fila.
    const fila = findRowBySid(sh, headers, d.session_id);

    // 1. Escaneo. Repetirlo NO duplica: el navegador reintenta al recargar y
    //    api/lead.js puede reenviar un POST que en realidad sí se escribió,
    //    solo que su respuesta llegó tarde.
    if (d.action === "scan") {
      if (fila) {
        Logger.log("Escaneo repetido de %s, ya está en la fila %s.", d.session_id, fila);
        return json({ ok: true, id: sh.getRange(fila, columnFor(headers, "id")).getValue(), row: fila });
      }
      return json(appendRow(sh, headers, d, SCAN_FIELDS, { scan: true }));
    }

    // 2. Teléfono bloqueado. No se escribe nada y se borra la fila que abrió
    //    su escaneo: si el número es basura, su escaneo también lo es y solo
    //    ensucia el conteo. Responde ok a propósito — api/lead.js reintenta
    //    tres veces cuando la respuesta no es ok, y al cliente no se le avisa
    //    que está bloqueado.
    if (isBlocked(d.phone)) {
      Logger.log("Teléfono bloqueado (%s), no se registró.", normalizePhone(d.phone));
      if (fila) deleteIfSafe(sh, headers, fila, d.session_id);
      return json({ ok: true, status: "blocked" });
    }

    // 3. Envío sobre la fila del escaneo.
    if (fila) return json(updateRow(sh, headers, d, fila));

    // 4. Append completo. Es el camino cuando el escaneo no llegó a
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
    session_id: String(d.session_id || ""),
  };
}

/* Busca cada field por NOMBRE de encabezado, así puedes reordenar o insertar
   columnas sin romper nada, pero escribe el tramo COMPLETO de una sola vez.
   Cada getRange().setValue() es un viaje a Google; con 13 campos eran 13, y
   ahí se iba la mayor parte de lo que tardaba el endpoint. */
function writeFields(sh, headers, row, values, fields) {
  const cols = [], omitidos = [];
  fields.forEach(function (field) {
    const col = columnFor(headers, field);
    if (col > 0) cols.push({ col: col, field: field });
    else omitidos.push(field);
  });

  // Si la hoja no tiene alguna columna, el dato se pierde sin avisar.
  // Queda en el registro de ejecuciones para poder verlo.
  if (omitidos.length) {
    Logger.log("Sin columna en la hoja, no se escribieron: %s", omitidos.join(", "));
  }
  if (!cols.length) return;

  let min = cols[0].col, max = cols[0].col;
  const propias = {};
  cols.forEach(function (c) {
    if (c.col < min) min = c.col;
    if (c.col > max) max = c.col;
    propias[c.col] = c.field;
  });

  // El tramo puede abarcar columnas que este write no toca. Reescribirlas con
  // su propio valor es inofensivo mientras sean del script; si alguien metió
  // una columna de seguimiento EN MEDIO, una fórmula suya se congelaría en su
  // resultado. En ese caso se vuelve a escribir celda por celda.
  for (let c = min; c <= max; c++) {
    if (!propias[c] && FIELDS.indexOf(headers[c - 1]) === -1) {
      cols.forEach(function (x) { sh.getRange(row, x.col).setValue(values[x.field]); });
      return;
    }
  }

  const range = sh.getRange(row, min, 1, max - min + 1);
  const linea = range.getValues()[0];
  cols.forEach(function (c) { linea[c.col - min] = values[c.field]; });
  range.setValues([linea]);
}

function appendRow(sh, headers, d, fields, opts) {
  const res = reserveRow(sh, headers);
  writeFields(sh, headers, res.row, buildValues(d, res.id, opts), fields);
  commitReservation(res);
  rememberRow(d.session_id, res.row);
  SpreadsheetApp.flush();
  return { ok: true, id: res.id, row: res.row };
}

/* Completa el escaneo que ya está en la hoja. */
function updateRow(sh, headers, d, row) {
  const id = sh.getRange(row, columnFor(headers, "id")).getValue();

  // Un envío solo puede completar un escaneo PENDIENTE. Si la fila ya tiene
  // submitted_at es un reenvío: se ignora en vez de pisar el lead. Pasa de
  // verdad, no es una defensa teórica — api/lead.js reintenta cuando la
  // respuesta tarda, y esa respuesta lenta puede venir de una escritura que
  // SÍ ocurrió. Responde ok para que el reintento se dé por satisfecho.
  const subCol = columnFor(headers, "submitted_at");
  if (subCol > 0) {
    const ya = sh.getRange(row, subCol).getValue();
    if (ya !== "" && ya !== null) {
      Logger.log("Envío repetido de %s (fila %s), ignorado.", d.session_id, row);
      return { ok: true, id: id, row: row, status: "already_submitted" };
    }
  }

  writeFields(sh, headers, row, buildValues(d, id, { submit: true }), SUBMIT_FIELDS);
  SpreadsheetApp.flush();
  return { ok: true, id: id, row: row };
}

/* La fila de una sesión, o 0 si todavía no existe.

   La sesión la genera el navegador (crypto.randomUUID) y viaja en las dos
   escrituras. Sustituyó al id secuencial firmado: como es impredecible ya
   hace de contraseña de su propia fila, y como el cliente no tiene que
   pedírsela a nadie, el envío ya no espera a que responda el escaneo.

   CacheService guarda sesión → fila para no releer la columna en cada envío.
   Se confirma siempre contra la celda: si insertaron o borraron filas a mano,
   el número guardado ya no apunta a donde apuntaba. */
function findRowBySid(sh, headers, sid) {
  if (!sid) return 0;
  const col = columnFor(headers, "session_id");
  if (col === 0) return 0;

  const hit = Number(CacheService.getScriptCache().get("row:" + sid));
  if (hit > 1 && hit <= sh.getMaxRows() &&
      String(sh.getRange(hit, col).getValue()) === String(sid)) {
    return hit;
  }

  const vals = sh.getRange(1, col, sh.getMaxRows(), 1).getValues();
  // De abajo hacia arriba: la sesión que se busca casi siempre es reciente.
  for (let i = vals.length - 1; i >= 1; i--) {
    if (String(vals[i][0]) === String(sid)) {
      rememberRow(sid, i + 1);
      return i + 1;
    }
  }
  return 0;
}

/* 6 h es el máximo de CacheService, y sobra: entre abrir la ficha y mandar
   el teléfono pasan minutos. Si expira, se relee la columna y ya. */
function rememberRow(sid, row) {
  if (sid) CacheService.getScriptCache().put("row:" + String(sid), String(row), 21600);
}

/* -------------------------------------------------------------------------
   Teléfonos bloqueados

   La lista vive en la pestaña "Bloqueados", no en el código: así se agrega un
   número desde la hoja y aplica solo, sin editar el .gs ni crear una versión
   nueva de la implementación — el paso que es fácil olvidar y que deja el
   /exec bloqueando con la lista vieja.

   Cuesta una lectura, pero solo en el ENVÍO: el escaneo, que es la mayoría de
   las escrituras, ni la mira. Y va cacheada, así que es una lectura de una
   columna chica cada 5 min, no una por lead.
   ---------------------------------------------------------------------- */

const BLOCK_SHEET_NAME = "Bloqueados";
const BLOCK_CACHE_KEY = "blocked_phones";
const BLOCK_CACHE_TTL = 300; // segundos

// Solo la siembra inicial de initBlockSheet(). Después de correrlo, la lista
// buena es la de la pestaña; agregar aquí no bloquea nada.
const BLOCK_SEED = [
  "9498898021",
  "5666824567",
  "5554091097",
  "5579228297",
  "5554559526",
  "5536670516",
  "5579768806",
];

/* A 10 dígitos, que es como los guarda la hoja. Se queda con los ÚLTIMOS diez
   para que un número escrito con lada de país (+52…, 52…) case igual, y para
   que en la pestaña se pueda capturar con espacios o guiones. */
function normalizePhone(v) {
  const d = String(v === null || v === undefined ? "" : v).replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

function loadBlocked() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(BLOCK_CACHE_KEY);
  if (hit !== null) return JSON.parse(hit);

  const sh = getSS().getSheetByName(BLOCK_SHEET_NAME);
  let lista = [];
  if (!sh) {
    // Sin pestaña no se bloquea nada. Es silencioso por diseño —el lead entra
    // igual— así que queda dicho en el registro de ejecuciones.
    Logger.log("No existe la pestaña '%s'; corre initBlockSheet() una vez.", BLOCK_SHEET_NAME);
  } else if (sh.getLastRow() > 1) {
    lista = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
      .map(function (r) { return normalizePhone(r[0]); })
      .filter(function (p) { return p.length === 10; });
  }

  cache.put(BLOCK_CACHE_KEY, JSON.stringify(lista), BLOCK_CACHE_TTL);
  return lista;
}

function isBlocked(phone) {
  const p = normalizePhone(phone);
  return p.length === 10 && loadBlocked().indexOf(p) !== -1;
}

/* Una fila que YA tiene envío con otro teléfono es un lead bueno. Dos envíos
   con la misma sesión pasan de verdad (recarga, teléfono compartido en el
   piso de venta), y un número bloqueado no puede llevarse por delante el lead
   de alguien más. */
function deleteIfSafe(sh, headers, row, sid) {
  const subCol = columnFor(headers, "submitted_at");
  const phCol = columnFor(headers, "phone");
  if (subCol > 0 && phCol > 0) {
    const ya = sh.getRange(row, subCol).getValue();
    if (ya !== "" && ya !== null && !isBlocked(sh.getRange(row, phCol).getValue())) {
      Logger.log("La fila %s ya tenía un envío con otro teléfono; no se borra.", row);
      return false;
    }
  }
  deleteLeadRow(sh, row, sid);
  Logger.log("Fila %s borrada.", row);
  return true;
}

/* Borrar corre hacia arriba todo lo que está debajo. Las dos cachés lo
   aguantan: la de sesión → fila confirma contra la celda antes de creerse su
   número, y la reserva se ajusta aquí para no perder el camino rápido —si no,
   la siguiente escritura tendría que releer la columna 'id' completa. */
function deleteLeadRow(sh, row, sid) {
  sh.deleteRow(row);
  if (sid) CacheService.getScriptCache().remove("row:" + String(sid));

  const props = PropertiesService.getScriptProperties();
  const next = Number(props.getProperty(PROP_ROW)) || 0;
  if (next > row) props.setProperty(PROP_ROW, String(next - 1));

  SpreadsheetApp.flush();
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
  // Las filas nuevas heredan el formato de la de arriba, pero solo cuando ésa
  // ya lo tenía; se vuelve a aplicar para que un tramo no salga con las fechas
  // en crudo. Es una vez cada 500 filas.
  if (row === sh.getMaxRows() + 1) {
    sh.insertRowsAfter(sh.getMaxRows(), 500);
    formatDateColumns(sh);
  }

  if (!cacheOk(sh, idCol, row)) {
    row = lastRowWithId(sh, idCol) + 1;
    num = lastIdNum(sh, idCol);
    if (row > sh.getMaxRows()) {
      sh.insertRowsAfter(sh.getMaxRows(), 500);
      formatDateColumns(sh);
    }
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

/* Ids secuenciales legibles: L-000001, L-000002…

   El MÁXIMO de la columna, no el id de la última fila. Ordenar la hoja por
   cualquier otra columna —y una tabla de Sheets invita a hacerlo— deja abajo
   una fila que no es la del id más alto; tomarlo de ahí repetiría ids ya
   usados. Cuesta lo mismo: la columna ya se lee completa de todos modos. */
function lastIdNum(sh, idCol) {
  const vals = sh.getRange(1, idCol, sh.getMaxRows(), 1).getValues();
  let max = 0;
  for (let i = 1; i < vals.length; i++) { // desde la 2: la 1 es el encabezado
    const n = parseInt(String(vals[i][0]).replace(/\D/g, ""), 10);
    if (n > max) max = n;
  }
  return max;
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
     session_id                  columna nueva, después de user_input_2. Es lo
                                 que amarra el escaneo con su envío. También
                                 vacía en lo anterior.

   Las columnas de seguimiento se recorren a la derecha. Sus fórmulas se
   ajustan solas y el script las sigue ignorando.
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

  headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  if (headers.indexOf("session_id") === -1) {
    // Justo después de user_input_2, para que las columnas del script queden
    // juntas y las de seguimiento sigan siendo las de la derecha.
    const ultima = headers.indexOf("user_input_2") + 1;
    if (ultima === 0) throw new Error("No encuentro 'user_input_2' en la fila 1.");
    sh.insertColumnAfter(ultima);
    sh.getRange(1, ultima + 1).setValue("session_id").setFontWeight("bold");
    Logger.log("Insertada 'session_id' en la columna %s.", ultima + 1);
  } else {
    Logger.log("'session_id' ya existía, no se insertó nada.");
  }

  formatDateColumns(sh);
  resetCache();
  SpreadsheetApp.flush();

  Logger.log("Encabezados ahora: %s",
    sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].join(" · "));
}

/* Formato de fecha por NOMBRE de columna. Antes era "B:B" fijo, y con
   scanned_at de por medio esa posición ya no es la que era.

   La celda guarda un Date de verdad; esto solo decide cómo se ve y, con ello,
   cómo sale al exportar. Si cambias DATE_FORMAT, corre reformatDates() una vez
   para que las filas que ya están escritas también lo tomen. */
function formatDateColumns(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  ["scanned_at", "submitted_at"].forEach(function (field) {
    const col = columnFor(headers, field);
    if (col > 0) {
      sh.getRange(2, col, sh.getMaxRows() - 1, 1).setNumberFormat(DATE_FORMAT);
    }
  });
}

/* Aplica DATE_FORMAT a las dos columnas de fecha de la hoja que ya existe.
   Correrlo de más no hace nada. */
function reformatDates() {
  const sh = getSS().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error("No existe la pestaña '" + SHEET_NAME + "'.");
  formatDateColumns(sh);
  SpreadsheetApp.flush();
  Logger.log("scanned_at y submitted_at ahora se muestran como '%s'.", DATE_FORMAT);
}

/* La caché de fila/id se recalcula sola en la siguiente escritura. */
function resetCache() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_ROW);
  props.deleteProperty(PROP_ID);
}

/* -------------------------------------------------------------------------
   Bloqueados: correr desde el editor
   ---------------------------------------------------------------------- */

/* UNA VEZ: crea la pestaña "Bloqueados" y siembra BLOCK_SEED. Es idempotente,
   correrlo de más no duplica nada.

   Para agregar números después NO hace falta tocar el código: se escriben en
   la columna A de esa pestaña, uno por fila. La columna B es para tu nota
   (quién es, por qué se bloqueó); el script no la lee. */
function initBlockSheet() {
  const ss = getSS();
  let sh = ss.getSheetByName(BLOCK_SHEET_NAME);

  if (sh) {
    Logger.log("La pestaña '%s' ya existía.", BLOCK_SHEET_NAME);
  } else {
    sh = ss.insertSheet(BLOCK_SHEET_NAME);
    sh.getRange(1, 1, 1, 2).setValues([["phone", "nota"]]).setFontWeight("bold");
    sh.setFrozenRows(1);
    // Texto, no número: si no, la hoja se come el 0 inicial y redondea.
    sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat("@");
    sh.setColumnWidth(1, 140);
    sh.setColumnWidth(2, 360);
    Logger.log("Pestaña '%s' creada.", BLOCK_SHEET_NAME);
  }

  const last = sh.getLastRow();
  const ya = last > 1
    ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return normalizePhone(r[0]); })
    : [];

  const nuevos = BLOCK_SEED
    .map(function (p) { return normalizePhone(p); })
    .filter(function (p) { return p.length === 10 && ya.indexOf(p) === -1; });

  if (nuevos.length) {
    sh.getRange(last + 1, 1, nuevos.length, 1)
      .setValues(nuevos.map(function (p) { return [p]; }));
    Logger.log("Agregado(s) %s número(s): %s", nuevos.length, nuevos.join(", "));
  } else {
    Logger.log("Los números de la siembra ya estaban en la lista.");
  }

  resetBlockedCache();
  SpreadsheetApp.flush();
  Logger.log("Bloqueados ahora: %s", loadBlocked().join(", ") || "(ninguno)");
}

/* Borra de "Leads" todo lo que ya esté escrito con un teléfono bloqueado.
   Córrelo después de agregar números a la pestaña. */
function purgeBlocked() {
  const sh = getSS().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error("No existe la pestaña '" + SHEET_NAME + "'.");

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const phCol = columnFor(headers, "phone");
  if (phCol === 0) throw new Error("La fila 1 no tiene la columna 'phone'.");

  CacheService.getScriptCache().remove(BLOCK_CACHE_KEY);
  const bloqueados = loadBlocked();
  if (!bloqueados.length) {
    Logger.log("La lista de bloqueados está vacía; no hay nada que borrar.");
    return;
  }

  const total = sh.getMaxRows();
  const vals = sh.getRange(1, phCol, total, 1).getValues();

  // De abajo hacia arriba: borrar de arriba corre las filas que faltan por
  // revisar y se saltaría la de junto.
  let borradas = 0;
  for (let i = total - 1; i >= 1; i--) {
    const p = normalizePhone(vals[i][0]);
    if (p.length === 10 && bloqueados.indexOf(p) !== -1) {
      sh.deleteRow(i + 1);
      borradas++;
      Logger.log("Borrada la fila %s (%s).", i + 1, p);
    }
  }

  // Las filas se corrieron; que la reserva se recalcule de cero.
  resetCache();
  SpreadsheetApp.flush();
  Logger.log("purgeBlocked: %s fila(s) borrada(s), contra %s número(s) bloqueado(s).",
    borradas, bloqueados.length);
}

/* La lista se cachea 5 min. Un número recién agregado a la pestaña empieza a
   bloquear cuando expira ese rato; corre esto si lo quieres de inmediato. */
function resetBlockedCache() {
  CacheService.getScriptCache().remove(BLOCK_CACHE_KEY);
  Logger.log("Caché de bloqueados vaciada; la lista se relee en el siguiente envío.");
}
