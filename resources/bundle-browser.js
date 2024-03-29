import {divContextMenu} from './context-menu.js';

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


const btnLoadBundle = document.getElementById('btn-load-bundle');
const btnUp = document.getElementById('btn-up');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const formPath = document.getElementById('form-path');
const formSearch = document.getElementById('form-search');
const inputPath = document.getElementById('input-path');
const inputSearch = document.getElementById('input-search');
const divLoadedBundle = document.getElementById('div-loaded-bundle');
const contentTree = document.getElementById('content-tree');
const contentListView = document.getElementById('content-list-view');

btnLoadBundle.addEventListener('click', LoadBundle, {passive: true});
btnUp.addEventListener('click', NavigateUp, {passive: true});
btnBack.addEventListener('click', NavigateBack, {passive: true});
btnForward.addEventListener('click', NavigateForward, {passive: true});
formPath.addEventListener('submit', NavigateToPath, {capture: true});
formSearch.addEventListener('submit', Search, {capture: true});

document.addEventListener('DOMContentLoaded', LoadBundle, {once: true, passive: true});

/** @type {Map<string, any>} */
const BundleHandles = new Map();
/** @type {string|null} */
let BundlePath = null;

const PathHistory = [];
const PathFuture = [];

async function LoadBundle() {
    //window.log('Load Bundle button clicked');
    const {filePaths} = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Load Stride Bundle',
        message: 'Select a Stride Bundle to load.',
        filters: [
            {name: 'Stride Bundle', extensions: ['bundle']}
        ],
        buttonLabel: 'Load',
        defaultPath: dw2ide.GetUserChosenGameDirectory()
    });
    if (filePaths !== undefined && filePaths.length > 0) {
        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];
            //window.log(`Load Bundle: ${filePath}`);
            if (BundleHandles.has(filePath)) {
                window.log(`Already loaded bundle: ${filePath}`);
                continue;
            }
            if (filePath.endsWith('.bundle')) {
                const bundle = dw2ide.LoadBundle(filePath);
                if (bundle === undefined) {
                    window.error(`Failed to load bundle: ${filePath}`);
                    continue;
                }
                BundleHandles.set(filePath, bundle);
                //const bundleName = dw2ide.HandleToString(bundle);
                //window.log(`Loaded Bundle: ${bundleName}`);
                window.log(`Loaded bundle: ${filePath}`);
                BundlePath = filePath;
                const divBundle = document.createElement('div');
                divBundle.classList.add('bundle-path');
                divBundle.textContent = filePath;
                divLoadedBundle.appendChild(divBundle);
                OnBundleLoaded();
            }
        }
    } else {
        window.log('Load Bundle: No file(s) selected');
    }
}

function OnBundleLoaded() {
    btnLoadBundle.remove();
    // obtain contents of bundle
    /** @type {string} */
    const path = inputPath.value || '';
    /** @type {string} */
    const search = inputSearch.value || '';
    const handle = BundleHandles.get(BundlePath);

    const queryEnum = dw2ide.QueryBundleObjects(handle, '**');
    if (queryEnum === undefined) {
        window.error("Failed to query bundle objects.");
        return;
    }

    // generate hierarchy of contents
    const tree = Object.create(null);
    for (; ;) {
        /** @type {string | null} */
        const entry = dw2ide.ReadQueriedBundleObject(queryEnum);
        if (entry === undefined) break;

        //window.log(`Entry: ${entry}`);
        const parts = entry.split('/');
        // if the last part is 'path' skip
        if (parts[parts.length - 1] === 'path') continue;
        let node = tree;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (part.length === 0) continue;
            if (node[part] === undefined) {
                node[part] = Object.create(null);
            }
            node = node[part];
        }
    }
    window.log("Finished reading bundle contents.");

    // populate tree view
    contentTree.innerHTML = '';
    const root = document.createElement('ul');
    root.classList.add('tree-root');

    // recursively populate tree
    function populateTree(node, parent) {
        for (const key in node) {
            if (!Object.hasOwn(node, key)) continue;
            const value = node[key];
            const li = document.createElement('li');
            const span = document.createElement('span');
            span.addEventListener('click', TreeNodeClicked, {passive: true});
            span.textContent = key;
            if (parent === root) {
                li.dataset.path = key;
            } else {
                li.dataset.path = `${parent.parentElement.dataset.path}/${key}`;
            }
            li.appendChild(span);
            if (typeof value === 'object') {
                const ul = document.createElement('ul');
                li.appendChild(ul);
                populateTree(value, ul);
            }
            parent.appendChild(li);
        }
    }

    window.log("Populating tree view...");
    populateTree(tree, root);
    window.log("Finished populating tree view.");
    contentTree.appendChild(root);
    window.log("Presented tree view.");
    PopulateContentListView();
}

