// Theme configuration - Zinc black/white/gray palette for shadcn/ui
export const themes = {
  light: {
    background: '0 0% 100%',
    foreground: '240 10% 3.9%',
    card: '0 0% 100%',
    'card-foreground': '240 10% 3.9%',
    popover: '0 0% 100%',
    'popover-foreground': '240 10% 3.9%',
    primary: '240 5.9% 10%',
    'primary-foreground': '0 0% 98%',
    secondary: '240 4.8% 95.9%',
    'secondary-foreground': '240 5.9% 10%',
    muted: '240 4.8% 95.9%',
    'muted-foreground': '240 3.8% 46.1%',
    accent: '240 4.8% 95.9%',
    'accent-foreground': '240 5.9% 10%',
    destructive: '0 84.2% 60.2%',
    'destructive-foreground': '0 0% 98%',
    border: '240 5.9% 90%',
    input: '240 5.9% 90%',
    ring: '240 5.9% 10%',
    radius: '0.5rem',
    'chart-1': '240 5.9% 10%',
    'chart-2': '240 3.8% 46.1%',
    'chart-3': '240 5.9% 90%',
    'chart-4': '240 4.8% 95.9%',
    'chart-5': '0 0% 100%',
    sidebar: '0 0% 98%',
    'sidebar-foreground': '240 5.3% 26.1%',
    'sidebar-primary': '240 5.9% 10%',
    'sidebar-primary-foreground': '0 0% 98%',
    'sidebar-accent': '240 4.8% 95.9%',
    'sidebar-accent-foreground': '240 5.9% 10%',
    'sidebar-border': '220 13% 91%',
    'sidebar-ring': '240 5.9% 10%',
  },
  dark: {
    background: '240 10% 3.9%',
    foreground: '0 0% 98%',
    card: '240 10% 3.9%',
    'card-foreground': '0 0% 98%',
    popover: '240 10% 3.9%',
    'popover-foreground': '0 0% 98%',
    primary: '0 0% 98%',
    'primary-foreground': '240 5.9% 10%',
    secondary: '240 3.7% 15.9%',
    'secondary-foreground': '0 0% 98%',
    muted: '240 3.7% 15.9%',
    'muted-foreground': '240 5% 64.9%',
    accent: '240 3.7% 15.9%',
    'accent-foreground': '0 0% 98%',
    destructive: '0 62.8% 30.6%',
    'destructive-foreground': '0 0% 98%',
    border: '240 3.7% 15.9%',
    input: '240 3.7% 15.9%',
    ring: '240 4.9% 83.9%',
    radius: '0.5rem',
    'chart-1': '0 0% 98%',
    'chart-2': '240 5% 64.9%',
    'chart-3': '240 3.7% 15.9%',
    'chart-4': '240 10% 3.9%',
    'chart-5': '240 5.9% 10%',
    sidebar: '240 5.9% 10%',
    'sidebar-foreground': '240 4.8% 95.9%',
    'sidebar-primary': '0 0% 98%',
    'sidebar-primary-foreground': '240 5.9% 10%',
    'sidebar-accent': '240 3.7% 15.9%',
    'sidebar-accent-foreground': '240 4.8% 95.9%',
    'sidebar-border': '240 3.7% 15.9%',
    'sidebar-ring': '240 4.9% 83.9%',
  },
} as const

export type Theme = keyof typeof themes
export type ThemeColors = typeof themes.light

// Apply theme to document
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  const colors = themes[theme]

  // Remove old theme class
  root.classList.remove('light', 'dark')
  // Add new theme class
  root.classList.add(theme)

  // Apply CSS variables
  Object.entries(colors).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value)
  })

  // Save to localStorage
  localStorage.setItem('theme', theme)
}

// Get current theme from localStorage or system preference
export function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme') as Theme | null
  if (stored && (stored === 'light' || stored === 'dark')) {
    return stored
  }

  // Check system preference
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }

  return 'light'
}

// Initialize theme on app load
export function initializeTheme() {
  const theme = getInitialTheme()
  applyTheme(theme)
  return theme
}
