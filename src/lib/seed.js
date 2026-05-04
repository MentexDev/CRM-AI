// Datos base. Solo el admin viene preconfigurado;
// todo lo demás (productos, vendedoras, ventas, premios) arranca vacío
// para que el equipo lo pueble desde la UI o importando Excel.

export const USERNAME_PREFIX = 'NINA'
export const ADMIN_USERNAME = 'NINAbrandon.villa'
export const ADMIN_PASSWORD = 'NINA123*'

export const DEFAULT_GOAL = 3000000 // meta de ventas COP por vendedora

// Tallas usadas en la marca NINA (numéricas, según planilla de la jefa)
export const SIZES = ['6', '8', '10', '12', '14']
export const PAYMENT_METHODS = ['Efectivo', 'Tarjeta', 'Transferencia', 'Nequi', 'Daviplata']

export const emptySizes = () => Object.fromEntries(SIZES.map((s) => [s, 0]))

// Quita tildes y caracteres especiales para construir el handle
export const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')

export const buildUsername = (firstName, lastName) =>
  `${USERNAME_PREFIX}${slug(firstName)}.${slug(lastName)}`

// Solo viene la cuenta admin. Las vendedoras se crean desde el panel.
export const seedSellers = [
  {
    id: 'sel-admin',
    username: ADMIN_USERNAME,
    firstName: 'Brandon',
    lastName: 'Villa',
    password: ADMIN_PASSWORD,
    name: 'Brandon Villa',
    role: 'admin',
    avatar: 'BV',
    goal: 0,
  },
]

export const seedProducts = []
export const seedSales = []
export const seedPrizes = []
