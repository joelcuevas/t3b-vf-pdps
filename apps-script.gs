/* =========================================================================
   Apps Script — receptor de leads
   -------------------------------------------------------------------------
   Pegar en la hoja: Extensiones → Apps Script → reemplazar Código.gs.

   Implementar → Nueva implementación → Aplicación web
       Ejecutar como:      Yo
       Quién tiene acceso: Cualquier persona
   "Cualquier persona" hace pública SOLO esta URL, no la hoja. La hoja
   conserva sus permisos: solo la ve quien tú compartas. Este endpoint
   escribe y responde {ok, id} — nunca lee ni devuelve datos.

   ⚠️ Cada vez que edites este código hay que crear una NUEVA VERSIÓN de la
   implementación (Implementar → Gestionar implementaciones → editar → Versión:
   Nueva). Si solo guardas, la URL /exec sigue sirviendo el código viejo.
   ======================================================================== */

// Debe coincidir con la variable SHEET_SECRET en Vercel.
const SECRET = "PEGA_AQUI_EL_MISMO_SECRETO_QUE_EN_VERCEL";

const SHEET_NAME = "leads";

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

// Columnas que escribe el script. Las que agregues para seguimiento
// (estatus, notas, quién llamó…) van DESPUÉS de éstas y nunca se tocan.
const FIELDS = [
  "id",
  "created_at",
  "phone",
  "store_id",
  "store_name",
  "product_id",
  "product_name",
  "utm_source",    // de la URL
  "utm_campaign",  // variante de landing; la fija el servidor
  "user_input_1",  // monto quincenal del botón elegido, en pesos (480)
  "user_input_2",  // quincenas de ese botón (4 / 8 / 12)
];

// Encabezados anteriores que se siguen aceptando. Sin esto, renombrar una
// columna hace que su dato deje de escribirse sin ningún error visible: el
// resto de la fila entra bien y solo esa celda queda vacía.
const LEGACY_HEADERS = {
  utm_source: ["utm"],
};

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

    // Última row CON id, no getLastRow(): si alguien arrastró una fórmula
    // en una columna de seguimiento, getLastRow() apuntaría demasiado abajo
    // y dejaría un hueco de filas vacías.
    const row = lastRowWithId(sh) + 1;

    const id = nextId(sh);
    const values = {
      id: id,
      created_at: new Date(),
      phone: "'" + String(d.phone || ""), // apóstrofo: conserva el 0 inicial
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

    // Escribe celda por celda buscando cada field por NOMBRE de encabezado.
    // Así puedes reordenar o insertar columnas sin romper nada.
    const omitidos = [];
    FIELDS.forEach(function (field) {
      const col = columnFor(headers, field);
      if (col > 0) sh.getRange(row, col).setValue(values[field]);
      else omitidos.push(field);
    });

    // Si la hoja no tiene alguna columna, el dato se pierde sin avisar.
    // Queda en el registro de ejecuciones para poder verlo.
    if (omitidos.length) {
      Logger.log("Sin columna en la hoja, no se escribieron: %s", omitidos.join(", "));
    }

    SpreadsheetApp.flush();
    return json({ ok: true, id: id });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* Celda numérica, o vacía si no llegó nada usable. Devolver "" en vez de 0
   evita que un lead sin dato se cuente como un pago de cero. */
function numberOrBlank(v) {
  if (v === undefined || v === null || v === "") return "";
  const n = Number(v);
  return isNaN(n) ? "" : n;
}

/* Última row que tiene algo en la columna `id`. */
function lastRowWithId(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = headers.indexOf("id") + 1;
  if (col === 0) throw new Error("la row 1 no tiene la columna 'id'");

  const total = sh.getMaxRows();
  const vals = sh.getRange(1, col, total, 1).getValues();
  for (let i = total - 1; i >= 0; i--) {
    if (vals[i][0] !== "" && vals[i][0] !== null) return i + 1;
  }
  return 1; // solo el encabezado
}

/* Ids secuenciales legibles: L-000001, L-000002… */
function nextId(sh) {
  const row = lastRowWithId(sh);
  if (row <= 1) return "L-000001";

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = headers.indexOf("id") + 1;
  const ultimo = String(sh.getRange(row, col).getValue());
  const n = parseInt(ultimo.replace(/\D/g, ""), 10) || 0;
  return "L-" + String(n + 1).padStart(6, "0");
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
   pisaría la primera de las tuyas. En ese caso agrega las columnas a mano;
   el orden no importa, cada campo se busca por nombre de encabezado.
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
  sh.getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  ss.setSpreadsheetTimeZone("America/Mexico_City");
  SpreadsheetApp.flush();

  Logger.log("Listo. Columnas: %s", FIELDS.join(" · "));
  Logger.log("Pestañas ahora: %s",
    ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
}
