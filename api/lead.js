/* =========================================================================
   POST /api/lead
   -------------------------------------------------------------------------
   Único punto de escritura hacia la hoja de Google. La página nunca habla
   con Apps Script directamente: si lo hiciera, el secreto viviría en el JS
   del navegador y cualquiera podría inyectar filas.

   Dos acciones sobre la MISMA fila:

     action: "scan"    al abrir la ficha. Abre la fila con el contexto
                       (tienda, producto, utm) y devuelve un ticket firmado.
     action: "submit"  al enviar el teléfono. Devuelve ese ticket y completa
                       la fila que ya existe.

   El ticket es {id, row, sig}, con sig = HMAC-SHA256 de "id:row" bajo
   SHEET_SECRET. Sin firma bastaría con adivinar un id —son secuenciales,
   L-000123— para escribirle encima a la fila de otro. Un ticket inválido no
   se rechaza: cae al append completo, porque perder un lead es peor que
   tener una fila suelta.

   El navegador manda solo store_id / product_id / phone / utm. Los NOMBRES
   (store_name, product_name) se resuelven aquí contra catalog.js, no se
   confían al cliente — así la hoja nunca guarda un nombre inventado.

   Variables de entorno (Vercel → Settings → Environment Variables):
     SHEET_WEBHOOK_URL — URL /exec de la implementación de Apps Script
     SHEET_SECRET      — mismo valor que la constante SECRET del script
   ======================================================================== */

import { createHmac, timingSafeEqual } from "node:crypto";
import { PRODUCTS, findStore, displayedPayment, UTM_CAMPAIGN } from "../catalog.js";
import { clasificar } from "../pnn.js";

const TIMEOUT_MS = 8000;
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

  // utm_source es texto libre que viene de la URL: se limpia antes de escribirlo.
  const utm_source = String(body.utm_source || "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 120);

  const contexto = {
    store_id: store.code,
    store_name: store.name,
    product_id: productId,
    product_name: product.name,
    utm_source,
    // No se toma del cliente: identifica la variante de landing y se fija aquí.
    utm_campaign: UTM_CAMPAIGN,
  };

  // --- Escaneo ----------------------------------------------------------
  // Abre la fila y devuelve el ticket. Si falla no se reintenta hasta el
  // cansancio: el envío puede abrir la fila él solo.
  if (body.action === "scan") {
    try {
      const r = await writeToSheet(SHEET_WEBHOOK_URL, SHEET_SECRET, {
        action: "scan",
        ...contexto,
      });
      return res.status(200).json({
        ok: true,
        id: r.id,
        row: r.row,
        sig: sign(SHEET_SECRET, r.id, r.row),
      });
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
    ...contexto,
    phone,
    phone_valid,
    user_input_1, // monto quincenal del botón elegido, en pesos
    user_input_2, // quincenas de ese botón
  };

  // Con ticket válido se completa la fila del escaneo; sin él se abre una
  // nueva, que es lo que hacía la versión anterior de este handler.
  const ticket = validTicket(SHEET_SECRET, body);
  if (ticket) {
    lead.action = "submit";
    lead.id = ticket.id;
    lead.row = ticket.row;
  } else if (body.lead_id) {
    console.warn("[lead] ticket inválido para", body.lead_id, "— se abre fila nueva");
  }

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

/* ---- Ticket ------------------------------------------------------------ */

function sign(secret, id, row) {
  return createHmac("sha256", secret).update(`${id}:${row}`).digest("hex").slice(0, 32);
}

/* {id, row} si la firma cuadra; null si falta, no cuadra o viene deforme. */
function validTicket(secret, body) {
  const id = String(body.lead_id || "");
  const row = Number(body.lead_row);
  const sig = String(body.lead_sig || "");
  if (!id || !Number.isInteger(row) || row < 2 || sig.length !== 32) return null;

  const esperada = Buffer.from(sign(secret, id, row));
  const recibida = Buffer.from(sig);
  if (esperada.length !== recibida.length) return null;
  return timingSafeEqual(esperada, recibida) ? { id, row } : null;
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
