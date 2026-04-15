import { addPage } from '@zhin.js/client'
import { Headphones } from 'lucide-react'
import KookDashboard from './Dashboard'

addPage({
  key: 'kook-management',
  path: '/kook',
  title: 'KOOK',
  icon: <Headphones className="w-5 h-5" />,
  element: <KookDashboard />,
})
