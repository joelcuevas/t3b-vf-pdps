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
`utm_source · utm_campaign · user_input`

| Columna | De dónde sale |
|---|---|
| `id` | secuencial, lo asigna Apps Script (`L-000001`) |
| `created_at` | lo estampa Apps Script, zona horaria de la hoja |
| `phone` | del formulario, 10 dígitos |
| `store_id` / `store_name` | de `store_id` en la URL, resuelto **en el servidor** |
| `product_id` / `product_name` | de `product_id` en la URL, resuelto **en el servidor** |
| `utm_source` | de `utm_source` en la URL; vacío si no viene |
| `utm_campaign` | fijo, identifica la variante de landing. Hoy `dangler_installments` |
| `user_input` | quincenas elegidas en el selector: 4, 8 o 12 (default 8) |

`utm_campaign` **no se toma del navegador**: lo pone `api/lead.js` desde la
constante `UTM_CAMPAIGN` de `catalog.js`, para que no se pueda falsear desde
la URL. Cuando exista una segunda variante de landing, cada página declara la
suya.

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

- **Primer pago de 5 productos** (`32275`, `32633`, `27386`, `31618`, `31619`):
  `firstPayment: null`. La página muestra "Consulta tu pago quincenal en tienda"
  en vez de inventar una cifra. `31619` ya tiene QR vivo en Exhibimex y Cisnes,
  así que va a recibir tráfico real.
- **Fotos de esos mismos 5**: falta `img/{clave}.jpg`, se muestra un
  placeholder con la categoría.
- **Primer pago sin enganche**: en Tetiz (1931) y Postes (1955) el monto
  financiado es mayor (`loan == cost`), así que la cifra quincenal de la lista
  del negocio —calculada con enganche— no aplica. Mientras no exista esa
  segunda lista, esas dos tiendas muestran "Consulta tu pago quincenal en
  tienda" y el enganche en verde como "Sin enganche".

- **Fichas técnicas**: el mock muestra chips reales del producto (`1100 W`,
  `1.3 ft³ · 36.8 L`, `Negro espejo`). Solo `30742` los tiene cargados, en el
  campo `specs` del catálogo. Los demás caen a un chip de marca y uno de
  categoría, que es lo único que hay en los datos actuales. Para igualar el
  mock en los 26 productos hace falta esa hoja de especificaciones.
- **Carrusel**: el mock dibuja tres puntos de galería. Solo hay una foto por
  producto, así que se omiten en vez de fingir imágenes que no existen.

El primer pago usa la lista del negocio, la misma que `landing/index.html`, no
la tabla de amortización (difieren ~0.5%).

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
| Sin foto y sin primer pago | `/?store_id=3670&product_id=31619` |
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

`catalog.js` tiene 17 tiendas y el script todavía 8, así que el catálogo genera
más URLs de las que el script conoce; lo que importa es que **ninguna de las
del script falte**. La única excepción esperada hoy son las 26 de
`3330 SanBernabe2`, tienda que el padrón oficial no incluye (ahí es
`888 Sanbernabe`).
