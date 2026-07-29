# t3b-vf-pdps

Páginas de producto por tienda con captura de teléfono. El lead se escribe en
una hoja privada de Google Sheets. **No hay base de datos.**

```
QR / campaña
   └─ /?store_id=3670&product_id=30742&utm_source=whatsapp
        └─ index.html   render del producto + precios de esa tienda
             └─ POST /api/lead     valida y resuelve nombres
             │    └─ Apps Script   asigna id y escribe la fila
             │         └─ Hoja privada de Google
             └─ redirect → avafin.com.mx/tiendas?…   (solicitud del préstamo)
```

## El redirect a avafin

El CTA registra el teléfono y enseguida manda al cliente a avafin, que es
donde realmente se solicita el crédito. La URL la arma `avafinUrl()` en
`catalog.js` con **exactamente los mismos parámetros** que `build_long_url()`
en `qrs/create_store_full_setup.py` — el `originalURL` que hay detrás de los
QR impresos:

```
https://www.avafin.com.mx/tiendas
  ?product_key=30742
  &product_name=Horno+de+Microondas+Panasonic+1.3+ft+   ← nombre crudo de avafin
  &product_cost=219900                                  ← centavos
  &loan_amount=191300                                   ← centavos; == cost si la tienda es sin-enganche
  &validity=172800
  &store_name=3670                                      ← el código, no el slug
```

> `product_name` es el nombre **que avafin tiene registrado**, no el que ve el
> cliente. Junto con `product_key` + `store_name` es lo que identifica el
> producto del otro lado; si no coincide, el redirect da error. Por eso vive en
> el campo `av` del catálogo, aparte de `name`, con sus erratas y espacios de
> más intactos.

Si cambias este contrato, hay que cambiarlo también en
`create_store_full_setup.py` o el tráfico web y el de los QR impresos dejarán
de apuntar al mismo lugar.

**El registro del lead no bloquea el redirect.** `api/lead.js` ya reintenta 3
veces y deja el lead en los logs si falla; dejar a un cliente sin poder
solicitar su crédito porque la hoja de cálculo se cayó sería peor que perder
una fila de seguimiento. El `fetch` va con `keepalive` para que sobreviva a la
navegación.

## Parámetros de la URL

| Parámetro | Obligatorio | Formato |
|---|---|---|
| `store_id` | sí | id oficial (`3670`) o nombre oficial (`PlazaExhibimex`), indistinto |
| `product_id` | sí | clave del producto (`30742`) |
| `utm_source` | no | texto libre, se recorta a 120 caracteres |

Si `store_id` o `product_id` no existen, la página muestra "Enlace no válido"
y no ofrece el formulario.

## Columnas de la hoja

`id · created_at · phone · store_id · store_name · product_id · product_name ·`
`utm_source · utm_campaign · user_input_1 · user_input_2`

| Columna | De dónde sale |
|---|---|
| `id` | secuencial, lo asigna Apps Script (`L-000001`) |
| `created_at` | lo estampa Apps Script, zona horaria de la hoja |
| `phone` | del formulario, 10 dígitos |
| `store_id` / `store_name` | de `store_id` en la URL, resuelto **en el servidor** |
| `product_id` / `product_name` | de `product_id` en la URL, resuelto **en el servidor** |
| `utm_source` | de `utm_source` en la URL; vacío si no viene |
| `utm_campaign` | fijo, identifica la variante de landing. Hoy `dangler_select_payment` |
| `user_input_1` | monto quincenal del botón elegido, en pesos (`810`), **recalculado en el servidor** |
| `user_input_2` | quincenas de ese botón: 4, 8 o 12 (default 8) |

`utm_campaign` **no se toma del navegador**: lo pone `api/lead.js` desde la
constante `UTM_CAMPAIGN` de `catalog.js`, para que no se pueda falsear desde
la URL. Cuando exista una segunda variante de landing, cada página declara la
suya.

`user_input_1` tampoco viaja desde el navegador. La página manda solo el
plazo y el servidor deriva el monto con `displayedPayment()` de `catalog.js`,
la misma función que pinta el botón: así la hoja no puede terminar con una
cifra que la página nunca mostró. Los dos campos van como **número**, para
poder sumarlos y promediarlos en la hoja.

> Migrar una hoja que ya existe: renombra `user_input` → `user_input_2` e
> inserta una columna `user_input_1`. El orden no importa, cada campo se busca
> por nombre de encabezado. No corras `initSheet()` sobre una hoja con
> columnas propias de seguimiento: escribe los encabezados en las primeras
> `FIELDS.length` columnas y pisaría la primera de las tuyas.

