import { useState, useMemo, type MouseEvent } from 'react'
import { useDatabase } from '@zhin.js/client'
import type { DatabaseType, TableInfo } from '@zhin.js/client'
import { Database as DatabaseIcon, Table2, Trash2, RefreshCw, Loader2, AlertCircle, Key } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { ScrollArea } from '../../components/ui/scroll-area'
import { PageHeader } from '../../components/PageHeader'
import { DB_TYPE_LABELS, DIALECT_LABELS } from './constants'
import { RelatedTableView } from './related-table-view'
import { DocumentCollectionView } from './document-collection-view'
import { KvBucketView } from './kv-bucket-view'

export default function DatabasePage() {
  const {
    info, tables, loading, error,
    loadInfo, loadTables, dropTable,
    select, insert, update, remove,
    kvGet, kvSet, kvDelete, kvEntries,
  } = useDatabase()

  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const selectedTableInfo = useMemo(() => tables.find((t: TableInfo) => t.name === selectedTable), [tables, selectedTable])
  const dbType: DatabaseType = info?.type ?? 'related'

  return (
    <div className="space-y-6">
      <PageHeader
        title="数据库管理"
        description={`浏览和管理 ${DB_TYPE_LABELS[dbType]} 中的数据；左栏选择对象，右侧查看与编辑。`}
        actions={
          <div className="flex items-center gap-2">
            {info && (
              <Badge variant="secondary" className="font-normal">
                {DIALECT_LABELS[info.dialect] || info.dialect} · {DB_TYPE_LABELS[info.type]}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => { loadInfo().catch(() => {}); loadTables().catch(() => {}) }} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新
            </Button>
          </div>
        }
      />

      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardContent className="p-0">
          <div className="flex min-h-[min(520px,calc(100vh-11rem))]">
            <div className="w-56 border-r flex flex-col shrink-0">
              <div className="px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {dbType === 'related' ? '数据表' : dbType === 'document' ? '集合' : '桶'}
                </span>
              </div>
              <ScrollArea className="flex-1">
                <div className="py-1">
                  {loading && !tables.length ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : !tables.length ? (
                    <p className="text-sm text-muted-foreground text-center py-8">暂无数据</p>
                  ) : tables.map((t: TableInfo) => (
                    <div
                      key={t.name}
                      role="button"
                      tabIndex={0}
                      className={`
                        group w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left
                        hover:bg-accent transition-colors rounded-sm cursor-pointer
                        ${selectedTable === t.name ? 'bg-accent text-accent-foreground font-medium' : ''}
                      `}
                      onClick={() => setSelectedTable(t.name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedTable(t.name)
                        }
                      }}
                    >
                      {dbType === 'keyvalue' ? <Key className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <Table2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                      <span className="truncate flex-1">{t.name}</span>
                      {t.columns && <Badge variant="secondary" className="ml-auto text-[10px] px-1 py-0">{Object.keys(t.columns).length}</Badge>}
                      <Button
                        size="sm" variant="ghost"
                        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-destructive shrink-0"
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation()
                          const label = dbType === 'related' ? '表' : dbType === 'document' ? '集合' : '桶'
                          if (!confirm(`确定要删除${label} "${t.name}" 吗？此操作不可撤销！`)) return
                          dropTable(t.name).then(() => {
                            if (selectedTable === t.name) setSelectedTable(null)
                          }).catch(() => {})
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="flex-1 min-w-0 p-4">
              {selectedTable ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <Table2 className="w-5 h-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">{selectedTable}</h2>
                    {selectedTableInfo?.columns && (
                      <div className="flex gap-1 ml-2 flex-wrap">
                        {(Object.entries(selectedTableInfo.columns) as [string, { type: string; primary?: boolean }][]).slice(0, 8).map(([col, def]) => (
                          <Badge key={col} variant="outline" className="text-[10px] px-1.5 py-0">
                            {col}{def.primary ? ' 🔑' : ''}: {def.type}
                          </Badge>
                        ))}
                        {Object.keys(selectedTableInfo.columns).length > 8 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">+{Object.keys(selectedTableInfo.columns).length - 8}</Badge>
                        )}
                      </div>
                    )}
                  </div>

                  {dbType === 'keyvalue' ? (
                    <KvBucketView
                      key={selectedTable}
                      tableName={selectedTable}
                      kvGet={kvGet}
                      kvSet={kvSet}
                      kvDelete={kvDelete}
                      kvEntries={kvEntries}
                    />
                  ) : dbType === 'document' ? (
                    <DocumentCollectionView
                      key={selectedTable}
                      tableName={selectedTable}
                      select={select}
                      insert={insert}
                      update={update}
                      remove={remove}
                    />
                  ) : (
                    <RelatedTableView
                      key={selectedTable}
                      tableName={selectedTable}
                      tableInfo={selectedTableInfo}
                      select={select}
                      insert={insert}
                      update={update}
                      remove={remove}
                    />
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <DatabaseIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">
                      在左侧选择{dbType === 'related' ? '一个表' : dbType === 'document' ? '一个集合' : '一个桶'}开始管理
                    </p>
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
