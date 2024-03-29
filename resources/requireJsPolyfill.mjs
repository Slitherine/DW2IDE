export class RequireJsPolyfill {

    static #require = undefined;

    static modules = new Map();

    constructor() {
        throw new Error('RequirePolyfill is a static class and cannot be instantiated.');
    }

    static resolve(deps, module) {
        return deps.map(dep => {
            if (dep === 'require')
                return RequireJsPolyfill.require;
            if (dep === 'exports')
                return module.exports;
            if (dep === 'module')
                return module;
            return RequireJsPolyfill.require(dep);
        });
    }

    static require(id) {

        if (RequireJsPolyfill.modules.has(id))
            return RequireJsPolyfill.modules.get(id).exports;

        if (RequireJsPolyfill.#require)
            return RequireJsPolyfill.#require(id);

        throw new Error(`can't resolve module ${id}`);
    }

    static {
        if (RequireJsPolyfill.#require === undefined
            && !('define' in globalThis)) {
            RequireJsPolyfill.#require = globalThis.require;

            globalThis.require = RequireJsPolyfill.require;
            globalThis.define = RequireJsPolyfill.define;

            // copy properties of backupRequire to require
            for (const key in RequireJsPolyfill.#require) {
                if (RequireJsPolyfill.#require.hasOwnProperty(key))
                    RequireJsPolyfill.require[key] = RequireJsPolyfill.#require[key];
            }
        }
    }

    static #define(id, deps, factory) {
        // example arguments:
        // id: "vs/css"
        // deps: ["require", "exports"]
        // factory: function(require, exports) { ... }

        const module = {exports: {}};
        if (id) RequireJsPolyfill.modules.set(id, module);
        let result;

        const factoryType = typeof factory;
        if (factoryType === 'function') {
            if (factory.length === 0) {
                result = factory(RequireJsPolyfill.require, module.exports, module);
            } else if (factory.length <= deps.length) {
                result = factory(...RequireJsPolyfill.resolve(deps, module));
            } else {
                result = factory(RequireJsPolyfill.require, module.exports, module);
            }
        } else {
            //debugger;
            console.warn('factory is not a function:', factoryType, factory);
            result = factory;
        }
        if (result !== undefined)
            module.exports = result;

        console.log('define:', id, deps, factory, module.exports);
        return module.exports;
    }

    static define(id, deps, factory) {
        // dynamic arguments version of defineHelper
        if (arguments.length === 1)
            return RequireJsPolyfill.#define(null, ['require', 'exports'], arguments[0]);
        else if (arguments.length === 2)
            return RequireJsPolyfill.#define(arguments[0], ['require', 'exports'], arguments[1]);
        else
            return RequireJsPolyfill.#define(...arguments);
    }
}