function TreeNodeClicked(event) {
    const target = event.target;
    if (target.tagName !== 'SPAN') return;
    const li = target.parentElement;
    if (li.tagName !== 'LI') return;
    li.classList.toggle('expanded');
    if (inputPath.value !== li.dataset.path) {
        PathHistory.push(inputPath.value);
        clearPathFuture();
        inputPath.value = li.dataset.path;
        PopulateContentListView();
    }

}

const HexChars = '0123456789ABCDEF';

function PopulateContentListView() {
    let path = inputPath.value;
    let search = inputSearch.value;
    let glob = path || '';
    if (search) {
        glob += `/**/*${search}*`;
    } else {
        glob += '/**';
    }
    if (glob.startsWith('/')) glob = glob.slice(1);

    //window.log(`Glob: ${glob}`);
    contentListView.innerHTML = '';
    const handle = BundleHandles.get(BundlePath);

    //window.log("Populating content list view...");
    const queryEnum = dw2ide.QueryBundleObjects(handle, glob);
    if (queryEnum === undefined) {
        window.error("Failed to query bundle objects.");
        return;
    }

    for (; ;) {
        //window.log("Reading queried bundle object...");
        const entry = dw2ide.ReadQueriedBundleObject(queryEnum);
        if (entry === undefined) break;
        //window.log(`Entry: ${entry}`);
        // add entry to list view
        if (!entry.startsWith(path)) {
            window.warn(`Entry '${entry}' does not match path '${path}'?!`);
            continue;
        }
        let text = entry.slice(path.length);
        if (text.at(0) === '/') text = text.slice(1);
        const div = document.createElement('div');
        const span = document.createElement('span');
        span.textContent = text;
        const itemData = div.dataset;
        itemData.path = entry;
        div.addEventListener('mouseover', ShowContentItemHoverPreview, {passive: true});
        div.addEventListener('contextmenu', ShowContentItemContextMenu, {capture: true});
        div.classList.add('content-list-item');
        div.appendChild(span);
        contentListView.appendChild(div);
        contentListViewObserver.observe(div);
    }
}

const itemMetadataPopulationQueue = new Set();

function QueuePopulateItemMetadata(event) {
    let div = event.target;
    while (div.tagName !== 'DIV' && div.dataset.path === undefined) {
        div = div.parentElement;
        if (div === null) return;
    }
    if (div.objectId !== undefined) return;
    //window.log(`Queueing populate item metadata for '${div.dataset.path}'...`);
    itemMetadataPopulationQueue.add(div);
    if (!populateItemMetadataPending) {
        populateItemMetadataPending = true;
        requestIdleCallback(PopulateItemMetadataIdle);
    }
}

function PopulateItemMetadata(div) {
    const itemData = div.dataset;
    const path = itemData.path;
    const objId = new Uint8Array(16);
    div.objectId = objId;
    const success = dw2ide.TryGetObjectId(path, objId);
    if (success) {
        let str = '0x';
        for (const byte of objId) {
            str += HexChars.at(byte >> 4);
            str += HexChars.at(byte & 0xf);
        }
        itemData.id = str;
        const simpleType = dw2ide.GetObjectSimplifiedType(objId);
        if (simpleType) itemData.simpleType = simpleType;
        const fullType = dw2ide.GetObjectType(objId);
        if (fullType) itemData.type = fullType;
    }
    itemMetadataPopulationQueue.delete(div);
}