Las columnas de seguimiento que agregues (estatus, notas, quién llamó) van
**a la derecha de éstas**, o sea a partir de la `K`. El script escribe buscando
cada campo por nombre de encabezado y omite los que no encuentra, así que
puedes reordenar columnas, insertarlas o quitarlas sin romper la inserción —
solo pierdes el dato de la que falte. Dos reglas para no romperla:

1. **No arrastres fórmulas hacia abajo** en columnas vacías. Usa
   `=ARRAYFORMULA(IF(A2:A="", "", …))` en la fila 1.
2. Aplica validación de datos y formato condicional a la **columna completa**
   (`K2:K`, no `K2:K500`) para que las filas nuevas los hereden.

Un teléfono repetido genera un lead nuevo cada vez: es intencional, la hoja es
una bitácora. Para ver el número de contacto sin perder filas:

```
=ARRAYFORMULA(IF(C2:C="", "", COUNTIFS(C$2:C, C2:C, B$2:B, "<="&B2:B)))
```

## Configuración

### Google

1. Crear la hoja, privada, compartida solo con quien deba verla.
2. Extensiones → Apps Script → pegar `apps-script.gs`.
3. Poner el valor de `SECRET` en el script.
4. Ejecutar `initSheet()` una vez (crea la pestaña `leads`, encabezados,
   formato de fecha y zona horaria).
5. Implementar → Nueva implementación → Aplicación web:
   *Ejecutar como:* **Yo** · *Quién tiene acceso:* **Cualquier persona**.
   Copiar la URL que termina en `/exec`.

> "Cualquier persona" publica **la URL del script, no la hoja**. Ese endpoint
> solo inserta filas y responde `{ok, id}`; no lee ni devuelve datos.

> Al editar el script hay que crear una **nueva versión** de la implementación.
> Guardar no basta: la URL `/exec` seguiría sirviendo el código anterior.

### Vercel

Variables de entorno (Production y Preview):

| Variable | Valor |
|---|---|
| `SHEET_WEBHOOK_URL` | la URL `/exec` del paso 5 |
| `SHEET_SECRET` | el mismo valor que `SECRET` en el script |

Sin build step: estático + una función en `api/`.

## Datos pendientes

`catalog.js` es el espejo de `PRODUCTS`/`STORES` en
`qrs/create_store_full_setup.py`. Falta:

- **Fotos de 5 productos** (`32275`, `32633`, `27386`, `31618`, `31619`): falta
  `img/{clave}.jpg`, se muestra un placeholder con la categoría.
- **Fichas técnicas**: el mock muestra chips reales del producto (`1100 W`,
  `1.3 ft³ · 36.8 L`, `Negro espejo`). Solo `30742` los tiene cargados, en el
  campo `specs` del catálogo; para igualar el mock en los 26 productos hace
  falta esa hoja de especificaciones. La variante actual de la ficha **no
  dibuja chips** (ver abajo), así que `specs` está inactivo por ahora.
- **Carrusel**: el mock dibuja tres puntos de galería. Solo hay una foto por
  producto, así que se omiten en vez de fingir imágenes que no existen.

## Qué muestra esta variante de la ficha

Fuera: los chips de detalle (marca, categoría, `Disponible en {tienda}`) y el
bloque de precio completo —primer pago, enganche y total a pagar—. El markup y
el CSS se eliminaron de `index.html`; el modelo sigue entero en `catalog.js`
para poder restituirlos.

La única cifra que queda es el **pago quincenal**, y vive dentro del selector:
la pregunta es "¿Cuánto quieres pagar a la quincena?" y cada botón es el pago
de un plazo —12, 8 y 4 quincenas, en ese orden, del más chico al más grande—
redondeado **hacia arriba** a la decena, para que la cifra publicada nunca
quede por debajo de la que cobra avafin. El botón no dice el plazo: el monto
elegido se reporta en `user_input_1` y su plazo en `user_input_2`.

## El pago quincenal y el total no se capturan

Las cifras se **derivan** del monto financiado. No hay ningún número de
crédito escrito a mano en `catalog.js`:

```
préstamo    = cost − enganche        (= cost en Tetiz y Postes)
pago 1 (n)  = préstamo × (1/n + K × 21)      K = 0.007 × 1.16
total  (n)  = préstamo × (1 + K × (21 + 16 × (n−1)/2))
```

