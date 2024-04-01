import {ipcRenderer as ipc} from 'electron';

ipc.on('storage-init', (event, name) => {
    const port = event.ports[0];
    let storage;
    switch (name) {
        case 'localStorage':
            storage = localStorage;
            break;
        case 'sessionStorage':
            storage = sessionStorage;
            break;
        default:
            port.postMessage({error: new Error(`Unknown storage name: ${name}`)});
            return;
    }

    port.onmessage = async event => {
        const {req, id, key, value} = event.data;
        try {
            switch (req) {
                case 'get':
                    port.postMessage({id, value: storage.getItem(key)});
                    break;
                case 'set':
                    storage.setItem(key, value);
                    port.postMessage({id, value: true});
                    break;
                case 'remove':
                    storage.removeItem(key);
                    port.postMessage({id, value: true});
                    break;
                default:
                    port.postMessage({id, error: `Unknown request: ${req}`});
            }
        } catch (error) {
            port.postMessage({id, error: error.message});
        }
    }
});
