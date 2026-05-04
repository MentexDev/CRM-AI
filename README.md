# WEIN · NINA Inventary

Software de inventario y ventas para la marca **NINA** durante la feria **WEIN** en Medellín.
Cada vendedora registra sus ventas desde su propia cuenta y la administración ve en tiempo real
inventario inicial, ventas, inventario final, ranking y premios desbloqueados.

---

## Índice

1. [Stack](#stack)
2. [Empezar local](#empezar-local)
3. [Cuenta admin](#cuenta-admin)
4. [Variables de entorno (Supabase)](#variables-de-entorno-supabase)
5. [Schema y datos en Supabase](#schema-y-datos-en-supabase)
6. [Importar inventario desde Excel](#importar-inventario-desde-excel)
7. [Deploy en Cloudflare Pages](#deploy-en-cloudflare-pages)
8. [Estructura del proyecto](#estructura-del-proyecto)
9. [Funcionalidades](#funcionalidades)

---

## Stack

- **Vite + React 18** — frontend SPA
- **Tailwind CSS** — paleta blanco · negro · plateado de la marca NINA
- **Framer Motion** — animaciones (logo cromado, transiciones de tabs, barras de progreso)
- **Supabase** — autenticación y base de datos en producción
- **Cloudflare Pages** — hosting estático del frontend
- **xlsx (SheetJS)** — importación de inventario desde Excel
- **React Router · Lucide · React Hot Toast**

---

## Empezar local

```bash
npm install
npm run dev
```

Abre <http://localhost:5173>

Sin variables de entorno funciona en **modo local**: los datos se guardan en `localStorage`
del navegador. Útil para probar la UI pero **cada dispositivo tiene su propio estado** —
para producción configura Supabase (siguiente sección).

---

## Cuenta admin

| Rol | Usuario | Contraseña |
|---|---|---|
| Administrador | `NINAbrandon.villa` | `NINA123*` |

Las **vendedoras se crean desde el panel admin** con formato `NINA + nombre.apellido`. La
contraseña se asigna al crearla y se le entrega a la vendedora.

---

## Variables de entorno (Supabase)

1. Crea un proyecto gratuito en <https://supabase.com>
2. Copia `URL` y `anon key` desde **Settings → API**
3. Crea `.env` en la raíz del proyecto:

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

> En Cloudflare Pages estas variables se configuran en **Settings → Environment variables**
> (las dos para Production y Preview).

---

## Schema y datos en Supabase

1. Ve a **SQL Editor** del proyecto Supabase
2. Pega y ejecuta [`supabase/schema.sql`](supabase/schema.sql) — crea tablas, RLS y funciones
   transaccionales (`register_sale`, `cancel_sale`)
3. Ve a **Authentication → Users → Add user → Create new user** y crea el admin con:
   - Email: `brandonmilan1998@gmail.com` (o el que prefieras)
   - Password: `NINA123*`
   - Auto Confirm User: ✅
4. Ejecuta [`supabase/seed.sql`](supabase/seed.sql) para promoverlo a admin y cargar premios
   demo (puedes saltarte esto y crear todo desde la UI)

> Las **vendedoras** las creas desde el panel admin. El sistema crea su `auth.user`
> internamente al guardar.

---

## Importar inventario desde Excel

En **Inventario → Importar Excel** puedes subir un archivo `.xlsx`, `.xls` o `.csv`.

### Formato esperado

Una fila por referencia. La primera fila es el encabezado.

| Columna | Obligatoria | Ejemplo | Notas |
|---|---|---|---|
| **Referencia** | Sí | `20210` | Código único; si ya existe, se actualiza |
| **Nombre** | Sí | `Vestido Sirena Plata` | |
| **Precio** | Sí | `189000` | En COP, sin separadores |
| **Talla 6** | Sí | `6` | Cantidad inicial en talla 6 |
| **Talla 8** | Sí | `8` | |
| **Talla 10** | Sí | `6` | |
| **Talla 12** | Sí | `9` | |
| **Talla 14** | Sí | `5` | |
| **Categoria** | No | `Vestidos` | |
| **Color** | No | `Plateado` | |
| **Costo** | No | `78000` | Para márgenes |

> Sinónimos aceptados en el encabezado (case-insensitive, sin tildes): `ref`, `sku`,
> `producto`, `descripcion`, `talla6`, `t6`, etc. Puedes descargar la plantilla exacta desde
> el botón **Plantilla** del importador.

### Comportamiento

- Si la **referencia ya existe** → se actualiza (no se duplica)
- Si la **referencia es nueva** → se crea con `initialSizes` = stock cargado
- Las filas con errores (sin precio, sin nombre…) se muestran como advertencia y se omiten
- Antes de confirmar ves una **vista previa** con todas las filas

---

## Deploy en Cloudflare Pages

### Opción A — desde el dashboard (recomendado)

1. Conecta tu repo de GitHub a Cloudflare Pages
2. **Build settings**:
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Build output directory: `dist`
3. **Environment variables** (Production y Preview):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Cloudflare detecta `public/_redirects` y `public/_headers` automáticamente

### Opción B — desde la CLI

```bash
npm install -g wrangler
wrangler login
npm run deploy
```

El script `deploy` corre `vite build` y publica `dist/` al proyecto
`wein-nina-inventary` en Cloudflare Pages.

### Archivos relevantes

- [`public/_redirects`](public/_redirects) — `/* /index.html 200` para que React Router
  funcione en URLs profundas (ej. `/admin/vendedoras` recargado)
- [`public/_headers`](public/_headers) — cache largo en `/assets/*`, headers de seguridad
- [`wrangler.toml`](wrangler.toml) — config para `wrangler pages deploy`

---

## Estructura del proyecto

```
src/
  context/
    AuthContext.jsx      Login/logout, registro de vendedoras (Supabase + fallback local)
    DataContext.jsx      Productos, ventas, premios + funciones derivadas
  pages/
    Login.jsx
    admin/
      AdminLayout.jsx    Tabs animados
      Overview.jsx       Resumen general con stats y top vendedoras
      Inventory.jsx      Tabla Excel con tabs Inicial / Final
      Sellers.jsx        CRUD de vendedoras + meta editable
      Sales.jsx          Historial con filtro y anular venta
      Ranking.jsx        Podio + premios por meta
      Prizes.jsx         CRUD de premios (por monto o por unidades)
    seller/
      SellerDashboard.jsx  Catálogo, registro de ventas, progreso, premios
  components/
    Logo.jsx             Texto cromado animado WEIN · NINA
    TopBar.jsx
    Modal.jsx
    SaleModal.jsx        Modal multi-ítem con cliente y descuento %
    ImportInventoryModal.jsx  Importador Excel con vista previa
    ProgressBar.jsx
    StatCard.jsx
    EmptyState.jsx
  lib/
    supabase.js          Cliente Supabase con fallback a modo local
    seed.js              Tallas, métodos de pago, slug, admin seed
    format.js            fmtCOP, fmtDate, prizeProgress, etc.
public/
  _redirects             SPA routing en Cloudflare
  _headers               Cache + security headers
  nina.svg               Favicon
supabase/
  schema.sql             Tablas, RLS, funciones transaccionales
  seed.sql               Promover admin + premios demo
wrangler.toml            Config Cloudflare Pages
vite.config.js           Code splitting (xlsx, motion, supabase, icons)
tailwind.config.js       Paleta NINA (silver gradient, animaciones)
```

---

## Funcionalidades

### Admin

- **Resumen**: ventas totales, unidades, stock, valor de inventario, ranking, últimas ventas
- **Inventario** (vista Excel):
  - Tabs **Inicial** (editable inline) / **Final** (calculado, con vendidas resaltadas)
  - Importar desde Excel con vista previa
  - Crear referencias manualmente con stock por talla
  - Búsqueda por nombre, referencia, color
- **Vendedoras**:
  - Crear con `nombre.apellido` → genera username `NINAnombre.apellido`
  - Editar contraseña, eliminar, copiar usuario al portapapeles
  - **Meta editable rápido** con atajos $1M / $2M / $3M / $5M / $10M
- **Ventas**:
  - Historial completo con vendedora, ref, talla, pago, descuento, cliente
  - Anular venta → devuelve stock automáticamente
  - **Registrar venta** con selector de vendedora
- **Ranking**: podio top 3 + premios desbloqueados
- **Premios**:
  - CRUD con tipo `Por monto` (COP) o `Por unidades` vendidas
  - Selector visual de íconos (12 emojis preset)
  - Atajos numéricos en metas

### Vendedora

- Hero con su nombre, total vendido, meta personalizada y barra de progreso animada
- Card de **próximo premio** con ícono flotante y "te faltan X"
- Catálogo en formato tabla compacta (referencia + tallas + precio)
- **Registrar venta multi-ítem**: agregar varios productos en un solo pedido
  - Selector de talla con stock disponible
  - Método de pago (Efectivo, Tarjeta, Transferencia, Nequi, Daviplata)
  - Descuento en **%** con atajos 5/10/15/20/30/50
  - Datos del cliente opcionales (Nombre, Cédula, Celular, Correo, Dirección)
- Historial de sus propias ventas
- Premios desbloqueados con badge verde

---

## Soporte

Cualquier ajuste para la feria — más métricas, exportar reporte, modo offline, escáner de
código de barras — se conversa con Brandon (admin del proyecto).
