import {app, protocol} from 'electron/main';

export {AppDw2IdeProtocolHandler, AppDw2IdeClrProtocolHandler} from './scheme-app-dw2ide.mjs';

/**
 * Installs the 'app' protocol handler.
 * @param protocolString {string} - the protocol string to install, e.g. 'app'
 * @param perHostBindingsForApp {Map<string, CallableFunction<void,URL,GlobalRequest,GlobalResponse|Promise<GlobalResponse>>>} - a map of host names to binding functions
 * @param schemePrivileges {Electron.Privileges?} - the scheme privileges to install, e.g. {standard: true, secure: true}
 * @returns {Promise<void>}
 */
export async function InstallProtocolHandler(protocolString, perHostBindingsForApp, schemePrivileges) {
    if (!protocolString) throw new Error("protocolString is required.");
    if (!perHostBindingsForApp) throw new Error("perHostBindingsForApp is required.");
    if (app.isReady()) throw new Error("App must not be already ready when installing protocol handlers.");

    console.log(`Installing protocol handler for '${protocolString}'...`);

    app.addListener('ready', () => {
        if (protocol.isProtocolHandled(protocolString)) throw new Error("Protocol handler already installed.");

        console.log(`Activating protocol handler for '${protocolString}'...`);
        protocol.handle(protocolString,
            /** @type {CallableFunction<void,GlobalRequest,GlobalResponse|Promise<GlobalResponse>>} */
            async (request) => {
                const url = new URL(request.url);
                const host = url.hostname;
                const binding = perHostBindingsForApp.get(host);
                if (!binding) perHostBindingsForApp.get('*');
                if (!binding) throw new Error(`No binding found for host '${host}'.`);
                if (typeof binding !== 'function') throw new Error(`Binding for host '${host}' is not a function.`);
                return binding(request, url);
            });
    });

    if (schemePrivileges) {
        protocol.registerSchemesAsPrivileged([
            {scheme: protocolString, privileges: schemePrivileges}
        ]);
    }
}