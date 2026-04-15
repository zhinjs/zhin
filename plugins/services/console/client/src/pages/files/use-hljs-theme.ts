import { useEffect } from 'react'
import { HLJS_CDN } from './editor-constants'

export function useHljsTheme() {
  useEffect(() => {
    const linkId = 'hljs-theme-css'
    let link = document.getElementById(linkId) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    const update = () => {
      const isDark = document.documentElement.classList.contains('dark')
      link!.href = `${HLJS_CDN}/${isDark ? 'github-dark' : 'github'}.min.css`
    }
    update()
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
}
