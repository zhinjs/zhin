import { addPage } from '@zhin.js/client'
import { Gamepad2 } from 'lucide-react'
import DiscordDashboard from './Dashboard'

addPage({
  key: 'discord-management',
  path: '/discord',
  title: 'Discord',
  icon: <Gamepad2 className="w-5 h-5" />,
  element: <DiscordDashboard />,
})
