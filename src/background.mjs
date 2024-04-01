import {app, BrowserWindow, MessageChannelMain} from 'electron';
import {ResolvePath} from './scheme-app-dw2ide.mjs';

/** @type {BrowserWindow} */
let bgWindow;


async function start() {
    console.log('Initializing background.');
    if (!app.isReady()) {
        await new Promise((resolve, reject) => {
            app.once('ready', resolve);
            app.once('window-all-closed', reject);
        });
    }

    bgWindow = new BrowserWindow({
        //show: true,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            defaultEncoding: 'UTF-8',
            preload: ResolvePath(new URL('app://dw2ide/background.mjs')),
            sandbox: false,
            contextIsolation: false,
            nodeIntegrationInWorker: true,
            nodeIntegrationInSubFrames: true,
            backgroundThrottling: false,
            /*experimentalFeatures: true,*/
            plugins: true,
            additionalArguments: [`--kickoff-url=app://dw2ide/background.html`]
        },
    });

    setInterval(() => {
        // If this is the last window, user probably wants to quit. Closing this
        // hidden window will allow the app to quit.
        const browserWindows = BrowserWindow.getAllWindows();

        if (browserWindows.length === 1 && browserWindows[0] === bgWindow)
            bgWindow.close();
    }, 125);

    console.log('Loading background window content...');
    await bgWindow.loadURL('app://dw2ide/background.html');
    console.log('Background window initialized.');

    //bgWindow.webContents.openDevTools({activate: true});
}

async function asyncDelay(ms) {
    let canceller;
    const p = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(resolve, ms);
        canceller = () => {
            clearTimeout(timeoutId);
            reject(new Error('asyncDelay cancelled'));
        };
    });
    p.cancel = canceller;
    return p;
}

const IntervalFinalizer = new FinalizationRegistry(interval => {
    clearInterval(interval);
});

export class AsyncBrowserStorage {
    /** @type {'localStorage'|'sessionStorage'} */
    #name;
    /** @type {MessagePortMain} */
    #port;
    /** @type {Map<number, {started:number, resolve:(value: any) => void,reject:(reason?: any) => void}>} */
    #messages = new Map();
    #messageCounter = 0;
    #initComplete = false;


    constructor(name) {
        this.#name = name;
        this.#init()
            .catch(error => console.error(error));
    }

    async #init() {
        while (!bgWindow || !bgWindow.webContents)
            await asyncDelay(15);
        const channel = new MessageChannelMain();
        this.#port = channel.port1;
        bgWindow.webContents.postMessage('storage-init', this.#name, [channel.port2]);
        this.#port.on('message', event => {
            const {id, value, error} = event.data;
            const {resolve, reject} = this.#messages.get(id);
            this.#messages.delete(id);
            if (error) {
                reject(error);
                return;
            }
            if (resolve) {
                resolve(value);
            } else {
                console.error('No resolve function for message:', event.data);
            }
        });
        this.#port.start();
        this.#initComplete = true;

        IntervalFinalizer.register(this,
            setInterval(() => {
                // timeout any messages that have been waiting for more than 10 seconds
                const now = performance.now();
                for (const [id, {started, reject}] of this.#messages) {
                    const elapsed = now - started;
                    if (elapsed < 10000) continue;
                    this.#messages.delete(id);
                    reject(new Error(`Message timeout (${elapsed}ms elapsed)`));
                }
            }, 125));
    }

    async getItem(key) {
        while (!this.#initComplete)
            await asyncDelay(15);
        return await new Promise((resolve, reject) => {
            try {
                const id = ++this.#messageCounter;
                const started = performance.now();
                this.#messages.set(id, {started, resolve, reject});
                this.#port.postMessage({req: 'get', id, key});
            } catch (error) {
                reject(error);
            }
        });
    }

    async setItem(key, value) {
        while (!this.#initComplete)
            await asyncDelay(15);
        return await new Promise((resolve, reject) => {
            try {
                const id = ++this.#messageCounter;
                const started = performance.now();
                this.#messages.set(id, {started, resolve, reject});
                this.#port.postMessage({req: 'set', id, key, value});
            } catch (error) {
                reject(error);
            }
        });
    }

    async removeItem(key) {
        while (!this.#initComplete)
            await asyncDelay(15);
        return await new Promise((resolve, reject) => {
            try {
                const id = ++this.#messageCounter;
                const started = performance.now();
                this.#messages.set(id, {started, resolve, reject});
                this.#port.postMessage({req: 'remove', id, key});
            } catch (error) {
                reject(error);
            }
        });
    }

}

start()
    .catch(error => console.error(error));

export const asyncLocalStorage = new AsyncBrowserStorage('localStorage');