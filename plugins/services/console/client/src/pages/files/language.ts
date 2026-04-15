export function getLanguage(fileName: string): string | null {
  const name = fileName.split('/').pop()?.toLowerCase() || ''
  if (name === '.env' || name.startsWith('.env.')) return 'ini'
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts': case 'tsx': return 'typescript'
    case 'js': case 'jsx': return 'javascript'
    case 'css': return 'css'
    case 'scss': return 'scss'
    case 'less': return 'less'
    case 'json': return 'json'
    case 'yml': case 'yaml': return 'yaml'
    case 'md': return 'markdown'
    case 'xml': case 'html': return 'xml'
    case 'sh': case 'bash': return 'bash'
    default: return null
  }
}
