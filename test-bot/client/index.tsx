import {addPage} from '@zhin.js/client';
import {Puzzle} from 'lucide-react';
import TestPage from './TestPage'
addPage({
  key: 'test-page',
  path: '/test',
  title: '测试',
  icon: <Puzzle className="w-5 h-5" />,
  element: <TestPage />
})