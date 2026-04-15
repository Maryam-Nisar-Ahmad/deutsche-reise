/**
 * When true, app-wide shortcuts must not run (and must not preventDefault).
 * Covers contenteditable, ARIA text roles, and background/hidden tabs.
 */
export function shouldIgnoreGlobalKeydown(e) {
  if (!e || typeof document === 'undefined') return true
  if (document.visibilityState !== 'visible') return true

  const path = typeof e.composedPath === 'function' ? e.composedPath() : []
  const nodes = path.length ? path : [e.target]

  for (const n of nodes) {
    if (!n) continue
    const el = n.nodeType === 3 ? n.parentElement : n
    if (!el || el.nodeType !== 1) continue

    if (el.isContentEditable) return true
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    const role = el.getAttribute?.('role')
    if (role && ['textbox', 'searchbox', 'combobox'].includes(role)) return true
  }
  return false
}
