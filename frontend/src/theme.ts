export function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function toggleDarkMode(): boolean {
  const isDark = document.documentElement.classList.toggle('dark');
  try {
    localStorage.setItem('capy_theme', isDark ? 'dark' : 'light');
  } catch {}
  return isDark;
}
