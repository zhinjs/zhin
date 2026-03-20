import { useState } from 'react'
import { useFiles } from '@zhin.js/client'
import { FolderOpen, Loader2, RefreshCw, AlertCircle } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { ScrollArea } from '../../components/ui/scroll-area'
import { useHljsTheme } from './use-hljs-theme'
import { TreeNode } from './tree-node'
import { FileEditor } from './file-editor'

export default function FileManagePage() {
  useHljsTheme()
  const { tree, loading, error, loadTree, readFile, saveFile } = useFiles()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">文件管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            浏览和编辑工作空间中的配置文件和源代码
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadTree()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="flex" style={{ height: '600px' }}>
            <div className="w-64 border-r flex flex-col shrink-0">
              <div className="px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">文件浏览器</span>
              </div>
              <ScrollArea className="flex-1">
                <div className="py-1">
                  {loading && tree.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : tree.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">暂无文件</p>
                  ) : (
                    tree.map((node) => (
                      <TreeNode
                        key={node.path}
                        node={node}
                        selectedPath={selectedFile}
                        onSelect={setSelectedFile}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="flex-1 min-w-0">
              {selectedFile ? (
                <FileEditor
                  key={selectedFile}
                  filePath={selectedFile}
                  readFile={readFile}
                  saveFile={saveFile}
                  onClose={() => setSelectedFile(null)}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">在左侧选择一个文件开始编辑</p>
                    <p className="text-xs mt-1 opacity-60">支持 .env、src/、package.json 等关键文件</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
