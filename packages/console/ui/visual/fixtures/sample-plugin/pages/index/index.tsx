/** Fixture for auditPluginPages (visual/audit.spec.ts): a hand-written plugin page built from @zhin.js/console-ui. */
import './style.css'
import { Button, Card, CardContent, CardHeader, CardTitle, Section, StatusBadge, usePageChrome } from '@zhin.js/console-ui'

export const meta = { title: '示例插件页', description: '审计用的手写插件页面。' }

export default function SamplePage() {
  usePageChrome({ actions: <Button variant="outline">导出</Button> })
  return (
    <Section title="状态">
      <Card>
        <CardHeader><CardTitle>连接</CardTitle></CardHeader>
        <CardContent><StatusBadge status="ok">运行中</StatusBadge></CardContent>
      </Card>
      <p data-zhin-ui-ignore="spacing: 夹具：故意的尺度外内边距，用来验证豁免" className="sample-exempt">已豁免</p>
    </Section>
  )
}
