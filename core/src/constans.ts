import * as os from 'os';
import process from 'process';
import path from 'path';

export const APP_KEY = Symbol('AppKey');
export const REQUIRED_KEY = Symbol('RequiredServices');
export const isWin = os.platform() === 'win32';
export const isMac = os.platform() === 'darwin';
export const isLinux = os.platform() === 'linux';
export const isMobile = !isLinux && !isMac && !isWin;
export const HOME_DIR = os.homedir();
export const TEMP_DIR = os.tmpdir();
export const WORK_DIR = process.env.PWD || process.cwd();
export const CONFIG_DIR = path.join(WORK_DIR, 'config');