function NavigateUp() {
    //window.log('Up button clicked');
    // chop last path component
    let path = inputPath.value;
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash >= 0) {
        path = path.slice(0, lastSlash);
    } else {
        path = '';
    }
    PathHistory.push(inputPath.value);
    clearPathFuture();
    const oldPath = inputPath.value;
    inputPath.value = path;
    if (oldPath !== path) {
        PopulateContentListView();
    }
}

function NavigateBack() {
    //window.log('Back button clicked');
    const path = inputPath.value;
    const prevPath = PathHistory.pop();
    if (prevPath !== undefined) {
        inputPath.value = prevPath;
        PathFuture.push(path);
        PopulateContentListView();
    }
}

function NavigateForward() {
    //window.log('Forward button clicked');
    const path = inputPath.value;
    const nextPath = PathFuture.pop();
    if (nextPath !== undefined) {
        inputPath.value = nextPath;
        PathHistory.push(path);
        PopulateContentListView();
    }
}

function NavigateToPath(event) {
    event.preventDefault();
    //window.log(`Path: ${inputPath.value}`);
    PathHistory.push(inputPath.value);
    clearPathFuture();
    PopulateContentListView();
    return false;
}

function Search(event) {
    event.preventDefault();
    //window.log(`Search: ${inputSearch.value}`);
    PopulateContentListView();
    return false;
}

function clearPathFuture() {
    PathFuture.splice(0, PathFuture.length);
}

let populateItemMetadataPending = false;

const contentListViewObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
        if (entry.isIntersecting)
            QueuePopulateItemMetadata(entry);
    }
}, {root: contentListView, rootMargin: '96px', threshold: 0});

function PopulateItemMetadataIdle() {
    // noinspection LoopStatementThatDoesntLoopJS
    for (const div of itemMetadataPopulationQueue.values()) {
        if (div === undefined)
            return;
        PopulateItemMetadata(div);
        if (itemMetadataPopulationQueue.size > 0) {
            // async but not idle
            setTimeout(PopulateItemMetadataIdle, 0);
        } else {
            populateItemMetadataPending = false;
        }
        break; // just do one at a time
    }
}

