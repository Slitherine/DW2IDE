const {contextBridge, ipcRenderer: ipc} = require('electron');

window.addEventListener('DOMContentLoaded', () => {

    const keys = Object.keys(process.versions);
    const selector = `span.${keys.join('-version, span.')}-version`;

    const versionElements = document.querySelectorAll(selector);

    for (const versionElement of versionElements) {
        const versionType = versionElement.className.split('-', 1)[0];
        versionElement.innerText = process.versions[versionType];
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
    resizeLeft.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {capture: true});
    resizeLeft.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true});
    resizeLeft.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {capture: true});
    resizeLeft.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {capture: true});

    const resizeRight = document.createElement('div');
    resizeRight.classList.add('helper-resize-right');
    resizeRight.classList.add('helper-resize-horiz');
    resizeRight.dataset.direction = 'right';
    container.appendChild(resizeRight);
    resizeRight.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {capture: true});
    resizeRight.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true});
    resizeRight.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {capture: true});
    resizeRight.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {capture: true});

    const resizeBottom = document.createElement('div');
    resizeBottom.classList.add('helper-resize-bottom');
    resizeBottom.dataset.direction = 'bottom';
    container.appendChild(resizeBottom);
    resizeBottom.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {capture: true});
    resizeBottom.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true});
    resizeBottom.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {capture: true});
    resizeBottom.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {capture: true});

    const resizeBottomLeft = document.createElement('div');
    resizeBottomLeft.classList.add('helper-resize-bottom-left');
    resizeBottomLeft.classList.add('helper-resize-corner');
    resizeBottomLeft.dataset.direction = 'bottom left';
    container.appendChild(resizeBottomLeft);
    resizeBottomLeft.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {capture: true});
    resizeBottomLeft.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true});
    resizeBottomLeft.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {capture: true});
    resizeBottomLeft.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {capture: true});

    const resizeBottomRight = document.createElement('div');
    resizeBottomRight.classList.add('helper-resize-bottom-right');
    resizeBottomRight.classList.add('helper-resize-corner');
    resizeBottomRight.dataset.direction = 'bottom right';
    container.appendChild(resizeBottomRight);
    resizeBottomRight.addEventListener('pointerdown', ResizeHelperPointerDownHandler, {passive: true});
    resizeBottomRight.addEventListener('pointerup', ResizeHelperPointerUpHandler, {capture: true});
    resizeBottomRight.addEventListener('pointercancel', ResizeHelperPointerUpHandler, {capture: true});
    resizeBottomRight.addEventListener('lostpointercapture', ResizeHelperPointerUpHandler, {capture: true});


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

    window.addEventListener('pointerup', WindowPointerUpHandler, {capture: true});
    window.addEventListener('pointercancel', WindowPointerUpHandler, {capture: true});
    window.addEventListener('lostpointercapture', WindowPointerUpHandler, {capture: true});

    /**
     * @param e {KeyboardEvent}
     */
    function WindowKeyDownHandler(e) {
        if (e.key === 'F12') {
            ipc.invoke('dev-tools', 'open')
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

    window.addEventListener('keydown', WindowKeyDownHandler, {capture: true});

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

    window.addEventListener('keyup', WindowKeyUpHandler, {capture: true});

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

/*
ipc.invoke('dev-tools', 'open')
    .catch(e => console.error(e));
*/
