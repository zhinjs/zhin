import { useState } from 'react'
import type { FileTreeNode } from '@zhin.js/client'
import { FolderOpen, ChevronRight, ChevronDown } from 'lucide-react'
import { getFileIcon } from './file-icons'

export function TreeNode({
  node,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  node: FileTreeNode
  selectedPath: string | null
  onSelect: (path: string) => void
  depth?: number
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isSelected = node.path === selectedPath
  const isDir = node.type === 'directory'

  return (
    <div>
      <button
        className={`
          w-full flex items-center gap-1.5 px-2 py-1 text-sm rounded-sm text-left
          hover:bg-accent transition-colors
          ${isSelected ? 'bg-accent text-accent-foreground font-medium' : ''}
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (isDir) {
            setExpanded(!expanded)
          } else {
            onSelect(node.path)
          }
        }}
      >
        {isDir ? (
          expanded ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3.5" />
        )}
        {isDir ? (
          <FolderOpen className="w-4 h-4 shrink-0 text-amber-500" />
        ) : (
          getFileIcon(node.name)
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
