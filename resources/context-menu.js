export const divContextMenu = document.createElement('div');
divContextMenu.id = 'context-menu';

function InputIsText(target) {
    switch (target.type) {
        case 'text':
        case 'search':
        case 'url':
        case 'tel':
        case 'email':
        case 'number':
        case 'date':
        case 'month':
        case 'week':
        case 'time':
        case 'datetime-local':
        case 'textarea':
            return true;
        default:
            return false;
    }
}

function ContextMenuSelectAll(event) {
    const target = divContextMenu.contextItem;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.select();
    } else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
    }
    divContextMenu.remove();
}

function ContextMenuSaveImage(event) {
    const target = divContextMenu.contextItem;
    if (target instanceof HTMLImageElement) {
        //const canvas = document.createElement('canvas');
        const canvas = new OffscreenCanvas();
        canvas.width = target.naturalWidth;
        canvas.height = target.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(target, 0, 0);
        canvas.toBlob((blob) => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = target.src.split('/').pop();
            a.click();
            setTimeout(() => {
                URL.revokeObjectURL(a.href);
            }, 5000);
        });
    } else if (target instanceof HTMLCanvasElement) {
        target.toBlob((blob) => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'image.webp';
            a.click();
            setTimeout(() => {
                URL.revokeObjectURL(a.href);
            }, 5000);
        }, 'image/webp', 1);
    } else {
        const canvas = document.createElement('canvas');
        canvas.width = target.clientWidth;
        canvas.height = target.clientHeight;
        const context = canvas.getContext('2d');
        context.drawImage(target, 0, 0);
        canvas.toBlob((blob) => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'image.webp';
            a.click();
            setTimeout(() => {
                URL.revokeObjectURL(a.href);
            }, 5000);
        }, 'image/webp', 1);
    }
    divContextMenu.remove();
}

function ContextMenuClipImageSnapshot(event) {
    const target = divContextMenu.contextItem;

    const targetRect = target.getBoundingClientRect();
    let rect = {
        x: targetRect.x,
        y: targetRect.y,
        width: targetRect.width,
        height: targetRect.height
    };

    if (targetRect.width < 256 || targetRect.height < 256) {
        // grow the rect to at least 256^2, centered, for context
        rect.width = Math.max(rect.width, 256);
        rect.height = Math.max(rect.height, 256);
        rect.x = Math.max(0, targetRect.x - (rect.width - targetRect.width) / 2);
        rect.y = Math.max(0, targetRect.y - (rect.height - targetRect.height) / 2);
    }

    window.electron.capturePage(rect)
        .then((image) => {
            window.electron.clipboard.writeImage(image);
            console.log('Copied to clipboard');
        });

    divContextMenu.remove();
}

function ContextMenuCopySelection() {
    const selection = window.getSelection();

    window.electron.clipboard.writeText(selection.toString());
    console.log('Copied to clipboard');

    divContextMenu.remove();
}

function ContextMenuPasteSelection(event) {
    const target = divContextMenu.contextItem;
    const clipboardContent = window.electron.clipboard.readText();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const selectionStart = target.selectionStart;
        const selectionEnd = target.selectionEnd;
        const value = target.value;
        target.value = value.substring(0, selectionStart) + clipboardContent + value.substring(selectionEnd);
        target.selectionStart = selectionStart + clipboardContent.length;
        target.selectionEnd = target.selectionStart;
    }
    console.log('Pasted from clipboard', clipboardContent);
    divContextMenu.remove();
}


export function ShowContextMenu(event) {
    // make sure not re-entrant
    if (divContextMenu.contains(event.target)) return;

    document.body.appendChild(divContextMenu);
    // it is position: fixed style
    const x = event.pageX;
    const y = event.pageY;
    divContextMenu.style.setProperty('--x', `${x}px`);
    divContextMenu.style.setProperty('--y', `${y}px`);
    divContextMenu.style.setProperty('--o', `0`);
    divContextMenu.innerHTML = '';
    divContextMenu.contextItem = event.target;

    // if text is selected, add copy option
    const selection = window.getSelection();
    if (selection.toString()) {
        const divCopy = document.createElement('div');
        divCopy.textContent = 'Copy';
        divCopy.addEventListener('click', ContextMenuCopySelection);

        divContextMenu.appendChild(divCopy);
    }

    // if input field, add paste option
    if (event.target instanceof HTMLInputElement && InputIsText(event.target)
        || event.target instanceof HTMLTextAreaElement) {
        // type must be text, search, url, tel, email, number, date, month, week, time, datetime-local, or textarea
        const divPaste = document.createElement('div');
        divPaste.textContent = 'Paste';
        divPaste.addEventListener('click', ContextMenuPasteSelection);

        divContextMenu.appendChild(divPaste);
    }

    // if image, add save option
    if (event.target instanceof HTMLImageElement
        || event.target instanceof HTMLCanvasElement
        || event.target instanceof HTMLPictureElement
        || event.target instanceof HTMLVideoElement
        || event.target.classList.contains('image')
    ) {
        const divSave = document.createElement('div');
        divSave.textContent = 'Save Image As...';
        divSave.addEventListener('click', ContextMenuSaveImage);

        divContextMenu.appendChild(divSave);
    }

    // add select all option
    const divSelectAll = document.createElement('div');
    divSelectAll.textContent = 'Select All';
    divSelectAll.addEventListener('click', ContextMenuSelectAll);
    divContextMenu.appendChild(divSelectAll);

    // add HR
    const hr = document.createElement('hr');
    divContextMenu.appendChild(hr);

    // add copy as image option
    const divCopyAsImage = document.createElement('div');
    divCopyAsImage.textContent = 'Partial Screenshot (For Bug Reporting)';
    divCopyAsImage.addEventListener('click', ContextMenuClipImageSnapshot);
    divContextMenu.appendChild(divCopyAsImage);


    // need to account for width after event is complete
    // and push to the right or up to fit in window
    setTimeout(() => {
        requestAnimationFrame(() => {
            const rect = divContextMenu.getBoundingClientRect();
            const maxLeft = window.innerWidth - rect.width;
            const maxTop = window.innerHeight - rect.height;

            if (rect.left > maxLeft)
                divContextMenu.style.setProperty('--x', `${maxLeft}px`);
            if (rect.top > maxTop)
                divContextMenu.style.setProperty('--y', `${maxTop}px`);

            divContextMenu.style.setProperty('--o', `1`);
        });
    }, 0);
}

document.addEventListener('click', (event) => {
    if (divContextMenu.parentNode) {
        if (divContextMenu.contains(event.target)) return;
        divContextMenu.remove();
    } else {
        // show context menu at click position
        if (event.button === 2) {
            ShowContextMenu(event);
        }
    }
}, {passive: true});

document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    ShowContextMenu(event);
}, {passive: false, capture: true});
