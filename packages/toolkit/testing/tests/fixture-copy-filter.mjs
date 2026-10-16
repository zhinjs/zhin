/** fs.cp supplies native platform separators; exercise both forms in the fixture tests. */
export function shouldCopyFixture(source) {
  return !['node_modules', 'lib', '.zhin'].includes(source.split(/[\\/]/u).at(-1));
}
