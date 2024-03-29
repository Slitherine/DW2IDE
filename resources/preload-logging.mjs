import {ipcRenderer as ipc} from 'electron';

const consoleLog = console.log.bind(console);
const consoleWarn = console.warn.bind(console);
const consoleError = console.error.bind(console);

function windowLogParse(args) {
    const msg = args?.join(' ');
    const contextObjects = [];
    for (let i = 0; i < args.length; i++) {
        const argType = typeof args[i];
        if (argType !== 'string' && argType !== 'number' && argType !== 'boolean') {
            contextObjects.push(args[i]);
        }
    }
    return {msg, contextObjects};
}

function windowLog(...args) {
    const {msg, contextObjects} = windowLogParse(args);
    ipc.invoke('log', msg).catch(consoleWarn);
    const st = {};
    Error.captureStackTrace(st, windowLog);
    const callFrame = st.stack.split('\n').slice(1, 2).join('\n');
    if (contextObjects.length > 0)
        consoleLog(`${msg}\n${callFrame}\n`, contextObjects);
    else
        consoleLog(`${msg}\n${callFrame}`);
}

function windowWarn(...args) {
    const {msg, contextObjects} = windowLogParse(args);
    ipc.invoke('warn', msg).catch(consoleWarn);
    const st = {};
    Error.captureStackTrace(st, windowWarn);
    const callFrame = st.stack.split('\n').slice(1, 2).join('\n');
    if (contextObjects.length > 0)
        consoleWarn(`${msg}\n${callFrame}\n`, contextObjects);
    else
        consoleWarn(`${msg}\n${callFrame}`);
}

function windowError(...args) {
    const {msg, contextObjects} = windowLogParse(args);
    ipc.invoke('error', msg).catch(consoleError);
    const st = {};
    Error.captureStackTrace(st, windowError);
    const callFrame = st.stack.split('\n').slice(1, 2).join('\n');
    if (contextObjects.length > 0)
        consoleError(`${msg}\n${callFrame}\n`, contextObjects);
    else
        consoleError(`${msg}\n${callFrame}`);
}

window.log = windowLog;
window.warn = windowWarn;
window.error = windowError;
/*
window.log("logging ipc handlers registered");
window.warn("logging ipc handlers registered");
window.error("logging ipc handlers registered");
*/
