import { Reducer } from "@reduxjs/toolkit"
import ui from "./ui"
import route from "./route"
import script from "./script"

export interface Reducers {
    ui: ReturnType<typeof ui>
    route: ReturnType<typeof route>
    script: ReturnType<typeof script>
}

export const reducers: Record<keyof Reducers, Reducer<any, any>> = {
    ui,
    route,
    script
}