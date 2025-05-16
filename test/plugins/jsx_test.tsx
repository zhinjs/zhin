import { useCommand } from 'zhin';
const Foo=({foo}:{foo:string})=>{
  return <>
    <mention user_id={foo}/>
    hello world
    <face id={'121'}/>
  </>
}
const Bar=()=><>
  <Foo foo='""'/>
  <Foo foo=""/>
</>
useCommand('foo').action(()=><Bar/>)