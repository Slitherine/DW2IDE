require('./resources/async-helpers.cjs');
const path = require('node:path');
const bindings = require('bindings');

console.log('dw2-dom-worker loading...');

let ready = false;

/** @type {Class<import('./dom/ImmuDom.mjs').DOMParser>} */
let DOMParser;

/** @type {import('./dom/ImmuDom.mjs')} */
let ImmuDom;

let {Encoder: CborEncoder, addExtension: CborAddExtension} = require('cbor-x');


const {/** @type {import('node-libxml').Libxml} */Libxml} = bindings({
    module_root: path.dirname(require.resolve('node-libxml/package.json')),
    bindings: 'xml.node'
});

import('./dom/ImmuDom.mjs')
    .then((m) => {
        ImmuDom = m;
        DOMParser = m.DOMParser;
        ImmuDom.RegisterWithCborX(CborAddExtension);
        ready = true;
        Dw2DomWorker.ResetDOMParser();
    });

class Dw2DomWorker {
    /** @type {import('./dom/ImmuDom.mjs').DOMParser} */
    static #domParser;

    static ResetDOMParser() {
        Dw2DomWorker.#domParser = new DOMParser();
    }

    static parseXml(xml) {
        return Dw2DomWorker.#domParser.parseFromString(xml, 'application/xml');
    }

    /** @type {Map<string,import('node-libxml').Libxml>} */
    static #libxmlPerSchemaSet = new Map();

    static validateXml(xml, schemas) {
        const noSchemas = !schemas || !schemas.length;
        const schemaSet = noSchemas ? '' : schemas.sort().join('\n');
        let x = Dw2DomWorker.#libxmlPerSchemaSet.get(schemaSet);
        if (!x) {
            x = new Libxml();
            Dw2DomWorker.#libxmlPerSchemaSet.set(schemaSet, x);
            if (!noSchemas)
                x.loadSchemas(schemas);
        }
        const wellFormed = x.loadXmlFromString(xml);
        if (noSchemas)
            return [wellFormed || x.wellformedErrors];

        const validAgainstSchema = x.validateAgainstSchemas();
        if (!validAgainstSchema) {
            const results = x.wellformedErrors.slice();
            for (const [schema, errors] of Object.entries(x.validationSchemaErrors)) {
                for (const error in errors) {
                    results.push({schema, ...error});
                }
            }
            return [results];
        }

        return [wellFormed || x.wellformedErrors];
    }
}

const cbor = new CborEncoder({structuredClone: true});

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

console.log('dw2-dom-worker loaded...');