import {StorageProxy} from './storage-proxy.js';
console.log('data-editor loading...');

const storage = new StorageProxy(localStorage);

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

const SavingRequiresValidXmlTitle = `The XML is not well-formed.`;
const SavingRequiresValidXmlBody = `Please correct it before saving.`;

async function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function debounce(func, wait, immediate) {
    let timeout;
    return function (...args) {
        const later = () => {
            timeout = null;
            if (!immediate)
                func.apply(this, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow)
            func.apply(this, args);
    };
}

function throttle(func, wait) {
    let timeout;
    return function (...args) {
        if (!timeout) {
            timeout = setTimeout(() => {
                timeout = null;
                func.apply(this, args);
            }, wait);
        }
    };
}

window.addEventListener('DOMContentLoaded', () => {
    window.log("DOMContentLoaded event");
    window.LoadMonacoEditor();
}, {once: true, passive: true});

window.addEventListener('monaco-loaded', (e) => {
    window.log("monaco-loaded event");

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    prefersDark.addEventListener('change', ({matches}) =>
        window.monaco.editor.setTheme(matches ? 'vs-dark' : 'vs'));

    window.monacoEditor = monaco.editor.create(document.getElementById('monaco-editor-container'), {
        theme: prefersDark.matches ? 'vs-dark' : 'vs',
        language: 'xml',
        automaticLayout: true,
        largeFileOptimizations: false,
        autoIndent: 'full',
        autoSurround: 'languageDefined',
        autoClosingBrackets: 'languageDefined',
        autoClosingQuotes: 'languageDefined',
        autoClosingOvertype: 'always',
        autoClosingDelete: 'always',
        trimAutoWhitespace: true,
        formatOnType: true,
        formatOnPaste: true,
        formatOnSave: true,
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


window.localStorageProxy = storage;

let autoValidateXmlTimeout = undefined;

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
    const btnSwitchTheme = document.getElementById('action-switch-theme');

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
            postStatusMessage('New file canceled.');
            return;
        }

        //window.log('New file:', result.filePath);
        fs.stat(result.filePath).then((stats) => {
            // if the file exists, report error
            if (stats !== null) {
                dialog.showErrorBox('Error', 'The file already exists. Please choose a different name or Open it instead.');
                postStatusMessage('New file canceled.');
                return;
            }
            // touch the file
            fs.writeFile(result.filePath, '')
                .then(() => {
                    window.log('File created:', result.filePath);
                    // ok, now we can clear the editor and change file path
                    currentFilePath = result.filePath;
                    storage.lastDirectory = path.dirname(currentFilePath);
                    monaco.editor.removeAllMarkers('XML Validation');
                    const model = window.monaco.editor.createModel('', 'xml',
                        monaco.Uri.parse(`file:///${result.filePath}`));
                    monacoEditor.setModel(model);
                    monacoEditor.focus();
                    autoValidateXml(model);
                    postStatusMessage('New file created.');
                }).catch((err) => {
                window.error('File create error:', err);
                dialog.showErrorBox('Error', 'An error occurred while creating the file. Please try again.');
                postStatusMessage('New file canceled.');
            });
        }).catch((err) => {
            window.error('File stats error:', err);
            dialog.showErrorBox('Error', 'An error occurred while checking the file. Please try again.');
            postStatusMessage('New file canceled.');
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
            postStatusMessage('Open canceled.');
            return;
        }

        window.log('Open file:', result.filePaths);
        fs.readFile(result.filePaths[0], 'utf-8')
            .then((data) => {
                window.log('File read:', result.filePaths[0]);
                currentFilePath = result.filePaths[0];
                storage.lastDirectory = path.dirname(currentFilePath);

                monaco.editor.removeAllMarkers('XML Validation');
                const model = window.monaco.editor.createModel(data, 'xml',
                    monaco.Uri.parse(`file:///${result.filePaths[0]}`));
                monacoEditor.setModel(model);
                monacoEditor.focus();
                autoValidateXml(model);
                postStatusMessage('File opened.');
            }).catch((err) => {
            window.error('File read error:', err);
            dialog.showErrorBox('Error', 'An error occurred while reading the file. Please try again.');
            postStatusMessage('Open failed.');
        });
    }, {passive: true});

    btnSave.addEventListener('click', async () => {
        if (currentFilePath === null) {
            // if there is no current file path, use save as
            window.warn('No current file path, redirecting to Save As...');
            btnSaveAs.click();
            return;
        }

        const model = monacoEditor.getModel();

        autoValidateXmlNow(model);

        while (model['xmlValid'] === undefined) {
            postStatusMessage('Validating...');
            await delay(125);
        }

        if (model['xmlValid'] === false) {
            await dialog.showErrorBox(SavingRequiresValidXmlTitle, SavingRequiresValidXmlBody);
            // run the 'Go to next problem' command (Alt+F8)
            monacoEditor.trigger('editor.action.marker.next', 'editor.action.marker.next', {});
            postStatusMessage('Save canceled.');
            return;
        }

        const data = model.getValue();
        fs.writeFile(currentFilePath, data)
            .then(() => {
                window.log('File saved:', currentFilePath);
                postStatusMessage('File saved.');
            }).catch((err) => {
            window.error('File save error:', err);
            dialog.showErrorBox('Error', 'An error occurred while saving the file. Please try again.');
            postStatusMessage('Save failed.');
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
            postStatusMessage('Save canceled.');
            return;
        }

        const model = monacoEditor.getModel();

        autoValidateXmlNow(model);

        while (model['xmlValid'] === undefined) {
            postStatusMessage('Validating...');
            await delay(125);
        }

        if (model['xmlValid'] === false) {
            await dialog.showErrorBox(SavingRequiresValidXmlTitle, SavingRequiresValidXmlBody);
            // run the 'Go to next problem' command (Alt+F8)
            monacoEditor.trigger('editor.action.marker.next', 'editor.action.marker.next', {});
            postStatusMessage('Save canceled.');
            return;
        }

        window.log('Save file:', result.filePath);
        const data = model.getValue();

        fs.writeFile(result.filePath, data)
            .then(() => {
                window.log('File saved:', result.filePath);
                currentFilePath = result.filePath;
                storage.lastDirectory = path.dirname(currentFilePath);
                postStatusMessage('File saved.');
            }).catch((err) => {
            window.error('File save error:', err);
            postStatusMessage('Save failed.');
            return dialog.showErrorBox('Error', 'An error occurred while saving the file. Please try again.');
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

    btnSwitchTheme.addEventListener('click', async () => {
        await window.rotateTheme();
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

    window.addEventListener('beforeunload', _ => {
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
    autoValidateXml(monacoEditor.getModel());


    function autoValidateXmlNow(model) {
        model['xmlValid'] = undefined;
        const hadActiveCallbackTimeout = typeof autoValidateXmlTimeout === 'number';
        if (hadActiveCallbackTimeout)
            clearTimeout(autoValidateXmlTimeout);
        if (hadActiveCallbackTimeout || autoValidateXmlTimeout === undefined) {
            autoValidateXmlTimeout = setTimeout(async () => {
                autoValidateXmlTimeout = null; // uninterruptible at this stage
                const model = monacoEditor.getModel();
                const xml = model.getValue();
                await validateXml(currentFilePath, xml, model);
                autoValidateXmlTimeout = undefined;
            }, 125);
        }
    }

    /**
     * @param model {monaco.editor.ITextModel}
     */
    function autoValidateXml(model) {
        if (typeof autoValidateXmlTimeout === 'number')
            clearTimeout(autoValidateXmlTimeout);

        model.onDidChangeContent(_ => {
            autoValidateXmlNow(model);
        });
    }

    /**
     * @param filePath {string}
     * @param xml {string}
     * @param model {monaco.editor.ITextModel}
     * @return {Promise<boolean>}
     */
    async function validateXml(filePath, xml, model) {
        const modelVersionId = model.getVersionId();
        const results = await Dw2Dom.validateXml(xml, []);

        if (modelVersionId !== model.getVersionId()) {
            // model changed after validation, schedule a new validation

            if (autoValidateXmlTimeout === null)
                return false; // can't interrupt

            if (autoValidateXmlTimeout !== undefined)
                clearTimeout(autoValidateXmlTimeout);

            autoValidateXmlTimeout = undefined;
            autoValidateXmlNow(model);
        }

        if (results === true) {
            monaco.editor.removeAllMarkers('XML Validation');
            //monacoEditor.render(true);
            model['xmlValid'] = true;
            return true;
        }

        /** @type {monaco.editor.IMarkerData[]} */
        const markers = [];
        for (const err of results) {
            if (!err) continue;
            // estimate the range length by checking for succeeding characters
            const startOffset = model.getOffsetAt({lineNumber: err.line, column: err.column});
            let endOffset = startOffset + 1;
            let endChar = xml[endOffset];
            for (; ;) {
                switch (endChar) {
                    case undefined:
                    case '>':
                    case '<':
                    case '/':
                    case ' ':
                        break;
                    default:
                        endOffset++;
                        endChar = xml[endOffset];
                        continue;
                }
                break;
            }
            const length = endOffset - startOffset;
            const endPos = length <= 1
                ? model.getPositionAt(endOffset + 1) // min 1 char
                : model.getPositionAt(endOffset - 1);
            let severity = monaco.MarkerSeverity.Error;
            switch (err.level) {
                case /** @see {import('node-libxml').XmlErrorLevel.XML_ERR_NONE} */
                0:
                    severity = monaco.MarkerSeverity.Hint;
                    break;
                case /** @see {import('node-libxml').XmlErrorLevel.XML_ERR_WARNING} */
                1:
                    severity = monaco.MarkerSeverity.Warning;
                    break;
            }
            const message = err.message.trim();
            const startLineNumber = err.line;
            const startColumn = err.column;
            const endLineNumber = endPos.lineNumber;
            const endColumn = endPos.column;
            /** @type {monaco.editor.IMarkerData} */
            const marker = {
                message,
                severity,
                startLineNumber,
                startColumn,
                endLineNumber,
                endColumn,
                modelVersionId,
                source: model.getValueInRange({
                    startLineNumber,
                    startColumn,
                    endLineNumber,
                    endColumn
                }),
                resource: model.uri,
                //code: `${'schema' in err ? 'XSD' : 'XML'}${err.level}`
            };
            if ('int1' in err) {
                marker.relatedInformation = [{
                    resource: model.uri,
                    message: "Refer to here",
                    startLineNumber: err.int1,
                    startColumn: 1,
                    endLineNumber,
                    endColumn
                }];
                markers.push({
                    message: `Referenced from ${err.int1}: ${message}`,
                    severity: Math.max(monaco.MarkerSeverity.Hint, severity - 1),
                    startLineNumber: err.int1,
                    startColumn: 1,
                    endLineNumber: err.int1,
                    endColumn,
                    modelVersionId,
                    source: model.getValueInRange({
                        startLineNumber: err.int1,
                        startColumn: 1,
                        endLineNumber: err.int1,
                        endColumn
                    }),
                    resource: model.uri
                });
            }
            markers.push(marker);
            switch (severity) {
                case monaco.MarkerSeverity.Hint:
                    window.log(`[XML Validation] ${message} @ ${startLineNumber}:${startColumn}-${endLineNumber}:${endColumn}`);
                    break;
                case monaco.MarkerSeverity.Warning:
                    window.warn(`[XML Validation] ${message} @ ${startLineNumber}:${startColumn}-${endLineNumber}:${endColumn}`);
                    break;
                case monaco.MarkerSeverity.Error:
                    window.error(`[XML Validation] ${message} @ ${startLineNumber}:${startColumn}-${endLineNumber}:${endColumn}`);
            }
        }
        //monaco.editor.removeAllMarkers('XML Validation');
        monaco.editor.setModelMarkers(model, 'XML Validation', markers);
        //monacoEditor.render(true);
        window.warn(`[XML Validation] ${markers.length} markers applied.`);
        model['xmlValid'] = false;
        return false;
    }
}

const statusBar = document.getElementById('status-bar');
let statusQueue = [];

function postStatusMessage(msg) {
    if (statusQueue[statusQueue.length - 1] === msg)
        return;
    if (statusBar.lastElementChild && statusBar.lastElementChild.textContent === msg)
        return;
    statusQueue.push(msg);
}

function updateStatusBarFromQueue() {
    if (statusBar.childElementCount >= 2) {
        const first = statusBar.firstElementChild;
        if (!(first === statusBar.lastElementChild
            || first.getAnimations().some(a => a.playState !== 'finished'))) {
            if (first.dataset.landed === undefined) {
                first.dataset.landed = performance.now().toString();
            } else if ((parseFloat(first.dataset.landed) + 800) < performance.now()) {
                first.remove();
            }
        }
    }
    if (statusQueue.length === 0) return;
    const msg = statusQueue.shift();
    const textNode = document.createTextNode(msg);
    const textSpan = document.createElement('span');
    textSpan.appendChild(textNode);
    textSpan.dataset.added = performance.now().toString();
    statusBar.appendChild(textSpan);
}

setInterval(updateStatusBarFromQueue, 100);

console.log('data-editor loaded');