import {BrowserWindow, dialog, ipcMain as ipc, nativeTheme as theme, session} from "electron/main";
import path from "node:path";
import {ResolvePath} from './scheme-app-dw2ide.mjs';
import * as electron from 'electron';
import ResourcesPath from './resources-path.mjs';
import {asyncLocalStorage} from './background.mjs';

function BrowserWindowUpdateHack(browser) {
    browser.setBackgroundColor('#00000000');
    //browser.setMinimizable(false);
    LastWindowCommand = new Date();
}

/** Creates a BrowserWindow for the specified url.
 * @param {string} url - the url to create a window for
 * @param {number?} width - the width of the window
 * @param {number?} height - the height of the window
 * @param {string?} preload - the preload url to use
 * @returns {Promise<BrowserWindow>}
 */
export async function CreateWindowAsync(url, width, height, preload) {
    if (!url) throw new Error("url parameter is required.");
    console.log(`Creating window: ${url}`);
    if (!Number.isInteger(width)) width = 800;
    if (!Number.isInteger(height)) height = 600;

    /** @type BrowserWindowConstructorOptions */
    const options = {
        show: true,
        width: width,
        height: height,
        title: "DW2IDE: " + url,
        icon: path.join(ResourcesPath, 'icons', 'icon.ico'),
        transparent: true,
        autoHideMenuBar: true,
        menuBarVisible: false,
        resizable: true,
        frame: true,
        thickFrame: false,
        roundedCorners: true,
        maximizable: false,
        minimizable: false,
        backgroundColor: '#00000000',
        backgroundMaterial: 'mica',
        webPreferences: {
            sandbox: false,
            nodeIntegration: true,
            contextIsolation: false,
            nodeIntegrationInWorker: true,
            nodeIntegrationInSubFrames: true,
            backgroundThrottling: false,
            defaultEncoding: 'UTF-8',
            /*experimentalFeatures: true,*/
            plugins: true,
            additionalArguments: [`--kickoff-url=${url}`]
        }
    };

    if (preload) {
        if (preload.startsWith('app://'))
            preload = ResolvePath(new URL(preload));
        options.webPreferences.preload = preload;
    }

    const browser = new BrowserWindow(options);
    browser.webContents.openDevTools({activate: false});

    TransparentWindows.add(browser);

    browser.on('blur', () => BrowserWindowUpdateHack(browser));
    browser.on('focus', () => BrowserWindowUpdateHack(browser));
    browser.on('moved', () => BrowserWindowUpdateHack(browser));
    browser.on('resized', () => BrowserWindowUpdateHack(browser));
    browser.on('enter-full-screen', () => BrowserWindowUpdateHack(browser));
    browser.on('enter-html-full-screen', () => BrowserWindowUpdateHack(browser));
    browser.on('leave-full-screen', () => BrowserWindowUpdateHack(browser));
    browser.on('leave-html-full-screen', () => BrowserWindowUpdateHack(browser));
    browser.on('restore', () => BrowserWindowUpdateHack(browser));
    browser.on('maximize', () => BrowserWindowUpdateHack(browser));
    browser.on('unmaximize', () => BrowserWindowUpdateHack(browser));
    browser.on('responsive', () => BrowserWindowUpdateHack(browser));

    const [w, h] = browser.getSize();
    browser.setSize(w, h);

    BrowserWindowUpdateHack(browser);

    browser.setResizable(true);
    browser.focus();
    browser.removeMenu();

    browser.webContents.setWindowOpenHandler(({url}) => {
        console.log(`WindowOpenHandler: ${url}`);
        CreateWindowAsync(url, 800, 600, preload);
        return {action: 'deny'};
    });

    browser.loadURL(url)
        .catch(error => console.error(error));

    return browser;
}

/**
 * @typedef {{
 * pointer: {x: number, y: number, id: number},
 * window: {x: number, y: number, w: number, h: number},
 * dir: 'left' | 'right' | 'bottom' | 'bottom left' | 'bottom right'
 * }} PointerWindowResizeAnchor
 */

