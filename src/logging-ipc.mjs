import {ipcMain as ipc} from 'electron';

export function RegisterLoggingIpcHandler() {

    const stdout = process.stdout;
    const stderr = process.stderr;

    ipc.handle('log', async (event, arg) => {
        if (typeof arg === 'string') {
            console.log(arg);
        } else if (Array.isArray(arg)) {
            console.log(...arg);
        }
    });

    ipc.handle('warn', async (event, arg) => {
        if (typeof arg === 'string') {
            console.warn(arg);
        } else if (Array.isArray(arg)) {
            console.warn(...arg);
        }
    });

    ipc.handle('error', async (event, arg) => {
        if (typeof arg === 'string') {
            console.error(arg);
        } else if (Array.isArray(arg)) {
            console.error(...arg);
        }
    });
}