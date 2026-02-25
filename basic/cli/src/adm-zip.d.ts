declare module 'adm-zip' {
  interface IZipEntry {
    entryName: string;
    isDirectory: boolean;
    getData(): Buffer;
  }
  export default class AdmZip {
    constructor(buffer?: Buffer);
    getEntries(): IZipEntry[];
  }
}
