import {BaseClass} from './base-class.js';

const rxChangeCaseLowerToUpper = /([a-z])([A-Z])/g;

function convertToKebabCase(prop) {
    return prop.replace(rxChangeCaseLowerToUpper,
        (m, p1, p2) => `${p1}-${p2.toLowerCase()}`);
}

export class StorageProxy extends BaseClass {
    #provider;

    constructor(storageProvider) {
        super();
        if (!storageProvider)
            throw new Error('Storage provider is required');
        this.#provider = storageProvider;
        return new Proxy(this, {
            get(target, prop, receiver) {
                if (typeof (prop) !== 'string')
                    return undefined;
                const result = target.#getItem(convertToKebabCase(prop));
                if (result !== null)
                    return result;
                return undefined;
            },
            set(target, prop, value, receiver) {
                if (typeof (prop) !== 'string')
                    return false;
                target.#setItem(convertToKebabCase(prop), value);
                return true;
            },
            deleteProperty(target, prop, receiver) {
                if (typeof (prop) !== 'string')
                    return false;
                target.#removeItem(convertToKebabCase(prop));
                return true;
            }
        });
    }

    #getItem(key) {
        return this.#provider.getItem(key);
    }

    #setItem(key, value) {
        this.#provider.setItem(key, value);
    }

    #removeItem(key) {
        this.#provider.removeItem(key);
    }
}
