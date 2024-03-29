import path from 'node:path';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import process from 'node:process';

const isWindows = process.platform === 'win32';
export async function LoadMonacoEditor() {
    window.log("LoadMonacoEditor");

    window.MonacoEnvironment = {
        globalAPI: true,
        baseUrl: 'app://dw2ide/node_modules/monaco-editor/min',
        getWorker(workerId, label) {
            window.log(`getting worker for (${workerId}, ${label})...`);
            switch (label) {
                /* @formatter:off */
                case 'editorWorkerService': return window.monacoWorkers.editor;
                //case 'css': case 'less': case 'scss': return window.monacoWorkers.css;
                //case 'html': case 'handlebars': case 'razor': return window.monacoWorkers.html;
                //case 'json': return window.monacoWorkers.json;
                //case 'typescript': case 'javascript': return window.monacoWorkers.typescript;
                /*case 'yaml': return window.monacoWorkers.yaml;*/
                /* @formatter:on */
                default:
                    throw new Error(`Unknown label ${label}`);
            }
        },
        getWorkerUrl(workerId, label) {
            throw new Error("getWorkerUrl should not be invoked in favor of getWorker.");
        }
    };

    window.log("requiring monaco-editor loader...");
    window.monacoLoader = require('monaco-editor/min/vs/loader.js');

    window.monacoLoader.require.config({
        paths: {
            vs: path.resolve('node_modules/monaco-editor/min/vs')
        },
        ignoreDuplicateModules: [
            'vs/css'
        ]
    });

    window.monacoLoader.require.define('vs/css', [], {
        async load(name, req, load) {
            let fileUrl = req.toUrl(name);

            if (isWindows)
                fileUrl = fileUrl.replaceAll('/', '\\');

            if (!fsSync.existsSync(fileUrl))
                fileUrl += '.css';

            while (ResourcesPath === undefined)
                await delay(15);

            // fileUrl is an absolute filesystem path at this point
            // try to translate to app://dw2ide path
            if (fileUrl.startsWith(ResourcesPath))
                fileUrl = 'app://dw2ide' + fileUrl.substring(ResourcesPath.length)
                    .replaceAll('\\', '/');
            else if (fileUrl.startsWith(NodeModulesPath))
                fileUrl = 'app://dw2ide/node_modules' + fileUrl.substring(NodeModulesPath.length)
                    .replaceAll('\\', '/');


            /* electron error: Not allowed to read local resource
            const style = document.createElement('link');
            style.setAttribute('rel', 'stylesheet');
            style.setAttribute('href', fileUrl);
            shadowRoot.appendChild(style);
            load({__element: style});
            */

            if (fileUrl.startsWith('app://')) {
                // in resources path scope file load
                const style = document.createElement('link');
                style.setAttribute('rel', 'stylesheet');
                style.setAttribute('href', fileUrl);
                const overrider = document.head.querySelector('link[data-override]');
                if (overrider !== null) {
                    document.head.insertBefore(style, overrider);
                } else {
                    document.head.appendChild(style);
                }
                load({__element: style});
            } else {
                // out of resources path scope file load
                const style = document.createElement('style');
                style.setAttribute('data-name', name);
                style.setAttribute('data-source', fileUrl);
                fs.readFile(fileUrl)
                    .then(data => {
                        // data is a node Buffer, convert to string, assume utf-8
                        style.innerText = data.toString('utf8');
                        //shadowRoot.appendChild(style);
                        document.head.appendChild(style);
                        load({__element: style});
                    })
                    .catch(err => {
                        window.error(err);
                        load.error(err);
                    });
            }
        }
    });

    window.log("requiring monaco-editor...");
    window.monacoLoader.require(['vs/editor/editor.main'], function (editor) {
        window.log('Monaco Editor loaded.');
        /** @type {typeof import('monaco-editor')} */
        window.monaco = editor;
        window.dispatchEvent(new CustomEvent('monaco-loaded', {detail: {editor}}));
    });

    // load workers
    window.monacoWorkers = {
        _editor: null,
        get editor() {
            return window.monacoWorkers._editor
                ??= new Worker('app://dw2ide/node_modules/monaco-editor/esm/vs/editor/editor.worker.js',
                {type: 'module', name: 'monaco editor worker'});
        },
        /*_json: null,
        get json() {
            return window.monacoWorkers._json
                ??= new Worker('app://dw2ide/node_modules/monaco-editor/esm/vs/language/json/json.worker.js',
                {type: 'module', name: 'monaco json worker'});
        },
        _css: null,
        get css() {
            return window.monacoWorkers._css
                ??= new Worker('app://dw2ide/node_modules/monaco-editor/esm/vs/language/css/css.worker.js',
                {type: 'module', name: 'monaco css worker'});
        },
        _html: null,
        get html() {
            return window.monacoWorkers._html
                ??= new Worker('app://dw2ide/node_modules/monaco-editor/esm/vs/language/html/html.worker.js',
                {type: 'module', name: 'monaco html worker'});
        },
        _typescript: null,
        get typescript() {
            // note: the typescript esm worker is broken, has "var require2 = void 0;" for some reason; see ApplyPatches in main.mjs
            return window.monacoWorkers._typescript
                ??= new Worker('app://dw2ide/node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js',
                {type: 'module', name: 'monaco typescript worker'});
        }*/
    };
}

window.log("preload-monaco.mjs done");