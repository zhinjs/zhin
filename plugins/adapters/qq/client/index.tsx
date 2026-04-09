import { addPage } from '@zhin.js/client'
import { MessageSquare } from 'lucide-react'
import QQDashboard from './Dashboard'

addPage({
  key: 'qq-management',
  path: '/qq',
  title: 'QQ官方',
  icon: <MessageSquare className="w-5 h-5" />,
  element: <QQDashboard />,
})
