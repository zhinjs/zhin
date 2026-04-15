import { File, FileCode } from 'lucide-react'

export function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
      return <FileCode className="w-4 h-4 text-blue-500" />
    case 'js':
    case 'jsx':
      return <FileCode className="w-4 h-4 text-yellow-500" />
    case 'json':
      return <File className="w-4 h-4 text-green-500" />
    case 'yml':
    case 'yaml':
      return <File className="w-4 h-4 text-red-400" />
    case 'md':
      return <File className="w-4 h-4 text-gray-400" />
    case 'env':
      return <File className="w-4 h-4 text-orange-500" />
    default:
      if (name.startsWith('.env')) return <File className="w-4 h-4 text-orange-500" />
      return <File className="w-4 h-4 text-muted-foreground" />
  }
}
