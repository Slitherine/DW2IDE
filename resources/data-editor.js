/** @external dialog
 * @type {
 *     {
 *         showOpenDialog: (options: import('electron').OpenDialogOptions) => Promise<import('electron').OpenDialogReturnValue>;
 *         showSaveDialog: (options: import('electron').SaveDialogOptions) => Promise<import('electron').SaveDialogReturnValue>;
 *         showMessageBox: (options: import('electron').MessageBoxOptions) => Promise<import('electron').MessageBoxReturnValue>;
 *         showErrorBox: (title: string, content: string) => Promise<void>
 *     }
 * } */

dialog;

async function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

window.addEventListener('DOMContentLoaded', () => {
    window.log("DOMContentLoaded event");
    window.LoadMonacoEditor();
}, {once: true, passive: true});

window.addEventListener('monaco-loaded', (e) => {
    window.log("monaco-loaded event");
    /** @type {typeof import('monaco-editor').editor.IStandaloneCodeEditor } */
    window.monacoHost = monaco.editor.create(document.getElementById('monaco-editor-container'), {
        theme: 'vs-dark',
        language: 'xml',
        automaticLayout: true,
        largeFileOptimizations: true,
        lightbulb: {
            enabled: true
        }
    });

    PostMonacoSetup();
}, {once: true, passive: true});

// a proxy that accesses localStorage, but does not throw when the key is not found
const localStorageProxyDefaults = new Map([
    ['last-directory', path.join(dw2ide.GetUserChosenGameDirectory(), 'data')],
]);
const storage = new Proxy(window.localStorage, {
    get(target, prop) {
        if (typeof (prop) !== 'string')
            return undefined;
        // convert camel case to kebab case
        prop = prop.replace(/([a-z])([A-Z])/g, (m, p1, p2) => `${p1}-${p2.toLowerCase()}`);
        const result = target.getItem(prop);
        if (result !== null)
            return result;
        if (localStorageProxyDefaults.has(prop))
            return localStorageProxyDefaults.get(prop);
        return undefined;
    },
    set(target, prop, value) {
        if (typeof (prop) !== 'string')
            return false;
        prop = prop.replace(/([a-z])([A-Z])/g, (m, p1, p2) => `${p1}-${p2.toLowerCase()}`);
        target.setItem(prop, value);
        return true;
    },
    deleteProperty(target, prop) {
        if (typeof (prop) !== 'string')
            return false;
        target.removeItem(prop);
        return true;
    }
});

window.localStorageProxy = storage;

