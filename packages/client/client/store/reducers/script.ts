import { createSlice, PayloadAction, createAsyncThunk } from "@reduxjs/toolkit"

export interface ScriptState {
    entries: string[]
    loadedScripts: string[]
    /** 是否已收到 WebSocket 的首次 entries 同步 */
    synced: boolean
}

const initialState: ScriptState = {
    entries: [],
    loadedScripts: [],
    synced: false
}

// AsyncThunk: 加载单个脚本
export const loadScript = createAsyncThunk(
    'script/loadScript',
    async (src: string) => {
        return new Promise<string>((resolve, reject) => {
            const script = document.createElement('script')
            script.type = 'module'
            script.src = src
            script.dataset.dynamicEntry = 'true'
            
            script.onload = () => resolve(src)
            script.onerror = (error) => {
                console.error('[Script] Load failed:', src)
                reject(error)
            }

            document.body.appendChild(script)
        })
    }
)

// AsyncThunk: 批量加载脚本
export const loadScripts = createAsyncThunk(
    'script/loadScripts',
    async (entries: string[], { dispatch }) => {
        const results = await Promise.allSettled(
            entries.map(entry => dispatch(loadScript(entry)).unwrap())
        )
        
        return results
            .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
            .map(r => r.value)
    }
)

// AsyncThunk: 卸载脚本
export const unloadScript = createAsyncThunk(
    'script/unloadScript',
    async (src: string) => {
        const scripts = document.querySelectorAll(`script[src="${src}"][data-dynamic-entry="true"]`)
        scripts.forEach(script => script.remove())
        return src
    }
)

const scriptSlice = createSlice({
    name: 'script',
    initialState,
    reducers: {
        syncEntries: (state, action: PayloadAction<string[]>) => {
            state.entries = action.payload
            state.synced = true
        },
        
        addEntry: (state, action: PayloadAction<string>) => {
            if (!state.entries.includes(action.payload)) {
                state.entries.push(action.payload)
            }
        },
        
        removeEntry: (state, action: PayloadAction<string>) => {
            state.entries = state.entries.filter(e => e !== action.payload)
            state.loadedScripts = state.loadedScripts.filter(s => s !== action.payload)
        }
    },
    extraReducers: (builder) => {
        // loadScript 成功
        builder.addCase(loadScript.fulfilled, (state, action) => {
            if (!state.loadedScripts.includes(action.payload)) {
                state.loadedScripts.push(action.payload)
            }
        })
        
        // loadScripts 成功
        builder.addCase(loadScripts.fulfilled, (state, action) => {
            action.payload.forEach(src => {
                if (!state.loadedScripts.includes(src)) {
                    state.loadedScripts.push(src)
                }
            })
        })
        
        // unloadScript 成功
        builder.addCase(unloadScript.fulfilled, (state, action) => {
            state.loadedScripts = state.loadedScripts.filter(s => s !== action.payload)
        })
    }
})

export const { syncEntries, addEntry, removeEntry } = scriptSlice.actions
export default scriptSlice.reducer

