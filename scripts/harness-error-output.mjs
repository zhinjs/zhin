/** Keep failure summaries visible when CI limits the size of one log write. */
export function printHarnessError(details, write = console.error) {
  for (const line of details.split(/\r?\n/u)) {
    if (line.length === 0) write('');
    for (let offset = 0; offset < line.length; offset += 2000) {
      write(line.slice(offset, offset + 2000));
    }
  }
}
