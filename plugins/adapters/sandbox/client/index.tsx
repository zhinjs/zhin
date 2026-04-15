import { addPage } from '@zhin.js/client'
import { Terminal } from 'lucide-react'
import Sandbox from './Sandbox'
addPage({
  key: 'process-sandbox',
  path: '/sandbox',
  title: '沙盒',
  icon: <Terminal className="w-5 h-5" />,
  element: <Sandbox/>
})

