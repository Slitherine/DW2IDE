import {divContextMenu} from './context-menu.js';
//import {StorageProxy} from './storage-proxy.js';

//const storage = new StorageProxy(window.localStorage);
//window.storage = storage;
//window.StorageProxy = StorageProxy;
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-switch-theme')
        .addEventListener('click', () => window.rotateTheme(), {passive: true});
}, {once: true, passive: true});