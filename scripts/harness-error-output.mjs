/** Keep failure summaries visible when CI limits the size of one log write. */
export function printHarnessError(details, write = console.error) {
  for (const line of details.split(/\r?\n/u)) {
    let chunk = '';
    for (const character of line) {
      if (chunk.length + character.length > 2000) {
        write(chunk);
        chunk = '';
      }
      chunk += character;
    }
    if (chunk || line.length === 0) write(chunk);
  }
}
