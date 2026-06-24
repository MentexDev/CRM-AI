// netguard.ts — utilidades anti-SSRF para descargas server-side de URLs externas.
// Bloquea hosts loopback/privados/link-local/metadata de la nube (169.254.x). Se usa al
// ESPEJAR imágenes de proveedores externos (fal, etc.) a nuestro Storage: aunque la URL venga
// de una respuesta autenticada, validamos por defensa-en-profundidad (la misma lógica que ya
// aplica geminiImage.ts a las referencias que emite el LLM).
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '') // sin brackets de IPv6
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = Number(m[1]), b = Number(m[2])
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local / metadata de la nube
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  }
  return false
}
