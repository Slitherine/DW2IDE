import {ipcRenderer as ipc, shell, clipboard, nativeImage} from 'electron';
import runtime from 'dw2ide-runtime';
import packageJson from '../package.json' assert {type: 'json'};
import packageLockJson from '../package-lock.json' assert {type: 'json'};

/** @external window
 * @type {Window} */
window;

/** @external document
 * @type {Document|HTMLDocument} */
document;

/*ipc.invoke('dev-tools', 'open')
    .catch(e => console.error(e));*/

window.dw2ide = runtime;
window.electron = {
    ipc,
    shell,
    clipboard,
    nativeImage,
    async capturePage(rect) {
        try {
            if (rect instanceof DOMRect)
                rect = {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
            return await ipc.invoke('capture-page', rect);
        } catch (error) {
            return null;
        }
    }
};

const dialogExposure = {
    async showOpenDialog(args) {
        try {
            return await ipc.invoke('show-open-dialog', args);
        } catch (error) {
            return {canceled: true, filePaths: [], error};
        }
    },
    async showSaveDialog(args) {
        try {
            return await ipc.invoke('show-save-dialog', args);
        } catch (error) {
            return {canceled: true, filePath: '', error};
        }
    },
    async showMessageBox(args) {
        try {
            return await ipc.invoke('show-message-box', args);
        } catch (error) {
            return {response: 0, error};
        }
    },
    async showErrorBox(title, content) {
        try {
            return await ipc.invoke('show-error-box', {title, content});
        } catch (error) {
            return {error};
        }
    }
};

window.dialog = dialogExposure;

window.addEventListener('DOMContentLoaded', () => {

    const versions = structuredClone(process.versions);
    versions['ide'] = packageJson.version;
    versions['dotnet'] = runtime.GetNetVersion().split('+', 1)[0];

    for (const [key, value] of Object.entries(packageLockJson.packages))
        if (key.startsWith('node_modules/')) {
            const name = key.substring(13);
            if (name.includes('/') || name.includes('@'))
                continue;
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
        if (!e.isPrimary
            || e.button !== 0) return;
        resizingActive = true;
        resizingElement = e.target;
        resizingPointerId = e.pointerId;
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();
        e.target.setPointerCapture(e.pointerId);
        const direction = e.target.dataset.direction;
        if (!direction) {
            console.error("Resize direction not set on resize helper element.", e.target);
            throw new Error("Resize direction not set on resize helper element.");
        }
        ipc.invoke('resize-window', `start ${direction};${e.screenX},${e.screenY},${e.pointerId}`)
            .catch(e => console.error(e));
    }

    /**
     * @param e {PointerEvent}
     * @returns {void}
     */
    function ResizeHelperPointerUpHandler(e) {
        if (!resizingActive
            || !e.isPrimary
            || e.button !== 0
            || resizingPointerId !== e.pointerId
            || e.target !== resizingElement) {
            return;
        }
        resizingActive = false;
        resizingElement.releasePointerCapture(resizingPointerId);
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();
        ipc.invoke('resize-window', 'end')
            .catch(e => console.error(e));
    }

    const resizeLeft = document.createElement('div');
    resizeLeft.classList.add('helper-resize-left');
    resizeLeft.classList.add('helper-resize-horiz');
    resizeLeft.dataset.direction = 'left';
    container.appendChild(resizeLeft);
    resizeLeft.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {capture: true, passive: false});
    resizeLeft.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true, passive: false});
    resizeLeft.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {capture: true, passive: false});
    resizeLeft.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {capture: true, passive: false});

    const resizeRight = document.createElement('div');
    resizeRight.classList.add('helper-resize-right');
    resizeRight.classList.add('helper-resize-horiz');
    resizeRight.dataset.direction = 'right';
    container.appendChild(resizeRight);
    resizeRight.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {capture: true, passive: false});
    resizeRight.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true, passive: false});
    resizeRight.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {capture: true, passive: false});
    resizeRight.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {capture: true, passive: false});

    const resizeBottom = document.createElement('div');
    resizeBottom.classList.add('helper-resize-bottom');
    resizeBottom.dataset.direction = 'bottom';
    container.appendChild(resizeBottom);
    resizeBottom.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {capture: true, passive: false});
    resizeBottom.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true, passive: false});
    resizeBottom.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {capture: true, passive: false});
    resizeBottom.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {capture: true, passive: false});

    const resizeBottomLeft = document.createElement('div');
    resizeBottomLeft.classList.add('helper-resize-bottom-left');
    resizeBottomLeft.classList.add('helper-resize-corner');
    resizeBottomLeft.dataset.direction = 'bottom left';
    container.appendChild(resizeBottomLeft);
    resizeBottomLeft.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {capture: true, passive: false});
    resizeBottomLeft.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true, passive: false});
    resizeBottomLeft.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {capture: true, passive: false});
    resizeBottomLeft.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {
        capture: true,
        passive: false
    });

    const resizeBottomRight = document.createElement('div');
    resizeBottomRight.classList.add('helper-resize-bottom-right');
    resizeBottomRight.classList.add('helper-resize-corner');
    resizeBottomRight.dataset.direction = 'bottom right';
    container.appendChild(resizeBottomRight);
    resizeBottomRight.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {capture: true, passive: false});
    resizeBottomRight.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true, passive: false});
    resizeBottomRight.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {capture: true, passive: false});
    resizeBottomRight.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {
        capture: true,
        passive: false
    });


    const preloadCss = document.createElement('link');
    preloadCss.rel = 'stylesheet';
    preloadCss.href = 'app://dw2ide/preload.css';
    //document.documentElement.appendChild(container);
    const shadowRoot = document.body.attachShadow({mode: 'closed'});
    shadowRoot.appendChild(preloadCss);
    shadowRoot.appendChild(container);
    shadowRoot.appendChild(document.createElement('slot'));

    /**
     * @param e {PointerEvent}
     */
    function WindowPointerUpHandler(e) {
        if (!resizingActive
            || !e.isPrimary
            || e.button !== 0
            || resizingPointerId !== e.pointerId)
            return;
        resizingActive = false;
        //resizingElement.releasePointerCapture(resizingPointerId);
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();
        ipc.invoke('resize-window', 'end')
            .catch(e => console.error(e));
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
                .catch(e => console.error(e));
        } else if (e.key == 'F5') {
            ipc.invoke('reload')
                .catch(e => console.error(e));
        } else if (e.key === 'Escape') {
            if (!resizingActive)
                return;
            resizingActive = false;
            resizingElement.releasePointerCapture(resizingPointerId);
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();

            ipc.invoke('resize-window', 'end')
                .catch(e => console.error(e));
        }
    }

    window.addEventListener('keydown', WindowKeyDownHandler, {capture: true, passive: false});

    /**
     * @param e {KeyboardEvent|Event}
     */
    function WindowKeyUpHandler(e) {
        //console.log(e.key);
        // Win+Up = Maximize
        if (e.key === 'ArrowUp' && e.metaKey) {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            ipc.invoke('window-command', 'grow')
                .catch(e => console.error(e));
        }
        // Win+Down = Restore or Minimize
        else if (e.key === 'ArrowDown' && e.metaKey) {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            ipc.invoke('window-command', 'reduce')
                .catch(e => console.error(e));
        }
        // TODO: snapping, vertical maximize, vertical restore
    }

    window.addEventListener('keyup', WindowKeyUpHandler, {capture: true, passive: false});

    ipc.on('resize-window', (event, arg) => {
        // handle abort
        if (arg && arg.startsWith('abort ')) {
            const pointerId = parseFloat(arg.substring(4));
            if (resizingElement)
                resizingElement.releasePointerCapture(pointerId);
            document.releasePointerCapture(pointerId);
        }
    });

});

