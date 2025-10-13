import { useEffect } from 'react'
export default function TestPage() {
  useEffect(() => {
    console.log('TestPage')
  }, [])
  return <div>TestPage</div>
}