import {addPage} from '@zhin.js/client';
addPage({
    parentName:'Zhin',
    path:'/test',
    name:"Test",
    component:() => import('./test.vue')
})