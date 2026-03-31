// @ts-nocheck
import { defineComponent, usePlugin } from 'zhin.js'

const plugin = usePlugin()
const { addComponent } = plugin

const UserBadge = defineComponent(async function UserBadge(props: { name: string; level?: number }) {
  return `👤 ${props.name} Lv.${props.level ?? 1}`
}, 'UserBadge')

addComponent(UserBadge)

export { UserBadge }