Con n = 12 eso da los factores 0.2538533 y 1.8850800. Salen del modelo de
`flows/endpoint.js` —capital = préstamo/n, interés = saldo insoluto × 0.7%
diario × días del periodo, IVA 16%— evaluado en **21 días al primer pago**. Se
verificó contra una tabla real de avafin (clave `30466`, préstamo 3,599, primer
pago 18/08/2026): las 12 filas cuadran con diferencia máxima de $0.09.

Los días al primer pago (`d1`) son lo único que cambia entre cotizaciones: son
los que hay entre el cálculo y la fecha que elige el cliente. Por eso el monto
del selector va redondeado hacia arriba a la decena: es una referencia, no la
carátula, y de ese lado el error nunca juega en contra del cliente.

> Antes estas cifras se capturaban a mano desde una hoja del negocio. Esa hoja
> venía de una corrida con `d1= 19`, así que **todo lo publicado estaba 6.8%
> por debajo** de lo que cobra avafin, con tres celdas peor todavía (`30995`
> −62%). Derivarlas es lo que evita que se vuelva a desfasar.

El factor queda ~$0.06 abajo del total de avafin, que redondea periodo por
periodo. Se acepta a cambio de tener una sola fórmula.

## Riesgo asumido

Sin base de datos, si Apps Script falla, el lead solo existe en los logs de
Vercel. `api/lead.js` reintenta 3 veces y, si aun así falla, escribe el lead
completo en el log con el prefijo `[lead] PERDIDO` para poder rescatarlo a
mano. Los logs de Vercel en plan Hobby se conservan poco tiempo: si esto llega
a pasar seguido, es la señal para mover la escritura a Postgres y dejar la hoja
como espejo.

## Desarrollo local

Sin dependencias y sin cuenta de Vercel. `dev-server.js` ejecuta el mismo
`api/lead.js` que se despliega.

**Modo stub** — no toca Google, imprime en la terminal la fila que escribiría:

```
npm run dev
open "http://localhost:3000/?store_id=3670&product_id=30742&utm_source=prueba"
```

**Modo real** — escribe en la hoja de verdad. Crea `.env.local` (ignorado por
git) y arranca:

```
SHEET_WEBHOOK_URL=https://script.google.com/macros/s/…/exec
SHEET_SECRET=el-mismo-secreto-del-script
```

```
npm run dev:real
```

URLs útiles para revisar los tres casos que se ven distinto:

| Caso | URL |
|---|---|
| Normal, con foto y precio | `/?store_id=3670&product_id=30742` |
| Sin foto (placeholder de categoría) | `/?store_id=3670&product_id=31619` |
| Tienda sin enganche | `/?store_id=Tetiz&product_id=30553` |
| Enlace roto | `/?store_id=9999&product_id=30742` |

En modo stub el servidor imprime cada petición, así que al enviar el formulario
verás en la terminal la fila que se escribiría y enseguida el redirect a avafin
con todos sus parámetros.

Para comprobar que las URLs de avafin siguen coincidiendo con las de los QR
impresos, compara contra el script que los genera:

```
python3 -c "
import ast
from urllib.parse import urlencode
t=ast.parse(open('../qrs/create_store_full_setup.py',encoding='utf-8').read())
g={n.targets[0].id: ast.literal_eval(n.value) for n in t.body
   if isinstance(n,ast.Assign) and getattr(n.targets[0],'id','') in
   ('PRODUCTS','STORES','SIN_ENGANCHE_CODES','VALIDITY')}
for c,_ in g['STORES']:
  for p in g['PRODUCTS']:
    l = p['cost'] if c in g['SIN_ENGANCHE_CODES'] else p['loan']
    print('https://www.avafin.com.mx/tiendas?'+urlencode({'product_key':p['key'],
      'product_name':p['name'],'product_cost':p['cost'],'loan_amount':l,
      'validity':g['VALIDITY'],'store_name':c}))" | sort > /tmp/a
node -e "import('./catalog.js').then(m=>console.log(m.STORES.flatMap(s=>
  Object.entries(m.PRODUCTS).map(([id,p])=>m.avafinUrl(id,p,s))).join('\n')))" | sort > /tmp/b
comm -23 /tmp/a /tmp/b   # vacío = ninguna URL del script cambió
```

`catalog.js` tiene 17 tiendas y el script todavía 9, así que el catálogo genera
más URLs de las que el script conoce; lo que importa es que **ninguna de las
del script falte**. La única excepción esperada hoy son las 26 de
`3330 SanBernabe2`, tienda que el padrón oficial no incluye (ahí es
`888 Sanbernabe`).
