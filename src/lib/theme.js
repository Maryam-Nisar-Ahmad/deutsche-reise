/** Dark is default. Light uses html.theme-light + CSS overrides in index.css */
export function applyTheme(isDark) {
  const root = document.documentElement
  if (isDark) {
    root.classList.remove('theme-light')
    root.classList.add('dark')
  } else {
    root.classList.add('theme-light')
    root.classList.remove('dark')
  }
}

export function applyThemeFromStorage() {
  try {
    const dark = localStorage.getItem('dr_dark_mode') !== 'false'
    applyTheme(dark)
  } catch {
    applyTheme(true)
  }
}