function ShowContentItemHoverPreview(event) {
    //event.preventDefault();
    const div = event.target;
    if (div.tagName !== 'DIV') return;
    const itemData = div.dataset;
    const path = itemData.path;
    //window.log(`Updating preview for '${path}'...`);
    const objId = div.objectId;
    const simpleType = itemData.simpleType;
    if (simpleType === 'Texture') {
        //window.log(`Get preview image for '${path}'...`);
        let previewImage;
        if ('previewImage' in div) {
            previewImage = div.previewImage;
            //window.log(`Preview image already loaded for '${path}'.`);
        } else {
            //window.log(`Calling dw2ide.InstantiateBundleItem('${path}')...`);
            const itemHandle = dw2ide.InstantiateBundleItem(path);
            if (itemHandle === undefined) {
                window.error(`Failed to instantiate '${path}'`);
                return;
            }
            window.log(`Calling dw2ide.IsImage('${path}')...`);
            if (!dw2ide.IsImage(itemHandle)) {
                window.error(`'${path}' is not an image.`);
                return;
            }
            previewImage = new Image();
            const dims = dw2ide.GetImageDimensions(itemHandle);
            if (dims !== 2) {
                window.error(`'${path}' is not a 2D image, preview not supported.`);
                return;
            }
            const mipLevels = dw2ide.GetImageMipLevels(itemHandle);
            let targetMip = 0;
            // target width should be relative to the size of the window
            const targetLength = (Math.max(window.innerWidth, window.innerHeight) / 2)
                / window.devicePixelRatio;
            let previewWidth = 0;
            let previewHeight = 0;
            let lastDist = Infinity;
            for (let mipLevel = 0; mipLevel < mipLevels; ++mipLevel) {
                // check width and height separately as the calls aren't instant
                const width = dw2ide.GetImageWidth(itemHandle, mipLevel);
                if (width === undefined) {
                    window.error(`Failed to get width of '${path}' mip level ${mipLevel}.`);
                    continue;
                }
                const height = dw2ide.GetImageHeight(itemHandle, mipLevel);
                if (height === undefined) {
                    window.error(`Failed to get height of '${path}' mip level ${mipLevel}.`);
                    continue;
                }
                const length = Math.max(width, height);
                const dist = Math.abs(length - targetLength);

                // get the closest mip level to the target size
                if (dist < lastDist) {
                    lastDist = dist;
                    targetMip = mipLevel;
                    previewWidth = width;
                    previewHeight = height;
                }
            }
            const imgBuffers = [];
            window.log(`Calling dw2ide.TryConvertImageToStreamWebp('${path}')...`);
            if (!dw2ide.TryConvertImageToStreamWebp(itemHandle, targetMip, function (buffer) {
                imgBuffers.push(buffer);
            })) {
                window.error(`Failed to convert '${path}' to webp.`);
                return;
            }
            window.log(`Creating blob from ${imgBuffers.length} buffers...`);
            const imgBlob = new Blob(imgBuffers, {type: 'image/webp'});
            const imgSrc = URL.createObjectURL(imgBlob);
            itemData.preview = imgSrc;
            previewImage.src = imgSrc;
            div.previewImage = previewImage;
            div.style.setProperty('--preview-src', `url(${imgSrc})`);
            div.style.setProperty('--preview-width', `${previewWidth}px`);
            div.style.setProperty('--preview-height', `${previewHeight}px`);

            dw2ide.ReleaseHandle(itemHandle);
        }
        //window.log("Completed preview image loading.");
    }
}

function ShowContentItemContextMenu(event) {
    // make sure not re-entrant
    event.preventDefault();
    if (divContextMenu.contains(event.target)) return;
    const firstMenuElem = divContextMenu.firstElementChild;
    const div = event.target;
    if (div.tagName !== 'DIV') return;
    const itemData = div.dataset;
    const path = itemData.path;
    window.log(`Show context menu for '${path}'...`);
    const divCopyPath = document.createElement('div');
    divCopyPath.textContent = 'Copy Path';
    divCopyPath.addEventListener('click', ContextMenuCopyPath, {passive: true});
    divContextMenu.insertBefore(divCopyPath, firstMenuElem);

    const divCopyId = document.createElement('div');
    divCopyId.textContent = 'Copy Object ID';
    divCopyId.addEventListener('click', ContextMenuCopyId, {passive: true});
    divContextMenu.insertBefore(divCopyId, firstMenuElem);

    const divCopyType = document.createElement('div');
    divCopyType.textContent = 'Copy Object Type';
    divCopyType.addEventListener('click', ContextMenuCopyType, {passive: true});
    divContextMenu.insertBefore(divCopyType, firstMenuElem);

    const hr = document.createElement('hr');
    divContextMenu.insertBefore(hr, firstMenuElem);

    const divExport = document.createElement('div');
    divExport.textContent = 'Export...';
    divExport.addEventListener('click', ContentItemExport, {passive: true});
    divContextMenu.insertBefore(divExport, firstMenuElem);
    if (itemData.simpleType === 'Texture') {
        const divConvertToWebP = document.createElement('div');
        divConvertToWebP.textContent = 'Export as WebP...';
        divConvertToWebP.addEventListener('click', ContentItemConvertToWebP, {passive: true});
        divContextMenu.insertBefore(divConvertToWebP, firstMenuElem);

        const divConvertToDds = document.createElement('div');
        divConvertToDds.textContent = 'Export as DDS...';
        divConvertToDds.addEventListener('click', ContentItemConvertToDds, {passive: true});
        divContextMenu.insertBefore(divConvertToDds, firstMenuElem);
    }
}