async function PostMonacoSetup() {
    window.log("PostMonacoSetup");

    // zoom control
    const zoomSlider = document.getElementById('action-zoom-slider');
    const zoomReset = document.getElementById('action-zoom-reset');
    const zoomValue = document.getElementById('action-zoom-value');

    zoomSlider.addEventListener('input', (e) => {
        window.monaco.editor.EditorZoom.setZoomLevel(e.target.value);
    });

    window.monaco.editor.EditorZoom.onDidChangeZoomLevel((value) => {
        zoomSlider.value = value;
        const percent = 100 + (value * 10);
        zoomValue.textContent = percent + '%';
        window.localStorage.setItem('editor-zoom', value);
        if (value === 0)
            zoomReset.setAttribute('disabled', '');
        else
            zoomReset.removeAttribute('disabled');
    });

    zoomReset.addEventListener('click', () => {
        window.monaco.editor.EditorZoom.setZoomLevel(0);
    });

    // use localStorage to remember zoom level
    const zoomLevel = window.localStorage.getItem('editor-zoom');
    if (zoomLevel !== null)
        window.monaco.editor.EditorZoom.setZoomLevel(Number(zoomLevel));

    const actionBar = document.querySelector('body > nav.action-bar');

    // OOBE checks
    if (storage.oobeDataEditorMenu !== 'used') {
        // pulse the hover effect
        actionBar.classList.add('first-time');
        // when the user hovers over the action-bar, it will expand
        // wait for the height transition to finish and then remove the class
        let oobeActionBarHoverTicks = 0;
        const oobeActionBarHoverInterval = setInterval(() => {
            // check if height is max-height
            //window.getComputedStyle(actionBar,':hover'); // WICG issue #107, not yet implemented
            const style = window.getComputedStyle(actionBar);
            if (style.maxHeight === style.height) {
                if (++oobeActionBarHoverTicks >= 2) {
                    actionBar.classList.remove('first-time');
                    window.localStorage.setItem('oobe-data-editor-menu', 'used');
                    clearInterval(oobeActionBarHoverInterval);
                }
            } else {
                oobeActionBarHoverTicks = 0;
            }
        }, 400);
    } else {
        // for convenience, focus the open button for users who have used the menu before
        // so they can just press enter or space to open a file
        requestIdleCallback(() => {
            if (!document.activeElement || document.activeElement === document.body)
                btnOpen.focus();
        });
    }

    const btnNew = document.getElementById('action-new');
    const btnOpen = document.getElementById('action-open');
    const btnSave = document.getElementById('action-save');
    const btnSaveAs = document.getElementById('action-save-as');
    const btnMinimize = document.getElementById('action-minimize');
    const btnRestore = document.getElementById('action-restore');
    const btnMaximize = document.getElementById('action-maximize');

    let currentFilePath = null;
// new uses save dialog to create a new file
    btnNew.addEventListener('click', async () => {
        const result = await dialog.showSaveDialog({
            title: 'New File',
            buttonLabel: 'Create',
            filters: [
                {name: 'XML Files', extensions: ['xml']},
                {name: 'All Files', extensions: ['*']}
            ],
            defaultPath: storage.lastDirectory
        });
        if (result.canceled) {
            return;
        }

        window.log('New file:', result.filePath);
        fs.stat(result.filePath).then((stats) => {
            // if the file exists, report error
            if (stats !== null) {
                dialog.showErrorBox('Error', 'The file already exists. Please choose a different name or Open it instead.');
                return;
            }
            // touch the file
            fs.writeFile(result.filePath, '')
                .then(() => {
                    window.log('File created:', result.filePath);
                    // ok, now we can clear the editor and change file path
                    currentFilePath = result.filePath;
                    storage.lastDirectory = path.dirname(currentFilePath);
                    const model = window.monaco.editor.createModel('', 'xml', `file://${result.filePath}`);
                    window.monacoHost.setModel(model);
                    window.monacoHost.focus();
                }).catch((err) => {
                window.error('File create error:', err);
                dialog.showErrorBox('Error', 'An error occurred while creating the file. Please try again.');
            });
        }).catch((err) => {
            window.error('File stats error:', err);
            dialog.showErrorBox('Error', 'An error occurred while checking the file. Please try again.');
        });
    }, {passive: true});

    btnOpen.addEventListener('click', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Open File',
            buttonLabel: 'Open',
            filters: [
                {name: 'XML Files', extensions: ['xml']},
                {name: 'All Files', extensions: ['*']}
            ],
            defaultPath: storage.lastDirectory
        });
        if (result.canceled) {
            return;
        }

        window.log('Open file:', result.filePaths);
        fs.readFile(result.filePaths[0], 'utf-8')
            .then((data) => {
                window.log('File read:', result.filePaths[0]);
                currentFilePath = result.filePaths[0];
                storage.lastDirectory = path.dirname(currentFilePath);
                const model = window.monaco.editor.createModel(data, 'xml', `file://${result.filePaths[0]}`);
                window.monacoHost.setModel(model);
                window.monacoHost.focus();
            }).catch((err) => {
            window.error('File read error:', err);
            dialog.showErrorBox('Error', 'An error occurred while reading the file. Please try again.');
        });
    }, {passive: true});

    btnSave.addEventListener('click', async () => {
        if (currentFilePath === null) {
            // if there is no current file path, use save as
            window.warn('No current file path, redirecting to Save As...');
            btnSaveAs.click();
            return;
        }
        const data = window.monacoHost.getValue();
        fs.writeFile(currentFilePath, data)
            .then(() => {
                window.log('File saved:', currentFilePath);
            }).catch((err) => {
            window.error('File save error:', err);
            dialog.showErrorBox('Error', 'An error occurred while saving the file. Please try again.');
        });
    }, {passive: true});


    btnSaveAs.addEventListener('click', async () => {
        const result = await dialog.showSaveDialog({
            title: 'Save File',
            buttonLabel: 'Save',
            filters: [
                {name: 'XML Files', extensions: ['xml']},
                {name: 'All Files', extensions: ['*']}
            ],
            defaultPath: storage.lastDirectory
        });
        if (result.canceled) {
            return;
        }

        window.log('Save file:', result.filePath);
        const data = window.monacoHost.getValue();
        fs.writeFile(result.filePath, data)
            .then(() => {
                window.log('File saved:', result.filePath);
                currentFilePath = result.filePath;
                storage.lastDirectory = path.dirname(currentFilePath);
            }).catch((err) => {
            window.error('File save error:', err);
            dialog.showErrorBox('Error', 'An error occurred while saving the file. Please try again.');
        });
    }, {passive: true});

    async function UpdateRestoreMaximizeButtons() {
        for (; ;) {
            const state = await window.electron.ipc.invoke('window-command', 'get-state');
            if (state === undefined) {
                // wtf ipc issues
                //window.error('Failed to get window state');
                //btnRestore.removeAttribute('hidden');
                //btnMaximize.removeAttribute('hidden');
                await delay(100);
                continue;
            }
            window.log('Window state:', state);
            if (state === 'maximized') {
                btnRestore.removeAttribute('hidden');
                btnMaximize.setAttribute('hidden', '');
            } else {
                btnRestore.setAttribute('hidden', '');
                btnMaximize.removeAttribute('hidden');
            }
            break;
        }
    }

    btnMinimize.addEventListener('click', async () => {
        // restore the window to its non-maximized state
        await window.electron.ipc.invoke('window-command', 'minimize');
        await UpdateRestoreMaximizeButtons();
    }, {passive: true});

    btnRestore.addEventListener('click', async () => {
        // restore the window to its non-maximized state
        await window.electron.ipc.invoke('window-command', 'restore');
        // hide restore, show maximize
        btnRestore.setAttribute('hidden', '');
        btnMaximize.removeAttribute('hidden');
    }, {passive: true});

    btnMaximize.addEventListener('click', async () => {
        // maximize the window
        await window.electron.ipc.invoke('window-command', 'maximize');
        // hide maximize, show restore
        btnMaximize.setAttribute('hidden', '');
        btnRestore.removeAttribute('hidden');
    }, {passive: true});

    window.addEventListener('resize', async () => {
        setTimeout(async () => {
            // compare window size vs window.screen size to consider checking for maximized state
            const isProbablyMaximized = window.outerWidth === window.screen.width
                && window.outerHeight === window.screen.height;
            if (isProbablyMaximized) {
                if (btnRestore.hasAttribute('hidden'))
                    await UpdateRestoreMaximizeButtons();
            } else {
                if (btnMaximize.hasAttribute('hidden'))
                    await UpdateRestoreMaximizeButtons();
            }
        }, 50);
    }, {passive: true});

    window.addEventListener('beforeunload', (e) => {
        storage.windowX = window.screenX;
        storage.windowY = window.screenY;
        storage.windowWidth = window.outerWidth;
        storage.windowHeight = window.outerHeight;
    });

    // detect alt keypress
    let altKeyDown = false;
    let altKeyCombo = false;
    let ctrlKeyDown = false;
    let ctrlKeyCombo = false;

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Alt') {
            altKeyDown = true;
            return;
        } else if (altKeyDown) {
            altKeyCombo = true;
        }
        if (e.key === 'Control') {
            ctrlKeyDown = true;
            return;
        } else if (ctrlKeyDown) {
            ctrlKeyCombo = true;
        }
    }, {passive: true});
    window.addEventListener('keyup', (e) => {
        if (e.key === 'Alt') {
            if (altKeyDown && !altKeyCombo && !ctrlKeyDown && !ctrlKeyCombo)
                btnNew.focus();
            altKeyDown = false;
            altKeyCombo = false;
            return;
        }
        if (e.key === 'Control') {
            ctrlKeyDown = false;
            ctrlKeyCombo = false;
            return;
        }
        if (ctrlKeyCombo) {
            switch (e.key) {
                case 'n':
                    btnNew.click();
                    return;
                case 'o':
                    btnOpen.click();
                    return;
                case 's':
                    btnSave.click();
                    return;
                case 'S':
                    btnSaveAs.click();
                    return;
                case '-': {
                    const editorZoom = window.monaco.editor.EditorZoom;
                    const newZoomLevel = Math.max(-5, editorZoom.getZoomLevel() - 1);
                    editorZoom.setZoomLevel(newZoomLevel);
                    return;
                }
                case '=':
                case '+': {
                    const editorZoom = window.monaco.editor.EditorZoom;
                    const newZoomLevel = Math.min(editorZoom.getZoomLevel() + 1, 20);
                    editorZoom.setZoomLevel(newZoomLevel);
                    return;
                }
                case '0':
                    window.monaco.editor.EditorZoom.setZoomLevel(0);
            }
        }
    }, {passive: true});

    // restore window position and size
    if (storage.windowX !== undefined) {
        window.moveTo(storage.windowX, storage.windowY);
        window.resizeTo(storage.windowWidth, storage.windowHeight);
        // trigger monaco resize
        window.dispatchEvent(new Event('resize'));
    }

    UpdateRestoreMaximizeButtons()
        .catch((err) => {
            window.error('UpdateRestoreMaximizeButtons error:', err);
        });

    // register dw2 dom providers

    const dw2Dom = new Dw2Dom();
    await dw2Dom.load();
    window.dw2Dom = dw2Dom;
    monaco.languages.registerCompletionItemProvider('xml', dw2Dom);
    monaco.languages.registerHoverProvider('xml', dw2Dom);
}
