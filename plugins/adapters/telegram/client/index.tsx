import { addPage } from '@zhin.js/client'
import { Send } from 'lucide-react'
import TelegramDashboard from './Dashboard'

addPage({
  key: 'telegram-management',
  path: '/telegram',
  title: 'Telegram',
  icon: <Send className="w-5 h-5" />,
  element: <TelegramDashboard />,
})