function ContextMenuCopyPath(event) {
    const path = divContextMenu.contextItem.dataset.path;
    window.electron.clipboard.writeText(path);
    window.log(`Copied path '${path}' to clipboard.`);
    divContextMenu.remove();
}

function ContextMenuCopyId(event) {
    const id = divContextMenu.contextItem.dataset.id;
    window.electron.clipboard.writeText(id);
    window.log(`Copied id '${id}' to clipboard.`);
    divContextMenu.remove();
}

function ContextMenuCopyType(event) {
    const type = divContextMenu.contextItem.dataset.type;
    window.electron.clipboard.writeText(type);
    window.log(`Copied type '${type}' to clipboard.`);
    divContextMenu.remove();

}

function ContentItemExport(event) {
    const name = divContextMenu.contextItem.textContent;

    // prompt for save location
    dialog.showSaveDialog({
        title: 'Export Bundle Item',
        message: 'Select a location to save the bundle item.',
        buttonLabel: 'Export',
        defaultPath: dw2ide.GetUserChosenGameDirectory() + '\\' + name,
    }).then(result => {
        if (result.canceled) {
            window.log('Export Bundle Item: No file selected');
            return;
        }
        const filePath = result.filePath;
        if (!filePath) {
            window.error("No file path provided.");
            return;
        }
        window.log(`Export Bundle Item: ${filePath}`);
        const div = divContextMenu.contextItem;
        const objectId = div.objectId;
        const success = dw2ide.TryExportObject(objectId, filePath);
        if (success) {
            window.log(`Exported '${filePath}'`);
        } else {
            window.error(`Failed to export '${filePath}'`);
        }
    }).catch(err => {
        window.error(err);
    });
}

function ContentItemConvertToWebP(event) {
    ContentItemConvert(event, "webp");
    divContextMenu.remove();
}

function ContentItemConvertToDds(event) {
    ContentItemConvert(event, "dds");
    divContextMenu.remove();
}

function ContentItemConvert(event, convertTo) {

    // prompt for save location
    const filters = [
        {name: 'All Files', extensions: ['*']}
    ];
    let exportMethod;
    switch (convertTo) {
        default:
        case "webp":
            exportMethod = dw2ide.TryExportImageAsWebp;
            filters.unshift({name: 'WebP Image', extensions: ['webp']});
            break;
        case "dds":
            exportMethod = dw2ide.TryExportImageAsDds;
            filters.unshift({name: 'DirectDraw Surface', extensions: ['dds']});
            break;
    }
    if (!exportMethod) {
        debugger;
        window.error(`No export method for '${convertTo}'`);
        return;
    }

    const name = divContextMenu.contextItem.textContent;
    dialog.showSaveDialog({
        title: 'Export Bundle Item',
        message: 'Select a location to save the bundle item.',
        buttonLabel: 'Export',
        defaultPath: dw2ide.GetUserChosenGameDirectory() + '\\' + name,
        filters: filters,
    }).then(result => {
        if (result.canceled) {
            window.log('Export Bundle Item: No file selected');
            return;
        }
        const filePath = result.filePath;
        if (!filePath) {
            window.error("No file path provided.");
            return;
        }

        window.log(`Export Bundle Item: ${filePath}`);
        const div = divContextMenu.contextItem;
        const path = div.dataset.path;
        if (!path) {
            window.error("No path associated with context menu item.");
            return;
        }
        window.log(`Calling dw2ide.InstantiateBundleItem('${path}')...`);
        const itemHandle = dw2ide.InstantiateBundleItem(path);
        if (itemHandle === undefined) {
            window.error(`Failed to instantiate '${path}'`);
            return;
        }

        const success = exportMethod(itemHandle, filePath);
        if (success) {
            window.log(`Exported '${filePath}'`);
        } else {
            window.error(`Failed to export '${filePath}'`);
        }

        dw2ide.ReleaseHandle(itemHandle);
    }).catch(err => {
        window.error(err);
    });
}

window.addEventListener('beforeinstallprompt', (e) => {
    window.log('beforeinstallprompt event fired');
    e.prompt();
});