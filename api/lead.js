/* =========================================================================
   POST /api/lead
   -------------------------------------------------------------------------
   Único punto de escritura hacia la hoja de Google. La página nunca habla
   con Apps Script directamente: si lo hiciera, el secreto viviría en el JS
   del navegador y cualquiera podría inyectar filas.

   Dos acciones sobre la MISMA fila, amarradas por `sid`:

     action: "scan"    al abrir la ficha. Abre la fila con el contexto
                       (tienda, producto, utm) y la hora del escaneo.
     action: "submit"  al enviar el teléfono. Completa esa misma fila.

   `sid` lo genera el navegador con crypto.randomUUID(). Es impredecible, así
   que hace de contraseña de su propia fila: nadie puede completar la de otro.
   Antes esto era un id secuencial firmado con HMAC, lo que obligaba al
   cliente a ESPERAR la respuesta del escaneo antes de poder enviar — y esa
   respuesta puede tardar segundos. Generarlo en el navegador quita la espera
   y quita la firma.

   El navegador manda solo store_id / product_id / phone / utm. Los NOMBRES
   (store_name, product_name) se resuelven aquí contra catalog.js, no se
   confían al cliente — así la hoja nunca guarda un nombre inventado.

   Variables de entorno (Vercel → Settings → Environment Variables):
     SHEET_WEBHOOK_URL — URL /exec de la implementación de Apps Script
     SHEET_SECRET      — mismo valor que la constante SECRET del script
   ======================================================================== */

import { PRODUCTS, findStore, displayedPayment, UTM_CAMPAIGN } from "../catalog.js";
import { clasificar } from "../pnn.js";

// Apps Script serializa las escrituras con LockService y bajo carga tarda
// segundos. El timeout corta la ESPERA, no la escritura: al otro lado la fila
// puede haberse escrito igual. Por eso los reintentos solo son seguros ahora
// que Apps Script deduplica por sesión — antes, cada timeout dejaba una fila
// de más.
const TIMEOUT_MS = 15000;
const ATTEMPTS = 3;
const TERMS = [4, 8, 12];
const TERM_DEFAULT = 8;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const { SHEET_WEBHOOK_URL, SHEET_SECRET } = process.env;
  if (!SHEET_WEBHOOK_URL || !SHEET_SECRET) {
    console.error("[lead] faltan SHEET_WEBHOOK_URL o SHEET_SECRET");
    return res.status(500).json({ ok: false, error: "config" });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};

  // El contexto del enlace se valida igual en las dos acciones: sin tienda o
  // sin producto no hay fila que abrir ni que completar.
  const store = findStore(body.store_id);
  if (!store) return res.status(400).json({ ok: false, error: "invalid_store" });

  const productId = String(body.product_id || "").trim();
  const product = PRODUCTS[productId];
  if (!product) return res.status(400).json({ ok: false, error: "invalid_product" });

  // Un UUID trae solo hex y guiones. Se recorta en vez de rechazarse: sin
  // sesión el lead entra igual, solo que como fila suelta.
  const session_id = String(body.sid || "").replace(/[^0-9a-zA-Z-]/g, "").slice(0, 64);

  // utm_source es texto libre que viene de la URL: se limpia antes de escribirlo.
  const utm_source = String(body.utm_source || "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 120);

  const contexto = {
    session_id,
    store_id: store.code,
    store_name: store.name,
    product_id: productId,
    product_name: product.name,
    utm_source,
    // No se toma del cliente: identifica la variante de landing y se fija aquí.
    utm_campaign: UTM_CAMPAIGN,
  };

  // --- Escaneo ----------------------------------------------------------
  // Un intento y ya. El cliente no espera esta respuesta ni la lee: si no se
  // escribe, el envío abre la fila él solo. Reintentar solo alargaría una
  // función que a nadie le urge.
  if (body.action === "scan") {
    try {
      const r = await writeToSheet(SHEET_WEBHOOK_URL, SHEET_SECRET, {
        action: "scan",
        ...contexto,
      });
      return res.status(200).json({ ok: true, id: r.id });
    } catch (err) {
      console.warn("[lead] escaneo no registrado:", err && err.message);
      return res.status(200).json({ ok: false, error: "scan_unavailable" });
    }
  }

  // --- Envío ------------------------------------------------------------
  const phone = String(body.phone || "").replace(/\D/g, "");
  if (phone.length !== 10) {
    return res.status(400).json({ ok: false, error: "invalid_phone" });
  }

  // Contra el Plan Nacional de Numeración: "Móvil", "Fijo" o "Inválido".
  // A propósito NO rechaza nada — el lead entra igual y el juicio queda en la
  // hoja, para poder medir cuántos números malos llegan antes de decidir si
  // vale la pena bloquearlos en la página.
  const phone_valid = clasificar(phone);

  // Quincenas elegidas en el selector. Si llega algo fuera de la lista se cae
  // al default en vez de escribir basura en la hoja.
  const enviado = Number(body.user_input_2);
  const user_input_2 = TERMS.includes(enviado) ? enviado : TERM_DEFAULT;

  // El monto NO se toma del cliente: se recalcula con la misma función que
  // pinta el botón, así la hoja no puede terminar con una cifra que la página
  // nunca mostró. Mismo criterio que store_name y product_name.
  const user_input_1 = displayedPayment(product, store, user_input_2);

  const lead = {
    action: "submit",
    ...contexto,
    phone,
    phone_valid,
    user_input_1, // monto quincenal del botón elegido, en pesos
    user_input_2, // quincenas de ese botón
  };

  // --- Escritura en la hoja --------------------------------------------
  let lastError = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const r = await writeToSheet(SHEET_WEBHOOK_URL, SHEET_SECRET, lead);
      return res.status(200).json({ ok: true, id: r.id });
    } catch (err) {
      lastError = err;
      if (attempt < ATTEMPTS) await wait(attempt * 400);
    }
  }

  // Sin base de datos no hay a dónde reintentar después: el lead solo
  // sobrevive en los logs de Vercel. Se registra completo a propósito para
  // poder rescatarlo a mano. Ver README → "Riesgo asumido".
  console.error(
    "[lead] PERDIDO tras " + ATTEMPTS + " intentos:",
    JSON.stringify(lead),
    "causa:",
    lastError && lastError.message
  );
  return res.status(502).json({ ok: false, error: "sheet_unavailable" });
}

/* ---- Apps Script ------------------------------------------------------- */

async function writeToSheet(url, secret, payload) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: secret, ...payload }),
      signal: ctrl.signal,
      redirect: "follow", // Apps Script redirige a script.googleusercontent.com
    });

    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);

    const data = safeParse(text);
    if (!data || !data.ok) {
      throw new Error(`respuesta inesperada: ${text.slice(0, 200)}`);
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
