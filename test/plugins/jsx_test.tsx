import { useCommand } from 'zhin';
const Foo=({foo}:{foo:string})=>{
  return <>
    <image url={foo}/>
    hello world
    <face id={'111'}/>
  </>
}
const Bar=()=><>
  <Foo foo='""'/>
  <Foo foo=""/>
</>
useCommand('foo').action(()=><Bar/>)