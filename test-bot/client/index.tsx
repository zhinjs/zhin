import {addPage} from '@zhin.js/client';
import { Puzzle } from 'lucide-react'
const Test = () => {
    return <div>Test</div>
}
addPage({
    ket:'Test',
    path:'/test',
    icon:<Puzzle/>,
    title:"Test",
    element:<Test/>
})