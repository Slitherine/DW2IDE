require('./resources/async-helpers.cjs');

console.log('dw2-dom-worker loading...');

let ready = false;

/** @type {import('./dom/ImmuDom.mjs').DOMParser} */
let DOMParser;

/** @type {import('./dom/ImmuDom.mjs')} */
let ImmuDom;

let {Encoder:CborEncoder, addExtension:CborAddExtension} = require('cbor-x');

import('./dom/ImmuDom.mjs')
    .then((m) => {
        ImmuDom = m;
        DOMParser = m.DOMParser;
        ImmuDom.RegisterWithCborX(CborAddExtension);
        ready = true;
    });

class Dw2DomWorker {
    static #domParser;

    static parseXml(xml) {
        if (!Dw2DomWorker.#domParser)
            Dw2DomWorker.#domParser = new DOMParser();
        return Dw2DomWorker.#domParser.parseFromString(xml, 'application/xml');
    }
}

const cbor = new CborEncoder({ structuredClone: true })

async function encode(result) {
    if (!Array.isArray(result))
        result = [result];
    /** @type {import('buffer').Buffer} */
    const buffer = cbor.encode(result);
    return new Uint8Array(buffer, buffer.byteOffset, buffer.byteLength);
}

async function decode(buffer) {
    return await cbor.decode(buffer);
}

if ('onconnect' in self) {
    console.log('dw2-dom-worker loading as shared worker...');
    onconnect = (event) => {
        const port = event.ports[0];
        console.log('dw2-dom-worker acting as shared worker', port);
        onmessage = null;
        port.onmessage = async (e) => {
            //console.log('dw2-dom-worker received message:', e, port);

            while (!ready)
                await asyncYield();

            const {id, func, payload} = e.data;
            const args = await decode(payload);

            if (Dw2DomWorker[func] === undefined) {
                port.postMessage({id, error: `function ${func} does not exist`});
                return;
            }

            let result;
            try {
                //console.log("worker invoking", func, args);
                result = Dw2DomWorker[func](...args);
            } catch (error) {
                port.postMessage({id, error});
                return;
            }

            try {
                if (!(result instanceof Promise)) {
                    //console.log("worker returning", result);
                    const encoded = await encode(result);
                    port.postMessage({id, result: encoded}, [encoded.buffer]);
                    return;
                }

                //console.log("worker async returning", result);
                const encoded = await encode(await result);
                port.postMessage({id, result: encoded}, [encoded.buffer]);
            } catch (error) {
                port.postMessage({id, error});
            }
        };
    };
} else {
    console.log('dw2-dom-worker loading as worker...');
    onmessage = async (e) => {
        //console.log('dw2-dom-worker received message:', e);

        while (!ready)
            await asyncYield();

        const {id, func, payload} = e.data;
        const args = await decode(payload);

        if (Dw2DomWorker[func] === undefined) {
            postMessage({id, error: `function ${func} does not exist`});
            return;
        }

        let result;
        try {
            //console.log("worker invoking", func, args);
            result = Dw2DomWorker[func](...args);
        } catch (error) {
            postMessage({id, error});
            return;
        }

        try {
            if (!(result instanceof Promise)) {
                //console.log("worker returning", result);
                const encoded = await encode(result);
                postMessage({id, result: encoded}, [encoded.buffer]);
                return;
            }

            //console.log("worker async returning", result);
            const encoded = await encode(await result);
            postMessage({id, result: encoded}, [encoded.buffer]);
        } catch (error) {
            postMessage({id, error});
        }
    };
}
console.log('dw2-dom-worker loaded...');