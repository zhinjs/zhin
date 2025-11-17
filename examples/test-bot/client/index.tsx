import {addPage} from '@zhin.js/client';
import TestPage from './TestPage'
import { Trash2 } from 'lucide-react'
addPage({
  key: 'test-page',
  path: '/test',
  title: '测试',
  icon: <Trash2 className="w-5 h-5" />,
  element: <TestPage />
})