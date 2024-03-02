let _onigurumaPromise = null;
async function getWasmInlined() {
    if (!_onigurumaPromise) {
        // @ts-expect-error anyway
        _onigurumaPromise = import('./onig.mjs')
            .then(r => ({ data: r.default }));
    }
    return _onigurumaPromise;
}

export { getWasmInlined as default, getWasmInlined };