/** @type {WeakSet<import('electron/main').BrowserWindow>} */
const TransparentWindows = new WeakSet();

/** @type {WeakMap<import('electron/main').BrowserWindow, PointerWindowResizeAnchor>} */
const WindowActiveResizeAnchors = new WeakMap();

let LastWindowCommand = new Date();

/**
 * Creates an IPC handler for the 'resize-window' event.
 * The start event will be a string with the following format: 'start <direction>;<pointerX>,<pointerY>,<pointerId>'.
 * The coordinates will be in screen coordinates.
 * The direction will be one of 'left', 'right', 'bottom', 'bottom left', 'bottom right'.
 * Note that directions for 'top', 'top left', 'top right' are not implemented.
 * The event to end a resize operation will be a string of simply 'end'.
 *
 * @return {void}
 */
export function RegisterWindowingIpcHandlers() {

    ipc.handle('change-native-theme', async (event, preferredTheme) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;
        switch (preferredTheme) {
            // basically just a whitelist of valid themes
            case 'system':
            case 'light':
            case 'dark':
                theme.themeSource = preferredTheme;
                asyncLocalStorage.setItem('preferred-theme', preferredTheme)
                    .catch(error => console.error(error));
                return true;
        }
        return false;
    });

    ipc.handle('dev-tools', (event, arg) => {
        //const window = BrowserWindow.fromWebContents(event.sender);
        if (arg === 'open') {
            event.sender.openDevTools();
        } else if (arg === 'close') {
            event.sender.closeDevTools();
        }
    });

    ipc.handle('capture-page', async (event, arg) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        try {
            return await window.capturePage(arg);
        } catch (error) {
            return {error};
        }
    });

    ipc.handle('reload', (event, arg) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window.reload();
    });

    ipc.handle('show-open-dialog', async (event, arg) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        try {
            return await dialog.showOpenDialog(window, arg);
        } catch (error) {
            return {canceled: true, filePaths: [], error};
        }
    });

    ipc.handle('show-save-dialog', async (event, arg) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        try {
            return await dialog.showSaveDialog(window, arg);
        } catch (error) {
            return {canceled: true, filePath: '', error};
        }
    });

    ipc.handle('show-message-box', async (event, arg) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        try {
            return await dialog.showMessageBox(window, arg);
        } catch (error) {
            return {response: 0, checkboxChecked: false, error};
        }
    });

    ipc.handle('show-error-box', (event, arg) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        try {
            dialog.showErrorBox(arg['title'], arg['content']);
            return {}; // no error
        } catch (error) {
            return {error};
        }
    });

    let windowStateMap = new Map();

    ipc.handle('window-command', async (event, arg) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window
            || !window.isVisible()
            || LastWindowCommand.getTime() + 100 > new Date().getTime())
            return;
        LastWindowCommand = new Date();
        if (arg === 'grow') {
            if (!window.isFocused()) {
                window.focus();
            } else if (window.isMinimized()) {
                window.restore();
                windowStateMap.set(window.id,
                    window.isMaximized() ? 'maximized' : 'normal');
            } else {
                if (!window.isMaximized()) {
                    window.maximize();
                    windowStateMap.set(window.id,
                        'maximized');
                    return true;
                }
            }
            return false;
        } else if (arg === 'reduce') {
            if (window.isMaximized()) {
                window.unmaximize();
                windowStateMap.set(window.id,
                    'normal');
                window.hookWindowMessage();
            } else {
                if (!window.isMinimized()) {
                    window.minimize();
                    windowStateMap.set(window.id,
                        'minimized');
                    return true;
                }
            }
            return false;
        } else if (arg === 'restore') {
            if (window.isMaximized()) {
                window.unmaximize();
                windowStateMap.set(window.id,
                    'normal');
            } else if (window.isMinimized()) {
                window.restore();
                windowStateMap.set(window.id,
                    window.isMaximized() ? 'maximized' : 'normal');
                return true;
            }
            return false;
        } else if (arg === 'maximize') {
            if (!window.isFocused()) {
                window.focus();
            } else if (window.isMinimized()) {
                window.restore();
                windowStateMap.set(window.id,
                    'maximized');
                return true;
            } else {
                if (!window.isMaximized()) {
                    window.maximize();
                    windowStateMap.set(window.id,
                        'maximized');
                    return true;
                }
            }
            return false;
        } else if (arg === 'minimize') {
            if (!window.isMinimized()) {
                window.minimize();
                windowStateMap.set(window.id,
                    'minimized');
                return true;
            }
            return false;
        } else if (arg === 'get-state') {
            const state = window.isMinimized()
                ? 'minimized'
                : window.isMaximized()
                    ? 'maximized'
                    : 'normal';
            windowStateMap.set(window.id, state);
            if (typeof (state) !== 'string')
                console.error('get-state should always return a string.');
            return state;
        }
    });

    ipc.handle('resize-window', async (event, arg) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;
        const argSplit = arg.split(';', 2);

        if (argSplit.length === 1) {
            // probably an end event
            const [endStr] = argSplit;
            if (endStr === 'end') {
                WindowActiveResizeAnchors.delete(window);
                return;
            }

            throw new Error(`Invalid resize-window event argument: '${arg}'.`);
        }

        const [anchorStr, coordsStr] = argSplit;

        if (anchorStr.startsWith('start ')) {
            const dir = anchorStr.substring(6).trim();
            const [x, y] = window.getPosition();
            const [w, h] = window.getSize();

            const [pointerX, pointerY, pointerId] = coordsStr.split(',', 3).map(x => parseFloat(x));

            WindowActiveResizeAnchors.set(window, {
                window: {x, y, w, h},
                pointer: {x: pointerX, y: pointerY, id: pointerId},
                dir
            });

            return;
        }

        throw new Error(`Invalid resize-window event argument: '${arg}'.`);
    });

    ipc.handle('get-resources-path', async () => {
        return ResourcesPath;
    });

    setInterval(() => {
        const windows = BrowserWindow.getAllWindows();

        // for each window, check if it has an active resize anchor
        for (const window of windows) {
            if (TransparentWindows.has(window) && window.isVisible())
                window.setBackgroundColor('#00000000');

            const anchor = WindowActiveResizeAnchors.get(window);

            if (!anchor) continue;

            const {
                dir,
                pointer: {x: pointerX, y: pointerY},
                window: {x: aX, y: aY, w, h}
            } = anchor;

            const [windowX, windowY] = window.getPosition();
            const [windowW, windowH] = window.getSize();

            const pointer = electron.screen.getCursorScreenPoint();

            const dx = pointerX - pointer.x;
            const dy = pointerY - pointer.y;

            switch (dir) {
                case 'left': {
                    const newX = aX - dx;
                    const newW = w + dx;
                    window.setPosition(Math.round(newX), windowY);
                    window.setSize(Math.round(newW), windowH);
                    break;
                }
                case 'right': {
                    const newW = w - dx;
                    window.setSize(Math.round(newW), windowH);
                    break;
                }
                case 'bottom': {
                    const newH = h - dy;
                    window.setSize(windowW, Math.round(newH));
                    break;
                }
                case 'bottom left': {
                    const newX = aX - dx;
                    const newW = w + dx;
                    const newH = h - dy;
                    window.setPosition(Math.round(newX), windowY);
                    window.setSize(Math.round(newW), Math.round(newH));
                    break;
                }
                case 'bottom right': {
                    const newW = w - dx;
                    const newH = h - dy;
                    window.setSize(Math.round(newW), Math.round(newH));
                    break;
                }
            }
        }
    }, 15);
}