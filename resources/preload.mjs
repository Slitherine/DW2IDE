import './preload-logging.mjs';
import './async-helpers.cjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import {clipboard, ipcRenderer as ipc, nativeImage, shell} from 'electron';
import packageJson from '../package.json' assert {type: 'json'};
import packageLockJson from '../package-lock.json' assert {type: 'json'};
import './preload-dw2ide.mjs';
import {Dw2Dom, Dw2DomWorkerManager} from './dw2-dom.mjs';
import process from 'node:process';
import * as preloadMonaco from './preload-monaco.mjs';

if (location.href === 'about:blank') {
    // check if there is --kickoff-url=... in argv
    const argv = process.argv;
    for (const arg of argv) {
        if (arg.startsWith('--kickoff-url=')) {
            //location.href = arg.substring(14);
            // this actually works fsr
            window.navigation.navigate(arg.substring(14));
            break;
        }
    }
} else if (location.href.startsWith('app://')) {

    async function main() {
        const result = await ipc.invoke('unlock-internals');
        window.log("unlock-internals", result);
        const options = await require("node:internal/options");
        window.log("options", options);
        const {esmLoader} = require('node:internal/process/esm_loader');
        const {Module} = require('node:internal/modules/cjs/loader');
        const {loadBuiltinModule} = require('internal/modules/helpers');

        window.Module = Module;

        class CustomModuleLoader {

            #esmLoader = esmLoader;
            #workers = [];

            allowImportMetaResolve = true;

            /**
             * Instantiate a module loader that uses user-provided custom loader hooks.
             */
            constructor() {
                window.log("CustomModuleLoader created");
            }

            /**
             * Register some loader specifier.
             * @param {string} originalSpecifier The specified URL path of the loader to
             *                                   be registered.
             * @param {string} parentURL The parent URL from where the loader will be
             *                           registered if using it package name as specifier
             * @param {any} [data] Arbitrary data to be passed from the custom loader
             * (user-land) to the worker.
             * @param {any[]} [transferList] Objects in `data` that are changing ownership
             * @returns {{ format: string, url: URL['href'] }}
             */
            register(originalSpecifier, parentURL, data, transferList) {
                //return hooksProxy.makeSyncRequest('register', transferList, originalSpecifier, parentURL, data);
                window.log("register", originalSpecifier, parentURL, data, transferList);
                throw new Error("Not implemented");
            }

            /**
             * Resolve the location of the module.
             * @param {string} originalSpecifier The specified URL path of the module to
             *                                   be resolved.
             * @param {string} [parentURL] The URL path of the module's parent.
             * @param {ImportAssertions} importAssertions Assertions from the import
             *                                            statement or expression.
             * @returns {{ format: string, url: URL['href'] }}
             */
            resolve(originalSpecifier, parentURL, importAssertions) {
                //return hooksProxy.makeAsyncRequest('resolve', undefined, originalSpecifier, parentURL, importAssertions);
                window.log("resolve", originalSpecifier, parentURL, importAssertions);
                this.#esmLoader.setCustomizations(undefined);
                const result = this.#esmLoader.resolve(originalSpecifier, parentURL, importAssertions);
                this.#esmLoader.setCustomizations(this);
                return result;
            }

            resolveSync(originalSpecifier, parentURL, importAssertions) {
                // This happens only as a result of `import.meta.resolve` calls, which must be sync per spec.
                //return hooksProxy.makeSyncRequest('resolve', undefined, originalSpecifier, parentURL, importAssertions);
                window.log("resolveSync", originalSpecifier, parentURL, importAssertions);
                this.#esmLoader.setCustomizations(undefined);
                const result = this.#esmLoader.resolveSync(originalSpecifier, parentURL, importAssertions);
                this.#esmLoader.setCustomizations(undefined);
                return result;
            }

            /**
             * Provide source that is understood by one of Node's translators.
             * @param {URL['href']} url The URL/path of the module to be loaded
             * @param {object} [context] Metadata about the module
             * @returns {Promise<{ format: ModuleFormat, source: ModuleSource }>}
             */
            load(url, context) {
                //return hooksProxy.makeAsyncRequest('load', undefined, url, context);
                window.log("load", url, context);
                this.#esmLoader.setCustomizations(undefined);
                const result = this.#esmLoader.load(url, context);
                this.#esmLoader.setCustomizations(this);
                return result;
            }

            loadSync(url, context) {
                //return hooksProxy.makeSyncRequest('load', undefined, url, context);
                window.log("loadSync", url, context);
                this.#esmLoader.setCustomizations(undefined);
                const result = this.#esmLoader.loadSync(url, context);
                this.#esmLoader.setCustomizations(this);
                return result;
            }

            importMetaInitialize(meta, context, loader) {
                //hooksProxy.importMetaInitialize(meta, context, loader);
                window.log("importMetaInitialize", meta, context, loader);
            }

            forceLoadHooks() {
                window.log("forceLoadHooks");
            }
        }

        esmLoader.setCustomizations(new CustomModuleLoader());

        window.log("esmLoader.setCustomizations done");


        /** @external window
         * @type {Window} */
        window;

        /** @external document
         * @type {Document|HTMLDocument} */
        document;

        /*ipc.invoke('dev-tools', 'open')
            .catch(e => window.error(e));*/

        window.Dw2Dom = Dw2Dom;

        window.electron = {
            ipc, shell, clipboard, nativeImage,
            require, import: async path => await import(path),
            async capturePage(rect) {
                try {
                    if (rect instanceof DOMRect) rect = {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
                    return await ipc.invoke('capture-page', rect);
                } catch (error) {
                    return null;
                }
            }
        };


        const isWindows = process.platform === 'win32';

        const dialogExposure = {
            async showOpenDialog(args) {
                try {
                    return await ipc.invoke('show-open-dialog', args);
                } catch (error) {
                    return {canceled: true, filePaths: [], error};
                }
            }, async showSaveDialog(args) {
                try {
                    return await ipc.invoke('show-save-dialog', args);
                } catch (error) {
                    return {canceled: true, filePath: '', error};
                }
            }, async showMessageBox(args) {
                try {
                    return await ipc.invoke('show-message-box', args);
                } catch (error) {
                    return {response: 0, error};
                }
            }, async showErrorBox(title, content) {
                try {
                    return await ipc.invoke('show-error-box', {title, content});
                } catch (error) {
                    return {error};
                }
            }
        };

        window.dialog = dialogExposure;

        const domParser = new DOMParser();

        async function ImportSvg(node) {
            if (node.hasChildNodes())
                return;
            if (!node.hasAttribute('data-src'))
                return;
            const src = node.getAttribute('data-src');
            if (src) {
                const response = await fetch(src);
                const data = await response.text();
                const doc = domParser.parseFromString(data, 'image/svg+xml');
                const svg = doc.documentElement;
                const importedNode = document.importNode(svg, true);
                // copy attributes
                for (const attr of node.attributes)
                    importedNode.setAttribute(attr.name, attr.value);
                node.parentNode.replaceChild(importedNode, node);
            }
        }

        window.addEventListener('DOMContentLoaded', () => {

            const versions = structuredClone(process.versions);
            versions['ide'] = packageJson.version;

            if ('dw2ide' in window)
                versions['dotnet'] = dw2ide.GetNetVersion().split('+', 1)[0];

            for (const [key, value] of Object.entries(packageLockJson.packages)) if (key.startsWith('node_modules/')) {
                const name = key.substring(13);
                if (name.includes('/') || name.includes('@')) continue;
                versions[name] = value.version;
            }

            const keys = Object.keys(versions);
            const selector = `span.${keys.join('-version, span.')}-version`;

            const versionElements = document.querySelectorAll(selector);

            for (const versionElement of versionElements) {
                const className = versionElement.className;
                const versionType = className.slice(0, -8);
                versionElement.innerText = versions[versionType];
            }

            // use a MutationObserver to listen for added svg elements
            // that have a data-src, or for svg elements that have a data-src
            // attribute updated and load the svg from the data-src
            const svgObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type !== 'childList') continue;
                    for (const node of mutation.addedNodes) {
                        if (!(node instanceof Element) || node.tagName !== 'svg')
                            continue;
                        ImportSvg(node);
                    }
                }
            });
            // do first pass before observing
            for (const node of document.querySelectorAll('svg[data-src]:empty'))
                ImportSvg(node);
            svgObserver.observe(document.body, {childList: true, subtree: true});

            // wire up the resize handlers via ipc messages

            // create 1px fixed overlay elements to allow window resizing (transparent windows can't be resized otherwise)
            // note no resize top because of title bar, can just use the bottom resize for that
            const container = document.createElement('div');
            container.classList.add('helper-resize-container');

            /** @type {boolean} */
            let resizingActive = false;
            /** @type {HTMLElement|null} */
            let resizingElement = null;
            /** @type {number} */
            let resizingPointerId = -1;


            /**
             * @param e {PointerEvent}
             * @returns {void}
             */
            function ResizeHelperPointerDownHandler(e) {
                if (!e.isPrimary || e.button !== 0) return;
                resizingActive = true;
                resizingElement = e.target;
                resizingPointerId = e.pointerId;
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                e.target.setPointerCapture(e.pointerId);
                const direction = e.target.dataset.direction;
                if (!direction) {
                    window.error("Resize direction not set on resize helper element.", e.target);
                    throw new Error("Resize direction not set on resize helper element.");
                }
                ipc.invoke('resize-window', `start ${direction};${e.screenX},${e.screenY},${e.pointerId}`)
                    .catch(e => window.error(e));
            }

            /**
             * @param e {PointerEvent}
             * @returns {void}
             */
            function ResizeHelperPointerUpHandler(e) {
                if (!resizingActive || !e.isPrimary || e.button !== 0 || resizingPointerId !== e.pointerId || e.target !== resizingElement) {
                    return;
                }
                resizingActive = false;
                resizingElement.releasePointerCapture(resizingPointerId);
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                ipc.invoke('resize-window', 'end')
                    .catch(e => window.error(e));
            }

            const resizeLeft = document.createElement('div');
            resizeLeft.classList.add('helper-resize-left');
            resizeLeft.classList.add('helper-resize-horiz');
            resizeLeft.dataset.direction = 'left';
            container.appendChild(resizeLeft);
            resizeLeft.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {capture: true, passive: false});
            resizeLeft.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true, passive: false});
            resizeLeft.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {capture: true, passive: false});
            resizeLeft.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {
                capture: true,
                passive: false
            });

            const resizeRight = document.createElement('div');
            resizeRight.classList.add('helper-resize-right');
            resizeRight.classList.add('helper-resize-horiz');
            resizeRight.dataset.direction = 'right';
            container.appendChild(resizeRight);
            resizeRight.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {
                capture: true,
                passive: false
            });
            resizeRight.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true, passive: false});
            resizeRight.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {
                capture: true,
                passive: false
            });
            resizeRight.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {
                capture: true,
                passive: false
            });

            const resizeBottom = document.createElement('div');
            resizeBottom.classList.add('helper-resize-bottom');
            resizeBottom.dataset.direction = 'bottom';
            container.appendChild(resizeBottom);
            resizeBottom.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {
                capture: true,
                passive: false
            });
            resizeBottom.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true, passive: false});
            resizeBottom.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {
                capture: true,
                passive: false
            });
            resizeBottom.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {
                capture: true,
                passive: false
            });

            const resizeBottomLeft = document.createElement('div');
            resizeBottomLeft.classList.add('helper-resize-bottom-left');
            resizeBottomLeft.classList.add('helper-resize-corner');
            resizeBottomLeft.dataset.direction = 'bottom left';
            container.appendChild(resizeBottomLeft);
            resizeBottomLeft.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {
                capture: true,
                passive: false
            });
            resizeBottomLeft.addEventListener('pointerup', ResizeHelperPointerUpHandler, {
                capture: true,
                passive: false
            });
            resizeBottomLeft.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {
                capture: true,
                passive: false
            });
            resizeBottomLeft.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {
                capture: true, passive: false
            });

            const resizeBottomRight = document.createElement('div');
            resizeBottomRight.classList.add('helper-resize-bottom-right');
            resizeBottomRight.classList.add('helper-resize-corner');
            resizeBottomRight.dataset.direction = 'bottom right';
            container.appendChild(resizeBottomRight);
            resizeBottomRight.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {
                capture: true,
                passive: false
            });
            resizeBottomRight.addEventListener('pointerup', ResizeHelperPointerUpHandler, {
                capture: true,
                passive: false
            });
            resizeBottomRight.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {
                capture: true,
                passive: false
            });
            resizeBottomRight.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {
                capture: true, passive: false
            });


            const preloadCss = document.createElement('link');
            preloadCss.rel = 'stylesheet';
            preloadCss.href = 'app://dw2ide/preload.css';
            //document.documentElement.appendChild(container);
            const shadowRoot = document.body.attachShadow({mode: 'closed'});
            shadowRoot.appendChild(preloadCss);
            shadowRoot.appendChild(container);
            shadowRoot.appendChild(document.createElement('slot'));

            async function delay(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }

            window.LoadMonacoEditor = () => {
                window.LoadMonacoEditor = preloadMonaco.LoadMonacoEditor;
                return window.LoadMonacoEditor();
            };

            /**
             * @param e {PointerEvent}
             */
            function WindowPointerUpHandler(e) {
                if (!resizingActive || !e.isPrimary || e.button !== 0 || resizingPointerId !== e.pointerId) return;
                resizingActive = false;
                //resizingElement.releasePointerCapture(resizingPointerId);
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                ipc.invoke('resize-window', 'end')
                    .catch(e => window.error(e));
            }

            window.addEventListener('pointerup', WindowPointerUpHandler, {capture: true, passive: false});
            window.addEventListener('pointercancel', WindowPointerUpHandler, {capture: true, passive: false});
            window.addEventListener('lostpointercapture', WindowPointerUpHandler, {capture: true, passive: false});

            /**
             * @param e {KeyboardEvent|Event}
             */
            function WindowKeyDownHandler(e) {
                if (e.key === 'F12') {
                    ipc.invoke('dev-tools', 'open')
                        .catch(e => window.error(e));
                } else if (e.key === 'F5') {
                    ipc.invoke('reload')
                        .catch(e => window.error(e));
                } else if (e.key === 'Escape') {
                    if (!resizingActive) return;
                    resizingActive = false;
                    resizingElement.releasePointerCapture(resizingPointerId);
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    e.preventDefault();

                    ipc.invoke('resize-window', 'end')
                        .catch(e => window.error(e));
                }
            }

            window.addEventListener('keydown', WindowKeyDownHandler, {capture: true, passive: false});

            /**
             * @param e {KeyboardEvent|Event}
             */
            function WindowKeyUpHandler(e) {
                //window.log(e.key);
                // Win+Up = Maximize
                if (e.key === 'ArrowUp' && e.metaKey) {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    e.preventDefault();
                    ipc.invoke('window-command', 'grow')
                        .catch(e => window.error(e));
                }
                // Win+Down = Restore or Minimize
                else if (e.key === 'ArrowDown' && e.metaKey) {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    e.preventDefault();
                    ipc.invoke('window-command', 'reduce')
                        .catch(e => window.error(e));
                }
                // TODO: snapping, vertical maximize, vertical restore
            }

            window.addEventListener('keyup', WindowKeyUpHandler, {capture: true, passive: false});

            ipc.on('resize-window', (event, arg) => {
                // handle abort
                if (arg && arg.startsWith('abort ')) {
                    const pointerId = parseFloat(arg.substring(4));
                    if (resizingElement) resizingElement.releasePointerCapture(pointerId);
                    document.releasePointerCapture(pointerId);
                }
            });

        });

        electron.ipc.invoke('get-resources-path')
            .then(dir => {
                global.ResourcesPath = dir;
                global.NodeModulesPath = path.join(path.dirname(dir), 'node_modules');

            });

        global.fs = fs;
        global.path = path;
        /**
         * Register a blob for use in the app://dw2ide protocol handler.
         *
         * @param {Blob} blob
         * @return {Promise<string>} - The URL that can be used to reference the blob. (app://dw2ide/blob/...)
         */
        global.registerBlob = async (blob) => {
            /** @type {ArrayBuffer} */
            const buffer = await new Promise((resolve, reject) => {
                try {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.readAsArrayBuffer(blob);
                } catch (e) {
                    reject(e);
                }
            });
            return electron.ipc.invoke('register-blob',
                {buffer: new Uint8Array(buffer), type: blob.type});
        };
    }

    await main();

}

window.Dw2DomWorkerManager = Dw2DomWorkerManager;

window.setTheme = async (theme) => {
    if (!await ipc.invoke('change-native-theme', theme))
        throw new Error(`Unsupported native theme: ${theme}`);
};

window.rotateTheme = async () => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark)
        await window.setTheme('light');
    else
        await window.setTheme('dark');
};

window.log("preload.mjs done");
