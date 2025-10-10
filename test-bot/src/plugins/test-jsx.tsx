import { addCommand, MessageCommand } from 'zhin.js'

addCommand(new MessageCommand('test-jsx').action(async (message, result) => {
  return (
    <>
    hi world
    <face id={66}/>
    </>
  )
}))