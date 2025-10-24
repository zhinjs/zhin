import { useTheme } from '../hooks/useTheme'
import { Icons } from '@zhin.js/client'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      className="p-2 hover:bg-accent rounded-lg transition-colors text-foreground"
      title={theme === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
    >
      {theme === 'light' ? (
        <Icons.Moon className="w-5 h-5" />
      ) : (
        <Icons.Sun className="w-5 h-5" />
      )}
    </button>
  )
}

