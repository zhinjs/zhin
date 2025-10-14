import {addPage} from '@zhin.js/client';
import {Trash2} from 'lucide-react';
import TestPage from './TestPage'
addPage({
  key: 'test-page',
  path: '/test',
  title: '测试',
  icon: <Trash2 className="w-5 h-5" />,
  element: <TestPage />
})