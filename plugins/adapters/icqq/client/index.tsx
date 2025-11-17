import { addPage } from '@zhin.js/client'
import { Bot } from 'lucide-react'
import ICQQManagement from './ICQQManagement'

addPage({
  key: 'icqq-management',
  path: '/icqq',
  title: 'ICQQ管理',
  icon: <Bot className="w-5 h-5" />,
  element: <ICQQManagement/>
})
