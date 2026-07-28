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

const HOJA = "leads";

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
const CAMPOS = [
  "id",
  "created_at",
  "phone",
  "store_id",
  "store_name",
  "product_id",
  "product_name",
  "utm_source",    // de la URL
  "utm_campaign",  // variante de landing; la fija el servidor
  "input",         // quincenas elegidas en el selector (4 / 8 / 12)
];

function doPost(e) {
  // Serializa las escrituras: dos leads simultáneos no pueden tomar el mismo
  // id ni la misma fila.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json({ ok: false, error: "ocupado" });
  }

  try {
    const d = JSON.parse(e.postData.contents);
    if (d.token !== SECRET) return json({ ok: false, error: "no_autorizado" });

    const sh = getSS().getSheetByName(HOJA);
    if (!sh) return json({ ok: false, error: "falta_hoja_" + HOJA });

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

    // Última fila CON id, no getLastRow(): si alguien arrastró una fórmula
    // en una columna de seguimiento, getLastRow() apuntaría demasiado abajo
    // y dejaría un hueco de filas vacías.
    const fila = ultimaFilaConId(sh) + 1;

    const id = siguienteId(sh);
    const valores = {
      id: id,
      created_at: new Date(),
      phone: "'" + String(d.phone || ""), // apóstrofo: conserva el 0 inicial
      store_id: String(d.store_id || ""),
      store_name: String(d.store_name || ""),
      product_id: String(d.product_id || ""),
      product_name: String(d.product_name || ""),
      utm_source: String(d.utm_source || ""),
      utm_campaign: String(d.utm_campaign || ""),
      input: d.input || "",
    };

    // Escribe celda por celda buscando cada campo por NOMBRE de encabezado.
    // Así puedes reordenar o insertar columnas sin romper nada.
    CAMPOS.forEach(function (campo) {
      const col = headers.indexOf(campo) + 1;
      if (col > 0) sh.getRange(fila, col).setValue(valores[campo]);
    });

    SpreadsheetApp.flush();
    return json({ ok: true, id: id });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* Última fila que tiene algo en la columna `id`. */
function ultimaFilaConId(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = headers.indexOf("id") + 1;
  if (col === 0) throw new Error("la fila 1 no tiene la columna 'id'");

  const total = sh.getMaxRows();
  const vals = sh.getRange(1, col, total, 1).getValues();
  for (let i = total - 1; i >= 0; i--) {
    if (vals[i][0] !== "" && vals[i][0] !== null) return i + 1;
  }
  return 1; // solo el encabezado
}

/* Ids secuenciales legibles: L-000001, L-000002… */
function siguienteId(sh) {
  const fila = ultimaFilaConId(sh);
  if (fila <= 1) return "L-000001";

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = headers.indexOf("id") + 1;
  const ultimo = String(sh.getRange(fila, col).getValue());
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
   ---------------------------------------------------------------------- */
function inicializarHoja() {
  const ss = getSS();
  Logger.log("Hoja de cálculo: %s", ss.getName());

  let sh = ss.getSheetByName(HOJA);
  if (sh) {
    Logger.log("La pestaña '%s' ya existía; se actualizan sus encabezados.", HOJA);
  } else {
    sh = ss.insertSheet(HOJA);
    Logger.log("Pestaña '%s' creada.", HOJA);
  }

  sh.getRange(1, 1, 1, CAMPOS.length).setValues([CAMPOS]).setFontWeight("bold");
  sh.setFrozenRows(1);
  sh.getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  ss.setSpreadsheetTimeZone("America/Mexico_City");
  SpreadsheetApp.flush();

  Logger.log("Listo. Columnas: %s", CAMPOS.join(" · "));
  Logger.log("Pestañas ahora: %s",
    ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
}
