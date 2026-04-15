import { createSlice, PayloadAction } from "@reduxjs/toolkit"

export interface UIState {
    sidebarOpen: boolean
    activeMenu: string
}

const initialState: UIState = {
    sidebarOpen: true,
    activeMenu: 'home'
}

const uiSlice = createSlice({
    name: 'ui',
    initialState,
    reducers: {
        toggleSidebar: (state) => {
            state.sidebarOpen = !state.sidebarOpen
        },
        setSidebarOpen: (state, action: PayloadAction<boolean>) => {
            state.sidebarOpen = action.payload
        },
        setActiveMenu: (state, action: PayloadAction<string>) => {
            state.activeMenu = action.payload
        }
    }
})

export const { toggleSidebar, setSidebarOpen, setActiveMenu } = uiSlice.actions
export default uiSlice.reducer

