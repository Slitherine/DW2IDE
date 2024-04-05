import fs from 'node:fs/promises';
import fsSync from 'node:fs';

import parseXml, {DOMParser, RegisterWithCborX} from './dom/ImmuDom.mjs';
import {addExtension as CborAddExtension, Encoder as CborEncoder} from 'cbor-x';


// for debug
window.parseXml = parseXml;

require('./resources/async-helpers.cjs');


self.NodeList.prototype.find = Array.prototype.find;

const LOG_36 = Math.log(36);

function WrapError(message, err) {
    const cause = err;
    const newErr = new Error(message, {cause});
    if (!('cause' in newErr) && 'cause' !== cause) newErr.cause = cause;
    newErr.stack = err.stack + "\n--- async ---\n" + newErr.stack;
    return newErr;
}

/**
 * This is a class representing the combined XML DOM of all the DW2 XML data files.
 * This aggregates the data from the various XML files into a single DOM object.
 */
export class Dw2DomWorkerManager {
    static {
        RegisterWithCborX(CborAddExtension);
    }

    static async #encode(data) {
        /** @type {import('buffer').Buffer} */
        const buf = cbor.encode(data);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }

    static async #decode(buffer) {
        return cbor.decode(buffer);
    }

    static createWorker() {
        const worker = new Worker('dw2-dom-worker.js', {type: 'classic', name: 'dw2-dom-worker'});
        worker.onmessage = (e) => {
            //window.log('Received message from worker:', e);
            const {id, result, error} = e.data;
            const handler = Dw2DomWorkerManager.#msgHandlers.get(id);
            if (handler) {
                console.log('Returning worker to pool');
                Dw2DomWorkerManager.#freeWorkerPool.push(worker);
                Dw2DomWorkerManager.#msgHandlers.delete(id);
                if (error) handler.reject(error);
                else {
                    Dw2DomWorkerManager.#decode(result)
                        .then(decoded => {
                            //window.log('Decoded message from worker:', id, decoded);
                            handler.resolve(...decoded);
                        })
                        .catch(err => {
                            const wrapped = WrapError(`Failed to decode message result for id ${id} due to: ${err.message}`, err);
                            console.error(wrapped);
                            handler.reject(wrapped);
                        });
                }
            } else {
                window.error(`Received unknown message id ${id} from worker`, e);
            }
        };
        return worker;
    }

    static #getWorker() {
        if (Dw2DomWorkerManager.#freeWorkerPool.length > 0) {
            console.log('Reusing worker from pool');
            return Dw2DomWorkerManager.#freeWorkerPool.pop();
        }
        console.log('Creating new worker');
        return Dw2DomWorkerManager.createWorker();
    }

    static #freeWorkerPool = [];
    // shared worker isn't working at the moment, bug in electron?
    //static #worker = new SharedWorker('dw2-dom-worker.js', {type: 'classic', name: 'dw2-dom-worker'});
    static #msgIdCounter = 0;
    static #msgHandlers = new Map();
    static #msgFunctions = new Map();

    static #postMessage(msg, transfer) {
        const msgId = msg.id;
        const worker = Dw2DomWorkerManager.#getWorker();
        console.log(`Invoking ${msg.func} on worker as message ${msgId}`);
        worker.postMessage(msg, transfer);
        const sw = new Stopwatch();
        const interval = setInterval(() => {
            if (Dw2DomWorkerManager.#msgHandlers.has(msgId)) {
                console.log('Worker message still running: %d, %d', msgId, sw.elapsed);
            } else {
                clearInterval(interval);
            }
        }, 1000);
    }

    static #msgFunctionTemplate(name, ...args) {
        return new Promise((resolve, reject) => {
            const id = Dw2DomWorkerManager.#msgIdCounter++;
            Dw2DomWorkerManager.#msgHandlers.set(id, {resolve, reject});
            Dw2DomWorkerManager.#encode(args)
                .then(encoded => {
                    Dw2DomWorkerManager.#postMessage({id, func: name, payload: encoded}, [encoded.buffer]);
                })
                .catch(err => {
                    const wrapped = WrapError(`Failed to encode message payload for function "${name}" due to: ${err.message}`, err);
                    console.error(wrapped);
                    reject(wrapped);
                });
        });
    }

    static #workerProxy = new Proxy(Object.create(null), {
        apply(target, thisArg, argumentsList) {
            const cacheFn = Dw2DomWorkerManager.#msgFunctions.get(null);
            if (cacheFn) return cacheFn;
            const fn = Dw2DomWorkerManager.#msgFunctionTemplate.bind(null, null);
            Dw2DomWorkerManager.#msgFunctions.set(null, fn);
            return fn;
        },
        get(target, p, receiver) {
            if (Object.hasOwn(target, p))
                return Reflect.get(target, p, receiver);
            const cacheFn = Dw2DomWorkerManager.#msgFunctions.get(p);
            if (cacheFn) return cacheFn;
            const fn = Dw2DomWorkerManager.#msgFunctionTemplate.bind(null, p);
            Dw2DomWorkerManager.#msgFunctions.set(p, fn);
            return fn;
        }
    });

    static get worker() {
        return Dw2DomWorkerManager.#workerProxy;
    }

}

export class Dw2DomSchema {
    /** @type {DOMParser} */
    #domParser;
    #nativeDomParser;
    /** @type {string} */
    rootElementName;
    /** @type {string} */
    rootType;
    /** @type {Map<string,
     * Dw2DomSchemaType
     * | Dw2DomSchemaComplexType
     * | Dw2DomSchemaSimpleType
     * >} */
    typesMap = new Map();
    /** @type {Map<string,Dw2DomSchemaElement>} */
    elementMap = new Map();

    constructor(bodyType, domParser, nativeDomParser) {
        this.rootElementName = bodyType;
        this.#domParser = domParser;
        this.#nativeDomParser = nativeDomParser;
    }

    /**
     * Resolves a type name to a schema type.
     * @param {string} typeName - the type name to resolve
     * @returns {
     *      Dw2DomString
     *      | Dw2DomBoolean
     *      | Dw2DomByte
     *      | Dw2DomShort
     *      | Dw2DomInt
     *      | Dw2DomFloat
     *      | Dw2DomSchemaType
     *      | Dw2DomSchemaComplexType
     *      | Dw2DomSchemaSimpleType
     *      | undefined
     * } the resolved type, or undefined if the type name is not found
     */
    resolveType(typeName) {
        if (typeName.startsWith('xs:')) {
            switch (typeName) {
                case 'xs:string':
                    return Dw2DomString;
                case 'xs:boolean':
                    return Dw2DomBoolean;
                case 'xs:unsignedByte':
                    return Dw2DomByte;
                case 'xs:short':
                    return Dw2DomShort;
                case 'xs:int':
                    return Dw2DomInt;
                case 'xs:float':
                    return Dw2DomFloat;

                // for now don't care about the rest
                default:
                    window.warn(`Unimplemented primitive type "${typeName}"`);
                    return undefined;
            }
        }

        return this.typesMap.get(typeName);
    }

    get rootElement() {
        return this.elementMap.get(this.rootElementName);
    }

    get rootType() {
        this.rootElement.type;
    }

    get elements() {
        return this.elementMap.values();
    }

    get types() {
        return this.typesMap.values();
    }

    toString() {
        return `Dw2DomSchema(${this.rootElementName})`;
    }

    [Symbol.toStringTag]() {
        return this.toString();
    }
}

/**
 * @abstract
 */
export class Dw2DomPrimitiveType {
    /** @type {any} */
    value;

    toString() {
        if ('value' in this)
            return `${this.constructor.name}(${this[Symbol.toPrimitive]('string')})`;
        return `${this.constructor.name}`;
    }

    [Symbol.toStringTag]() {
        return this.toString();
    }

    valueOf() {
        return this.value;
    }

    [Symbol.toPrimitive](hint) {
        const v = this.value;
        const t = typeof v;
        if (hint === 'string')
            return t === 'string' ? v : v?.toString();
        if (t === 'object' && Symbol.toPrimitive in v)
            return v[Symbol.toPrimitive](hint);
        return v;
    }
}

/**
 * @abstract
 */
export class Dw2DomNumberType extends Dw2DomPrimitiveType {
    /** @type {number} */
    value;

    toString() {
        if ('value' in this)
            return `${this.constructor.name}(${this.value})`;
        return `${this.constructor.name}`;
    }

    [Symbol.toStringTag]() {
        return this.toString();
    }

    valueOf() {
        return this.value;
    }

    [Symbol.toPrimitive](hint) {
        if (hint === 'string')
            return this.value?.toString();
        return this.value;
    }
}

export class Dw2DomString extends Dw2DomPrimitiveType {
    singleton = Object.freeze(new Dw2DomString());

    /** @type {string} */
    static name = 'xs:string';

    /** @type {string} */
    value;

    constructor(value) {
        super();
        this.value = this.parse(value);
    }

    /**
     * Parses the value from a string.
     * @param value {string} - the value to parse
     * @returns {string} the parsed value
     */
    static parse(value) {
        return value;
    }

    /**
     * Validates the value.
     * @param value {any} - the value to validate
     * @returns {boolean} true if the value is valid, false otherwise
     */
    static validate(value) {
        return typeof value === 'string';
    }

    [Symbol.toPrimitive](hint) {
        if (hint === 'number')
            return parseFloat(this.value);
        return this.value;
    }
}

export class Dw2DomBoolean extends Dw2DomPrimitiveType {
    singleton = Object.freeze(new Dw2DomBoolean());

    /** @type {string} */
    static name = 'xs:boolean';

    /** @type {boolean} */
    value;

    constructor(value) {
        super();
        this.value = this.parse(value);
    }

    /**
     * Parses the value from a string.
     * @param value {string} - the value to parse
     * @returns {boolean} the parsed value
     */
    static parse(value) {
        return value === 'true';
    }

    /**
     * Validates the value.
     * @param value {any} - the value to validate
     * @returns {boolean} true if the value is valid, false otherwise
     */
    static validate(value) {
        return typeof value === 'boolean';
    }

    [Symbol.toPrimitive](hint) {
        if (hint === 'number')
            return this.value ? 1 : 0;
        if (hint === 'string')
            return this.value ? 'true' : 'false';
        return this.value;
    }
}

export class Dw2DomByte extends Dw2DomNumberType {
    singleton = Object.freeze(new Dw2DomByte());

    /** @type {string} */
    static name = 'xs:unsignedByte';

    constructor(value) {
        super();
        this.value = this.parse(value);
    }

    /**
     * Parses the value from a string.
     * @param value {string} - the value to parse
     * @returns {number} the parsed value
     */
    static parse(value) {
        const v = parseInt(value, 10);
        if ((v & 255) !== v)
            throw Error(`Value "${value}" is not a valid byte`);
        return v;
    }

    /**
     * Validates the value.
     * @param value {any} - the value to validate
     * @returns {boolean} true if the value is valid, false otherwise
     */
    static validate(value) {
        return Number.isInteger(value) && (value & 255) === value;
    }
}

export class Dw2DomShort extends Dw2DomNumberType {
    singleton = Object.freeze(new Dw2DomShort());

    /** @type {string} */
    static name = 'xs:short';

    constructor(value) {
        super();
        this.value = this.parse(value);
    }

    /**
     * Parses the value from a string.
     * @param value {string} - the value to parse
     * @returns {number} the parsed value
     */
    static parse(value) {
        const v = parseInt(value, 10);
        if ((v & 65535) !== v)
            throw Error(`Value "${value}" is not a valid short`);
        return v;
    }

    /**
     * Validates the value.
     * @param value {any} - the value to validate
     * @returns {boolean} true if the value is valid, false otherwise
     */
    static validate(value) {
        return Number.isInteger(value) && (value & 65535) === value;
    }
}

export class Dw2DomInt extends Dw2DomNumberType {
    singleton = Object.freeze(new Dw2DomInt());

    /** @type {string} */
    static name = 'xs:int';

    constructor(value) {
        super();
        this.value = this.parse(value);
    }

    /**
     * Parses the value from a string.
     * @param value {string} - the value to parse
     * @returns {number} the parsed value
     */
    static parse(value) {
        return parseInt(value, 10);
    }

    /**
     * Validates the value.
     * @param value {any} - the value to validate
     * @returns {boolean} true if the value is valid, false otherwise
     */
    static validate(value) {
        return Number.isInteger(value) && (value | 0) === value;
    }
}

export class Dw2DomFloat extends Dw2DomNumberType {
    singleton = Object.freeze(new Dw2DomFloat());

    /** @type {string} */
    static name = 'xs:float';

    static floatBuffer = new Float32Array(1);

    constructor(value) {
        super();
        this.value = this.parse(value);
    }

    /**
     * Parses the value from a string.
     * @param value {string} - the value to parse
     * @returns {number} the parsed value
     */
    static parse(value) {
        Dw2DomFloat.floatBuffer[0] = parseFloat(value);
        return Dw2DomFloat.floatBuffer[0];
    }

    /**
     * Validates the value.
     * @param value {any} - the value to validate
     * @returns {boolean} true if the value is valid, false otherwise
     */
    static validate(value) {
        if (typeof value !== 'number')
            return false;
        Dw2DomFloat.floatBuffer[0] = value;
        return Dw2DomFloat.floatBuffer[0] === value;
    }
}

export class Dw2DomSchemaElement {
    /** @type {Dw2DomSchema} */
    schema;
    /** @type {string} */
    name;
    /** @type {string} */
    typeName;
    /** @type {string} */
    default;
    /** @type {boolean} */
    nillable;

    /**
     * @param name {string}
     * @param type {string}
     * @param defaultVal {string}
     * @param nillable {boolean}
     * @param schema {Dw2DomSchema}
     */
    constructor(name, type, defaultVal, nillable, schema) {
        this.name = name;
        this.typeName = type;
        this.default = defaultVal;
        this.nillable = nillable;
        this.schema = schema;
    }


    /** @type {Dw2DomSchemaType} */
    get type() {
        return this.schema.resolveType(this.typeName);
    }
}

export class Dw2DomSchemaChildElement extends Dw2DomSchemaElement {
    /** @type {number} */
    minOccurs;
    /** @type {number} */
    maxOccurs;

    /**
     * @param name {string}
     * @param type {string}
     * @param minOccurs {number}
     * @param maxOccurs {number}
     * @param defaultVal {string}
     * @param nillable {boolean}
     * @param schema {Dw2DomSchema}
     */
    constructor(name, type, minOccurs, maxOccurs, defaultVal, nillable, schema) {
        super(name, type, defaultVal, nillable, schema);
        this.minOccurs = minOccurs;
        this.maxOccurs = maxOccurs;
    }
}

export class Dw2DomSchemaType {
    /** @type {Dw2DomSchema} */
    schema;
    /** @type {string} */
    name;

    /**
     * @param {string} name
     * @param {Dw2DomSchema} schema
     */
    constructor(name, schema) {
        this.name = name;
        this.schema = schema;
    }
}

export class Dw2DomSchemaComplexType extends Dw2DomSchemaType {

    /** @type {string} */
    contentType; // supported: xs:all, xs:sequence
    /** @type {Map<string,Dw2DomSchemaChildElement>} */
    elementMap;
    /** @type {string[]} */
    elementOrder;

    /**
     * @param name {string}
     * @param contentType {string}
     * @param elements {Map<string,Dw2DomSchemaChildElement>}
     * @param elementOrder {string[]}
     * @param schema {Dw2DomSchema}
     */
    constructor(name, contentType, elements, elementOrder, schema) {
        super(name, schema);
        this.contentType = contentType;
        this.elementMap = elements;
        this.elementOrder = elementOrder;
    }

    get elements() {
        return this.elementOrder.map(name => this.elementMap.get(name));
    }
}

const SetWriteFuncNames = Object.freeze(new Set([
    'add',
    'clear',
    'delete'
]));

export class Dw2DomSchemaSimpleType extends Dw2DomSchemaType {
    /** @type {string} */
    base;
    /** @type {Set<string>} */
    #valueSet;

    /** @type {IterableIterator<string>|ReadonlySet<string>|Proxy<IterableIterator<string>>} */
    #values;

    /**
     * @param name {string}
     * @param base {string}
     * @param values {Set<string>}
     * @param schema {Dw2DomSchema}
     */
    constructor(name, base, values, schema) {
        super(name, schema);
        this.base = base;
        this.#valueSet = values;
        this.#values = new Proxy(this.#valueSet.values(), {
            get(target, p, receiver) {
                if (p !== Symbol.iterator && !SetWriteFuncNames.has(p))
                    return Reflect.get(this.#valueSet, p, receiver);
                return Reflect.get(target, p, receiver);
            }
        });
    }

    /**
     * @returns {IterableIterator<string>|Set<string>}
     */
    get values() {
        return this.#values;
    }
}

/**
 *
 * @implements {import('monaco-editor').languages.CompletionItemProvider}
 * @implements {import('monaco-editor').languages.HoverProvider}
 * @implements {import('monaco-editor').languages.DocumentSymbolProvider}
 * @implements {import('monaco-editor').languages.ImplementationProvider}
 * @implements {import('monaco-editor').languages.DefinitionProvider}
 * @implements {import('monaco-editor').languages.DeclarationProvider}
 * @implements {import('monaco-editor').languages.ReferenceProvider}
 */
export class Dw2Dom {
    /** @type {string} */
    #gameDir = null;
    /** @type {DOMParser} */
    #domParser = new DOMParser({locator: true, onError: window.error, errorsAsTextNodes: true});
    #nativeDomParser = new self.DOMParser();
    /** @type {Map<string,string>} */
    static #specialElementKeys = new Map([
        ['GameEvent', 'Name'],
        ['CharacterRoom', 'RoomId'],
        ['ComponentDefinition', 'ComponentId'],
        ['ResearchProjectDefinition', 'ResearchProjectId'],
    ]);
    #bodyToChildTypeMap = new Map();
    #childToBodyTypeMap = new Map();

    /**
     * @param type {string}
     * @returns {string}
     */
    static #getPrimaryKeyElementName(type) {
        return Dw2Dom.#specialElementKeys.get(type) || type + 'Id';
    }


    /**
     * These are hard coded for now.
     * In DW2 these are hard coded as file search globs like "Name*.xml"
     * Policy files are in the data/policy subdirectory and named by their associated Race.
     *
     *  @type {Map<string,string>} */
    #filePrefixToSchemaName = new Map([
        ['Artifacts', 'ArrayOfArtifact'],
        ['CharacterAnimations', 'ArrayOfCharacterAnimation'],
        ['CharacterRooms', 'ArrayOfCharacterRoom'],
        ['CharacterDefinitions', 'ArrayOfCharacterDefinition'], // not in-game yet?
        ['CreatureTypes', 'ArrayOfCreatureType'],
        ['ColonyEventDefinitions', 'ArrayOfColonyEventDefinition'],
        ['ComponentDefinitions', 'ArrayOfComponentDefinition'],
        ['DesignTemplates', 'ArrayOfDesignTemplate'],
        ['FleetTemplates', 'ArrayOfFleetTemplate'],
        ['GameEvents', 'ArrayOfGameEvent'],
        ['Governments', 'ArrayOfGovernment'],
        ['GraphicsSettings', 'GraphicsSettings'],
        ['OrbTypes', 'ArrayOfOrbType'],
        ['PlanetaryFacilityDefinitions', 'ArrayOfPlanetaryFacilityDefinition'],
        ['Races', 'ArrayOfRace'],
        ['ResearchProjectDefinitions', 'ArrayOfResearchProjectDefinition'],
        ['Resource', 'ArrayOfResource'],
        ['ShipHulls', 'ArrayOfShipHull'],
        ['SpaceItemDefinitions', 'ArrayOfSpaceItemDefinition'],
        ['TourItems', 'ArrayOfTourItem'],
        ['TroopDefinitions', 'ArrayOfTroopDefinition'],
    ]);

    #filePrefixes = [...this.#filePrefixToSchemaName.keys()];

    /** @type {Document|{nsResolver:XPathNSResolver,xPathEvaluator:XPathEvaluator}} */
    document = null;
    /** @type {Map<string,Document|{nsResolver:XPathNSResolver,xPathEvaluator:XPathEvaluator}>} */
    schemaDocs = new Map();
    /** @type {Map<string,Dw2DomSchema>} */
    schemata = new Map();
    /** @type {Map<string,string>} */
    gameText = new Map();

    constructor(gameDir) {
        if (!gameDir) {
            if (!window.dw2ide)
                window.error("the first argument must be the game dir, or dw2ide must be loaded first.");
            gameDir = dw2ide.GetUserChosenGameDirectory();
        }

        this.#gameDir = gameDir;
    }

    /**
     * Scans the document's root element for a tag name.
     * Does not descend into child elements.
     * @param tagName {string}
     * @returns {Element} the body element with the specified tag name
     */
    #getBodyElement(tagName) {
        // can't use querySelector in xmldom
        //return this.document.querySelector(`:root>${tagName}`);
        return this.document.documentElement.childNodes
            .find(node => node.nodeType === Node.ELEMENT_NODE
                && node.tagName === tagName);
    }

    /**
     * Loads the data from the specified XML document into the DOM.
     * @param xmlDoc {Document} the XML document to load
     */
    #loadDataDoc(xmlDoc) {
        // check the root element name for special behavior
        const rootElement = xmlDoc.documentElement;

        if (rootElement.firstElementChild === null) return; // empty document

        const childType = rootElement.firstElementChild.nodeName;
        const keyName = Dw2Dom.#getPrimaryKeyElementName(childType);

        const bodyType = rootElement.nodeName;
        switch (bodyType) {
            case 'EmpireMessage': {
                // message logs are not supposed to be loaded into the DOM
                debugger;
                return;
            }
        }

        // check if element is already in the root
        const existingBody = this.#getBodyElement(bodyType);
        if (!existingBody) {
            const newBody = this.document.documentElement.appendChild(rootElement);
            this.#bodyToChildTypeMap.set(bodyType, childType);
            this.#childToBodyTypeMap.set(childType, bodyType);

            // build the key index
            this.#buildKeyIndex(newBody);
            return;
        }

        // structure of the dom kind of is like this for this description:
        // <root> > <body> > <child>
        // the root element is the xml document element, literally of the tag name "root"
        // there are multiple body elements, these come from the MS XmlSerializer, so they will be names like
        // "ArrayOfShipHull" and their children will be "ShipHull"

        // merge the child elements; if the child element has a key, try to replace the existing element
        // otherwise, append the child element to the existing body element
        for (const childElement of rootElement.children) {
            // first assert that a key element exists
            const childType = childElement.nodeName;
            //const key = childElement.querySelector(`:scope>${keyName}`)?.textContent?.trim();
            const keyChild = childElement.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === keyName);
            const key = keyChild?.textContent?.trim();
            if (!key) {
                window.error(`Element missing key (${childType}: ${keyName})`, childElement);
                continue;
            }

            const existingChild = existingBody.keyIndex.get(key);
            if (existingChild) existingBody.replaceChild(childElement, existingChild); else existingBody.appendChild(childElement);
        }

        this.#buildKeyIndex(existingBody);
    }

    #buildKeyIndex(body, sw) {
        const childElementName = this.#bodyToChildTypeMap.get(body.nodeName) || body.firstElementChild?.nodeName;
        const keyName = Dw2Dom.#getPrimaryKeyElementName(childElementName);
        const keyIndex = body.keyIndex = new Map();
        for (const childElement of body.children) {
            //const key = childElement.querySelector(`:scope>${keyName}`)?.textContent?.trim();
            const keyChild = childElement.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === keyName);
            const key = keyChild?.textContent?.trim();
            if (key) keyIndex.set(key, childElement);
            else window.warn(`Element missing key (${childElement.nodeType}: ${keyName})`, childElement);
        }
    }

    /**
     * Loads the policy data from the specified XML document into the DOM.
     * @param xmlDoc {Document} the XML document to load
     * @param raceName {string} the
     */
    #loadPolicyDoc(xmlDoc, raceName) {
        // EmpirePolicy is the root element for these, their key is the file name (the race name)
        const rootElement = xmlDoc.documentElement;
        //const empirePolicies = this.document.documentElement.querySelector(`:root>EmpirePolicies`)
        const empirePolicies = this.#getBodyElement('EmpirePolicies')
            || this.document.documentElement.appendChild(this.document.createElement('EmpirePolicies'));
        //const existingPolicy = empirePolicies.querySelector(`:root>${raceName}>EmpirePolicy`);
        const existingPolicy = empirePolicies.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === raceName)
            ?.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === 'EmpirePolicy');
        if (existingPolicy) {
            empirePolicies.replaceChild(rootElement, existingPolicy);
        } else {
            //const raceElement = empirePolicies.querySelector(`:root>${raceName}`)
            const raceElement = empirePolicies.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === raceName)
                || empirePolicies.appendChild(this.document.createElement(raceName));
            raceElement.appendChild(rootElement);
            empirePolicies.appendChild(raceElement);
        }
    }

    /**
     * Loads the game text from the specified content.
     */
    async #loadGameText() {
        const content = await fs.readFile(path.join(this.#gameDir, 'data', 'GameText.txt'), 'utf-8');
        // GameText.txt is a semicolon separated key-value file, 2 columns
        // the first column is the key, the second column is the value
        const lines = content.split('\n');
        let lineNum = 0;
        for (const line of lines) {
            lineNum++;
            // discard blank lines and lines that start with a semicolon
            if (line.length === 0 || line.startsWith(';')) continue;
            const [key, value] = line.split(';');
            if (key && value) this.gameText.set(key.trim(), value.trim());
            else window.warn(`GameText.txt:${lineNum}: ${line}`);
        }
    }

    /**
     * Loads the XML data from the game directory.
     * @returns {Promise<void>}
     */
    async #loadXmlData() {
        const sw = new Stopwatch();
        const dataDir = path.join(this.#gameDir, 'data');
        let dataXmlFiles = (await fs.readdir(dataDir)).sort();
        this.document = this.#nativeDomParser.parseFromString('<root></root>', 'application/xml');
        const xpathEval = new XPathEvaluator();
        this.document.xPathEvaluator = xpathEval;
        /** @type {XPathNSResolver} */
        const nsResolver = xpathEval.createNSResolver(document);
        this.document.nsResolver = nsResolver;

        for (const dataXmlFile of dataXmlFiles) {
            await sw.callbackAndRestartIfElapsed(15);
            if (!dataXmlFile.endsWith('.xml') || dataXmlFile.startsWith("MessageLog") || dataXmlFile.startsWith("TourItems") || dataXmlFile.startsWith("GraphicsSettings") || dataXmlFile.startsWith("MusicTracks")) continue;
            const xmlData = await fs.readFile(path.join(dataDir, dataXmlFile), 'utf-8');
            const xmlDoc = this.#nativeDomParser.parseFromString(xmlData, 'application/xml');
            //const xmlDoc = await Dw2DomWorkerManager.worker.parseXml(xmlData);
            this.#loadDataDoc(xmlDoc);
        }
    }

    /**
     * Loads the policy data from the policy subdirectories
     * @returns {Promise<void>}
     */
    async #loadPolicies() {
        const sw = new Stopwatch();
        const policyDir = path.join(this.#gameDir, 'data', 'policy');
        let policyXmlFiles = await fs.readdir(policyDir);
        for (const policyXmlFile of policyXmlFiles) {
            await sw.callbackAndRestartIfElapsed(15);
            if (!policyXmlFile.endsWith('.xml')) continue;
            const raceName = policyXmlFile.slice(0, -4);
            const xmlData = await fs.readFile(path.join(policyDir, policyXmlFile), 'utf-8');
            const xmlDoc = this.#nativeDomParser.parseFromString(xmlData, 'application/xml');
            //const xmlDoc = await Dw2DomWorkerManager.worker.parseXml(xmlData);
            this.#loadPolicyDoc(xmlDoc, raceName);
        }
    }

    /**
     * Parses the common minOccurs and maxOccurs attribute value type.
     * @param occurs {string} - the attribute value to parse
     * @returns {number} the parsed occurs value
     */
    static #parseOccurs(occurs) {
        switch (occurs) {
            case undefined:
            case null:
                return 1;

            case '0':
                return 0;
            case 'unbounded':
                return Infinity;
            default:
                return parseInt(occurs, 10);
        }
    }

    /**
     * Loads the schema data from the game directory.
     * @returns {Promise<void>}
     */
    async #loadSchema() {
        const sw = new Stopwatch();
        this.schemata.clear();
        this.schemaDocs.clear();

        // from data/schema/*.xsd
        // load the schema files into a new document
        // map in this.#schema by the body type
        const schemaDir = path.join(this.#gameDir, 'data', 'schema');
        // check if the dir exists first
        if (!fsSync.existsSync(schemaDir)) {
            // we need to inform the user to trigger a build
            // of the schema using the game executable
            window.warn(`Schema directory missing: ${schemaDir}`);
            return;
        }
        let schemaFiles = await fs.readdir(schemaDir);
        for (const schemaFile of schemaFiles) {
            if (!schemaFile.endsWith('.xsd')) continue;
            await sw.callbackAndRestartIfElapsed(15);
            window.log(`Loading schema file: ${schemaFile}`);
            let schemaData = await fs.readFile(path.join(schemaDir, schemaFile), 'utf-8');
            if (typeof schemaData === 'string')
                schemaData = schemaData.replaceAll('\uFEFF', ''); // remove floating BOM
            const schemaDoc = this.#nativeDomParser.parseFromString(schemaData, 'application/xml');
            //const schemaDoc = await Dw2DomWorkerManager.worker.parseXml(schemaData);
            let bodyType;
            try {
                const xpathEval = new XPathEvaluator();
                /** @type {XPathNSResolver} */
                const nsResolver = xpathEval.createNSResolver(schemaDoc);
                bodyType = xpathEval.evaluate('/xs:schema/xs:element/@name',
                    schemaDoc, nsResolver, XPathResult.STRING_TYPE, null)
                    .stringValue;
                schemaDoc.xPathEvaluator = xpathEval;
                schemaDoc.nsResolver = nsResolver;
            } catch {
                continue;
            }
            if (!bodyType) continue;
            schemaDoc.rootElementName = bodyType;
            this.schemaDocs.set(bodyType, schemaDoc);
        }

        // build structures that represent the schema for the purpose of auto-completion and validation
        for (const schemaDoc of this.schemaDocs.values()) {
            await sw.callbackAndRestartIfElapsed(15);
            window.log(`Building schema for: ${schemaDoc.rootElementName}`);
            const bodyType = schemaDoc.rootElementName;
            const schema = new Dw2DomSchema(bodyType, this.#domParser, this.#nativeDomParser);
            this.schemata.set(bodyType, schema);
            const xpathEval = schemaDoc.xPathEvaluator;
            const nsResolver = schemaDoc.nsResolver;
            const complexTypes = xpathEval.evaluate('/xs:schema/xs:complexType',
                schemaDoc, nsResolver, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);

            // just supporting a subset of elements that MS XmlSerializer outputs

            let complexType;
            while (complexType = complexTypes.iterateNext()) {
                await sw.callbackAndRestartIfElapsed(15);
                // handle xs:all, xs:sequence, xs:choice
                const name = complexType.getAttribute('name');
                if (!name) {
                    window.error(`Complex type missing name in schema "${bodyType}"`);
                    continue;
                }
                const contentBody = complexType.firstElementChild;
                const contentType = contentBody.nodeName;
                switch (contentType) {
                    case 'xs:all':
                    case 'xs:sequence':
                        break;
                    default:
                        window.error(`Unimplemented complex type content type "${contentType}" in schema "${bodyType}"`);
                        continue;
                }
                const elementsMap = new Map();
                const elementOrder = [];
                const elements = xpathEval.evaluate('xs:element',
                    contentBody, nsResolver, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
                let element;
                while (element = elements.iterateNext()) {
                    const name = element.getAttribute('name');
                    elementOrder.push(name);
                    elementsMap.set(name, new Dw2DomSchemaChildElement(
                        name,
                        element.getAttribute('type'),
                        Dw2Dom.#parseOccurs(element.getAttribute('minOccurs')),
                        Dw2Dom.#parseOccurs(element.getAttribute('maxOccurs')),
                        element.getAttribute('default') || null,
                        element.getAttribute('nillable') === 'true',
                        schema
                    ));
                }
                const type = new Dw2DomSchemaComplexType(
                    name,
                    contentType,
                    elementsMap,
                    elementOrder,
                    schema
                );
                if (schema.typesMap.has(name))
                    window.error(`Duplicate type "${name}" in schema "${bodyType}"`);
                schema.typesMap.set(name, type);
            }

            let simpleType;
            const simpleTypes = xpathEval.evaluate('/xs:schema/xs:simpleType',
                schemaDoc, nsResolver, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
            while (simpleType = simpleTypes.iterateNext()) {
                await sw.callbackAndRestartIfElapsed(15);
                const name = simpleType.getAttribute('name');
                if (!name) {
                    window.error(`Simple type missing name in schema "${bodyType}"`);
                    continue;
                }
                let restriction = xpathEval.evaluate('xs:restriction',
                    simpleType, nsResolver, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
                    .singleNodeValue;
                if (!restriction) {
                    // might be xs:list, basically some array of some enum type
                    // GameStartSettings>EmpireAutoGenerationState is an example of this
                    // don't care about this for now, warn instead of error
                    window.warn(`Unimplemented simple type "${name}" in schema "${bodyType}"`);
                    continue;
                }
                const base = restriction.getAttribute('base');
                if (base !== 'xs:string') {
                    window.error(`Unimplemented simple type restriction base "${base}" in schema "${bodyType}"`);
                    continue;
                }
                const enumeration = xpathEval.evaluate('xs:enumeration',
                    restriction, nsResolver, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);

                const values = new Set();
                let enumElem;
                while (enumElem = enumeration.iterateNext())
                    values.add(enumElem.getAttribute('value'));
                if (schema.typesMap.has(name))
                    window.error(`Duplicate type "${name}" in schema "${bodyType}"`);
                schema.typesMap.set(name, new Dw2DomSchemaSimpleType(
                    name,
                    base,
                    values,
                    schema
                ));
            }

            // NOTE: each of our schema only have one root element, error if there are more
            const elements = xpathEval.evaluate('/xs:schema/xs:element',
                schemaDoc, nsResolver, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
            let element;
            while (element = elements.iterateNext()) {
                await sw.callbackAndRestartIfElapsed(15);
                const name = element.getAttribute('name');
                if (!name) {
                    window.error(`Element missing name in schema "${bodyType}"`);
                    continue;
                }
                if (schema.elementMap.has(name))
                    window.error(`Duplicate element "${name}" in schema "${bodyType}"`);
                const type = element.getAttribute('type');
                schema.elementMap.set(name, new Dw2DomSchemaElement(
                    name,
                    type,
                    element.getAttribute('default') || null,
                    element.getAttribute('nillable') === 'true',
                    schema
                ));
                if (schema.elementMap.size > 1)
                    window.error(`Schema "${bodyType}" has more than one root element`);
                if (schema.rootElementName !== type)
                    window.error(`Schema "${bodyType}" root element type "${type}" does not match expected schema root type "${schema.rootElementName}"`);
            }
        }
    }

    /**
     * Loads the game data from the specified game directory.
     * @param {string?} gameDir - the game directory to load
     */
    async load(gameDir) {
        this.#gameDir = gameDir || dw2ide.GetUserChosenGameDirectory();
        await Promise.all([
            this.#loadXmlData(),
            this.#loadGameText(),
            this.#loadPolicies(),
            this.#loadSchema(),
            this.#loadCommonBundleContext()
        ]);
        return this;
    }

    /**
     * Returns the text value of the specified game text key.
     * @param {string} key - the game text key
     * @returns {string} the game text value
     */
    getGameText(key) {
        return this.gameText.get(key);
    }

    getEmpirePolicy(raceName) {
        //return this.document.querySelector(`:root>EmpirePolicies>${raceName}>EmpirePolicy`);
        return this.document.documentElement
            ?.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === 'EmpirePolicies')
            ?.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === raceName)
            ?.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === 'EmpirePolicy');
    }

    getEmpirePolicies() {
        //return this.document.querySelector(`:root>EmpirePolicies`);
        return this.document.documentElement
            ?.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === 'EmpirePolicies');
    }

    #getBody(type) {
        const bodyType = this.#childToBodyTypeMap.get(type);
        if (!bodyType) return null;
        //return this.document.querySelector(`:root>${bodyType}`);
        return this.document.documentElement
            ?.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === bodyType);
    }

    #getElementChildOfType(element, type) {
        //return element.querySelector(type);
        return element.childNodes
            .find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === type);
    }

    /**
     * Returns the element with the specified type and key.
     * @param type {string}
     * @param key {string}
     * @returns {Proxy<Element>|null} the element with the specified type and key
     */
    get(type, key) {
        const body = this.#getBody(type);
        if (!body) return null;
        const keyStr = typeof key === 'string' ? key : `${key}`;
        const elem = body.keyIndex.get(keyStr);
        return createDw2XmlElementProxy(elem);
    }

    set(type, key, element) {
        const body = this.#getBody(type);
        if (!body) return;
        const keyStr = typeof key === 'string' ? key : `${key}`;
        const existing = body.keyIndex.get(keyStr);
        if (existing) body.replaceChild(element, existing);
        else body.appendChild(element);
    }

    delete(type, key) {
        const body = this.#getBody(type);
        if (!body) return;
        const keyStr = typeof key === 'string' ? key : `${key}`;
        const existing = body.keyIndex.get(keyStr);
        if (existing) body.removeChild(existing);
    }


    // for CompletionItemProvider interface
    #triggerCharacters = Object.freeze([
        '<', // tags
        '=', // attributes
        '</', // closing tags
        '>' // content
    ]);
    /**
     * Provide completion items for the given position and document.
     *
     * @implements {import('monaco-editor').languages.CompletionItemProvider.triggerCharacters}
     * @type {string[]}
     */
    get triggerCharacters() {
        return this.#triggerCharacters;
    }

    #getDom(model) {
        // we need to check if the model has a DOM attached first
        if (!('dom' in model)) {
            this.attach(model);
        }
        if (!model['domInSync']) {
            return new Promise((resolve, reject) => {
                if (!model['onDomSync']) model['onDomSync'] = [];
                model['onDomSync'].push(async () => {
                    try {
                        resolve(model['dom']);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        }
        return model['dom'];
    }

    /**
     * @param dom {Document}
     * @param offset {number}
     * @returns {Promise<Node[]>}
     */
    async #resolveNodePath(dom, offset) {
        // find the mode in the dom that the offset is in
        let node = dom.documentElement;

        const nodePath = [];

        // with ImmuDom we have a linear node collection on the document
        for (let i = 0; i < dom.nodes.length; ++i) {
            const n = dom.nodes[i];
            if (n.startOffset > offset)
                break;

            if (n.endOffset >= offset)
                nodePath.push(n);

            // otherwise not within the node
        }
        return nodePath;
    }

    /**
     *
     * @param schema
     * @param nodePath
     * @param offset
     * @returns {{schemaElemPath: *[], incomplete: string, nodePathDepth: number, schemaTypePath: *[]}}
     */
    #getSchemaCompletionContext(schema, nodePath, offset) {
        const context = {
            /** @type {Dw2DomSchemaElement[]} */
            schemaElemPath: [],
            /** @type {Dw2DomSchemaType[]} */
            schemaTypePath: [],
            nodePathDepth: 0,
            incomplete: ''
        };
        let schemaElem = schema.elementMap.get(nodePath[0].tagName);
        if (schemaElem === undefined)
            return context;
        context.schemaElemPath.push(schemaElem);
        let schemaType = schemaElem.type;
        context.schemaTypePath.push(schemaType);
        for (let i = 1; i < nodePath.length; i++) {
            context.nodePathDepth = i;
            const node = nodePath[i];
            if (node.nodeType === Node.ELEMENT_NODE) {
                const nextPathElement = node.tagName;
                const nextPathCursor = schemaType;
                if (nextPathCursor instanceof Dw2DomSchemaComplexType) {
                    schemaElem = nextPathCursor.elementMap.get(nextPathElement);
                    if (schemaElem){
                        context.schemaElemPath.push(schemaElem);
                        schemaType = schemaElem.type;
                        context.schemaTypePath.push(schemaType);
                    } else {
                        //console.warn("Can't find schema element for ", nextPathElement);
                        context.incomplete = nextPathElement;
                        break;
                    }
                } else {
                    // simple type, leaf
                    const limit = offset - node.startOffset;
                    context.incomplete = node.textContent.slice(0, limit);
                    break;
                }
            } else {
                // look for any signs of '<' (not followed by '/' or '>')
                const text = node.textContent;
                const ltIndex = text.lastIndexOf('<');
                if (ltIndex > 0) {
                    if (text[ltIndex + 1] === '/' || text[ltIndex + 1] === '>') {
                        // skip it from the context
                        break;
                    } else {
                        const limit = offset - node.startOffset;
                        const tagNameAndAttrs = text.slice(ltIndex, limit);
                        const attrsStart = tagNameAndAttrs.indexOf(' ');
                        const tagName = attrsStart === -1 ? tagNameAndAttrs : tagNameAndAttrs.slice(0, attrsStart);
                        schemaElem = schema.elementMap.get(tagName);
                        if (schemaElem === undefined) {
                            // we are in an unknown element, stop here
                            context.incomplete = tagName;
                            break;
                        }
                        context.schemaElemPath.push(schemaElem);
                        schemaType = schemaElem.type;
                        context.schemaTypePath.push(schemaType);
                        break; // counts as a leaf; xml-dom would have
                    }
                }
            }
        }
        return context;
    }

    /**
     * Resolves the schema given the DOM and the URI.
     *
     * @param dom {Document}
     * @param uri {import('monaco-editor').Uri}
     */
    #resolveSchema(dom, uri) {
        if (typeof uri === 'string') {
            uri = uri.startsWith('file:///')
                ? window.monaco.Uri.file(uri.substring(7))
                : window.monaco.Uri.parse(uri, true);
        }
        const fileNameStarts = uri.path.lastIndexOf('\\') + 1;
        const fileName = uri.path.slice(fileNameStarts);
        if (fileName.endsWith('.xml')) {
            const fileNameWithoutExt = fileName.slice(0, -4);
            const underscoreIndex = fileNameWithoutExt.indexOf('_');
            if (underscoreIndex === -1) {
                const schemaName = this.#filePrefixToSchemaName.get(fileNameWithoutExt);
                if (schemaName) {
                    return this.schemata.get(schemaName);
                }
            } else {
                const schemaName = this.#filePrefixToSchemaName.get(fileNameWithoutExt.slice(0, underscoreIndex));
                if (schemaName) {
                    return this.schemata.get(schemaName);
                }
            }
        } else {
            // check dom root element name
            const root = dom.documentElement;
            if (root) {
                const schema = this.schemata.get(root.tagName);
                if (schema)
                    return schema;
            }
        }

        return null;
    }

    /**
     * @param elem {Element}
     * @param predicate {function}
     * @returns {Element|null}
     */
    static #findChildElem(elem, predicate) {
        for (const child of elem.childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                try {
                    if (predicate(child))
                        return child;
                } catch (e) {
                    window.error("error in predicate: ", e);
                }
            }
        }
        return null;
    }

    /**
     * @param elem {Element}
     * @param name {string}
     * @returns {Element|null}
     */
    static #findChildElemNamed(elem, name) {
        for (const child of elem.childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE && child.tagName === name)
                return child;
        }
        return null;
    }

    static #classInherits(subjectClass, ancestorClass) {
        if (subjectClass === ancestorClass) return true;
        if (subjectClass === null || subjectClass === undefined) return false;
        return subjectClass.prototype instanceof ancestorClass;
    }

    static #concatIterables(...iterables) {
        return {
            * [Symbol.iterator]() {
                for (const iterable of iterables) {
                    yield* iterable;
                }
            }
        };
    }

    /**
     * @param suggestions {import('monaco-editor').languages.CompletionItem[]}
     */
    static #generateSortText(suggestions) {
        // the log 36 of length, the number of digits needed to represent the length in base 36
        const pad = Math.ceil(Math.log(suggestions.length) / LOG_36);
        for (let i = 0; i < suggestions.length; i++)
            suggestions[i].sortText = i.toString(36).padStart(pad, '0');
    }

    /**
     * Provides closing tag completion items for the specified model and position.
     *
     * Enumerates the node path for unclosed elements (looks ahead for missing closing tags).
     *
     * @param suggestions {import('monaco-editor').languages.CompletionItem[]}
     * @param model {import('monaco-editor').editor.ITextModel}
     * @param cursorRange {import('monaco-editor').Range}
     * @param nodePath {Node[]}
     */
    #addClosingTagSuggestions(suggestions, model, cursorRange, nodePath) {
        // check if previous two characters are '</'
        const startPos = cursorRange.getStartPosition();
        const prevCharsRange = window.monaco.Range.fromPositions(startPos.delta(0, -2), startPos);
        const prevChars = model.getValueInRange(prevCharsRange);
        let incomplete = '';
        if (prevChars === '</') cursorRange = prevCharsRange;
        // check if prev char is '<'
        else if (prevChars.endsWith('<'))
            cursorRange = window.monaco.Range.fromPositions(startPos.delta(0, -1), cursorRange.getEndPosition());
        else {
            // check if we're completing a closing tag
            const prevAngleBracket = model.findPreviousMatch('</', startPos, false, true, null, false);
            if (prevAngleBracket) {
                const prevAngleBracketPos = prevAngleBracket.range.getStartPosition();
                if (prevAngleBracketPos.isBeforeOrEqual(startPos)) {
                    // check what text is between the cursor and the previous angle bracket
                    const prevClosingTagRange = window.monaco.Range.fromPositions(prevAngleBracketPos, startPos);
                    const prevClosingTag = model.getValueInRange(prevClosingTagRange);
                    if (prevClosingTag.includes('>')) {
                        // the tag is already closed
                    } else if (prevClosingTag.includes(' ') || prevClosingTag.includes('\n')) {
                        // the tag is complete enough that we shouldn't suggest a closing tag
                        return;
                    } else {
                        // the closing tag is well-formed but incomplete
                        incomplete = prevClosingTag.slice(2);
                    }
                }
            }
        }
        // if next character is '>', expand the range to include it
        const nextCharPos = cursorRange.getEndPosition().delta(0, 1);
        const nextCharRange = window.monaco.Range.fromPositions(nextCharPos.delta(0, -1), nextCharPos);
        const nextChar = model.getValueInRange(nextCharRange);
        if (nextChar === '>') cursorRange = window.monaco.Range.fromPositions(cursorRange.getStartPosition(), nextCharPos);

        // walk back the node path and add closing tag suggestions
        for (let i = nodePath.length - 1; i >= 0; i--) {
            const node = nodePath[i];
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const tagName = node.tagName;
            if (!tagName.startsWith(incomplete)) continue;
            // look ahead for the closing tag in the model
            const nextTag = model.findNextMatch(`</${tagName}`, startPos, false, true, null, false);
            if (nextTag) {
                const nextTagPos = nextTag.range.getStartPosition();
                if (nextTagPos.isBeforeOrEqual(startPos)) {
                    // closing tag is before the cursor, suggest it
                    suggestions.push({
                        label: `</${tagName}>`,
                        kind: window.monaco.languages.CompletionItemKind.Issue,
                        insertText: `</${tagName}>`,
                        range: cursorRange,
                    });
                }
            } else {
                // no closing tag found, suggest it
                suggestions.push({
                    label: `</${tagName}>`,
                    kind: window.monaco.languages.CompletionItemKind.Issue,
                    insertText: `</${tagName}>`,
                    range: cursorRange,
                });
            }
        }
    }

    /**
     * Provides completion items for the specified model and position.
     *
     * @implements {import('monaco-editor').languages.CompletionItemProvider.provideCompletionItems}
     * @param model {import('monaco-editor').editor.IModel}
     * @param position {import('monaco-editor').Position}
     * @param context {import('monaco-editor').languages.CompletionContext}
     * @param token {import('monaco-editor').CancellationToken}
     * @returns {import('monaco-editor').languages.ProviderResult<import('monaco-editor').languages.CompletionList>}
     */
    async provideCompletionItems(model, position, context, token) {
        const cursorRange = window.monaco.Range.fromPositions(position, position);

        /** @type {Document} */
        const dom = await this.#getDom(model);
        const offset = model.getOffsetAt(position);

        const root = dom.documentElement;
        const schema = this.#resolveSchema(dom, model.uri);

        // if no root, provide root element completion for all known schemas
        if (!root) {
            // empty document, check preceding character for '<'
            const prevCharPos = position.delta(0, -1);
            const prevCharsRange = window.monaco.Range.fromPositions(0, position);
            const prevChars = model.getValueInRange(prevCharsRange);
            const prevLtIndex = prevChars.lastIndexOf('<');
            const prevGtIndex = prevChars.lastIndexOf('>', prevLtIndex);
            if (prevLtIndex !== -1 && prevGtIndex === -1) {
                // provide root element completion; check document file name prefix for schema
                const incomplete = prevChars.slice(prevLtIndex + 1);
                if (!schema) {
                    // provide all schema root elements
                    /** @type {import('monaco-editor').languages.CompletionItem[]} */
                    const suggestions = [];
                    for (const schema of this.schemata.values()) {
                        const rootElement = schema.rootElementName;
                        if (rootElement.startsWith(incomplete)) {
                            suggestions.push({
                                label: rootElement,
                                kind: window.monaco.languages.CompletionItemKind.Module,
                                insertText: rootElement.slice(incomplete.length),
                                range: cursorRange
                            });
                        }
                    }
                    return {suggestions};
                } else {
                    // provide schema root element completion
                    const rootElement = schema.rootElementName;
                    if (rootElement.startsWith(incomplete)) {
                        return {
                            suggestions: [{
                                label: rootElement,
                                kind: window.monaco.languages.CompletionItemKind.Module,
                                insertText: rootElement.slice(incomplete.length),
                                range: cursorRange
                            }]
                        };
                    } else {
                        return {suggestions: []};
                    }

                }
            }
        }

        if (!schema) return {suggestions: []};

        const nodePath = await this.#resolveNodePath(dom, offset);

        const completionContext = this.#getSchemaCompletionContext(schema, nodePath, offset);

        // provide completion items for the schema element
        /** @type {Dw2DomSchemaElement} */
        const schemaElem = completionContext.schemaElemPath[completionContext.schemaElemPath.length - 1];
        /** @type {Dw2DomSchemaType} */
        const schemaType = completionContext.schemaTypePath[completionContext.schemaTypePath.length - 1];
        if (schemaType instanceof Dw2DomSchemaComplexType) {
            const suggestions = [];
            const node = nodePath[completionContext.nodePathDepth];
            const incomplete = completionContext.incomplete;
            for (const [name, elem] of schemaType.elementMap) {
                if (!name.startsWith(incomplete)) continue;
                // check for occurrences in the node
                let existing = 0;
                if (node.parentElement)
                    for (const child of node.parentElement.childNodes) {
                        if (child.nodeType === Node.ELEMENT_NODE && child.tagName === name)
                            existing++;
                    }
                if (existing >= elem.maxOccurs) continue;
                suggestions.push({
                    label: name,
                    kind: window.monaco.languages.CompletionItemKind.Field,
                    insertText: name.slice(incomplete.length),
                    range: cursorRange
                });
            }
            this.#addClosingTagSuggestions(suggestions, model, cursorRange, nodePath);
            return {suggestions};
        } else if (schemaType instanceof Dw2DomSchemaSimpleType) {
            switch (schemaType.type) {
                case 'xs:string': {
                    if (schemaType.values.size > 0) {
                        const incomplete = completionContext.incomplete;
                        const suggestions = [];
                        for (const value of schemaType.values) {
                            if (value.startsWith(incomplete)) {
                                suggestions.push({
                                    label: value,
                                    kind: window.monaco.languages.CompletionItemKind.EnumMember,
                                    insertText: value.slice(incomplete.length),
                                    range: cursorRange
                                });
                            }
                        }
                        return {suggestions};
                    }
                    return;
                }
            }
            return {suggestions: []};
        } else if (Dw2Dom.#classInherits(schemaType, Dw2DomNumberType)) {
            if (completionContext.nodePathDepth === 2 && schemaElem.name.endsWith('Id')) {
                const parentElem = completionContext.schemaElemPath[1];
                /** @type {{suggestions:import('monaco-editor').languages.CompletionItem[]}} */
                const results = {suggestions: []};
                if (Dw2Dom.#getPrimaryKeyElementName(parentElem.name) === schemaElem.name) {
                    const bodyElemName = root.tagName;
                    const bodyElem = this.#getBodyElement(bodyElemName);
                    let id = 0;
                    for (const child of Dw2Dom.#concatIterables(bodyElem.children, root.children)) {
                        const idNode = Dw2Dom.#findChildElemNamed(child, schemaElem.name);
                        if (!idNode) continue;
                        const idStr = idNode.textContent.trim();
                        const val = parseInt(idStr, 10);
                        if (val >= id) id = val + 1;
                        if (idStr.startsWith(completionContext.incomplete) && val) {
                            let nameNode = Dw2Dom.#findChildElemNamed(child, 'DisplayName')
                                || Dw2Dom.#findChildElemNamed(child, 'Name')
                                || Dw2Dom.#findChildElemNamed(child, 'Title')
                                || Dw2Dom.#findChildElemNamed(child, child.tagName + 'Name');
                            if (!nameNode) { // fallback to any comment inside the element (not in child elements)
                                for (const node of child.childNodes)
                                    if (node.nodeType === Node.COMMENT_NODE) {
                                        nameNode = node;
                                        break;
                                    }
                            }
                            let elemDesc = nameNode ? nameNode.textContent.trim() : '';
                            if (elemDesc.length > 64) elemDesc = elemDesc.slice(0, 61) + '...';
                            results.suggestions.push({
                                label: `${idStr} ${elemDesc}`,
                                kind: window.monaco.languages.CompletionItemKind.EnumMember,
                                insertText: idStr.slice(completionContext.incomplete.length),
                                range: cursorRange
                            });
                        }
                    }

                    id = Dw2Dom.#idCompletionHardCodedStuff(id, bodyElemName, results);

                    results.suggestions.unshift({
                        label: id.toString(),
                        detail: '(Next available)',
                        kind: window.monaco.languages.CompletionItemKind.EnumMember,
                        insertText: id.toString(),
                        range: cursorRange
                    });
                    Dw2Dom.#generateSortText(results.suggestions);
                    return results;
                }
            }
        }


    }

    static #idCompletionHardCodedStuff(id, bodyElemName, results) {
        if (bodyElemName === 'ArrayOfRace') {
            if (id >= 250 && id <= 255)
                id = 256;
            results.suggestions.push(
                /** @type {import('monaco-editor').languages.CompletionItem}*/
                {
                    label: '247 All Races (reserved)',
                    kind: window.monaco.languages.CompletionItemKind.Issue,
                    detail: 'All Races (reserved)',
                    insertText: ''
                },
                /** @type {import('monaco-editor').languages.CompletionItem}*/
                {
                    label: '248 Planet Destroyer (reserved)',
                    kind: window.monaco.languages.CompletionItemKind.Issue,
                    detail: 'Planet Destroyer (reserved)',
                    insertText: ''
                },
                /** @type {import('monaco-editor').languages.CompletionItem}*/
                {
                    label: '249 Hive (reserved)',
                    kind: window.monaco.languages.CompletionItemKind.Issue,
                    detail: 'Hive (reserved)',
                    insertText: ''
                },
                /** @type {import('monaco-editor').languages.CompletionItem}*/
                {
                    label: '250 Independent (reserved)',
                    kind: window.monaco.languages.CompletionItemKind.Issue,
                    detail: 'Independent (reserved)',
                    insertText: ''
                },
                /** @type {import('monaco-editor').languages.CompletionItem}*/
                {
                    label: '251 Abandoned (reserved)',
                    kind: window.monaco.languages.CompletionItemKind.Issue,
                    detail: 'Abandoned (reserved)',
                    insertText: ''
                },
                /** @type {import('monaco-editor').languages.CompletionItem}*/
                {
                    label: '252 Pirates 1 (reserved)',
                    kind: window.monaco.languages.CompletionItemKind.Issue,
                    detail: 'Pirates 1 (reserved)',
                    insertText: ''
                },
                /** @type {import('monaco-editor').languages.CompletionItem}*/
                {
                    label: '253 Pirates 2 (reserved)',
                    kind: window.monaco.languages.CompletionItemKind.Issue,
                    detail: 'Pirates 2 (reserved)',
                    insertText: ''
                },
                /** @type {import('monaco-editor').languages.CompletionItem}*/
                {
                    label: '254 Pirates 3 (reserved)',
                    kind: window.monaco.languages.CompletionItemKind.Issue,
                    detail: 'Pirates 3 (reserved)',
                    insertText: ''
                },
                /** @type {import('monaco-editor').languages.CompletionItem}*/
                {
                    label: '255 Pirates 4 (reserved)',
                    kind: window.monaco.languages.CompletionItemKind.Issue,
                    detail: 'Pirates 4 (reserved)',
                    insertText: ''
                }
            );
        }
        return id;
    }

    /**
     * Given a completion item fill in more data, like
     * {@link import('monaco-editor').languages.CompletionItem.documentation doc-comment}
     * or {@link import('monaco-editor').languages.CompletionItem.detail details}.
     *
     * The editor will only resolve a completion item once.
     * @implements {import('monaco-editor').languages.CompletionItemProvider.resolveCompletionItem}
     * @param {import('monaco-editor').languages.CompletionItem} item
     * @param {import('monaco-editor').CancellationToken} token
     * @returns {ProviderResult<CompletionItem>}
     */
    async resolveCompletionItem(item, token) {
        return item;
    }

    /**
     * The bundle name to bundle handle map.
     *
     * @type {Map<string, {bundle:BundleHandle, isoCtx:DW2IDERuntimeBindings, path:string}>}
     */
    #loadedBundles = new Map();

    async #promptForBundlePath(bundleName) {
        const haveDialog = 'dialog' in window;
        const haveFs = 'fs' in window;

        let bundlePath;
        for (; ;) {
            if (haveDialog) {
                const dialogResult = await dialog.showOpenDialog({
                    title: `Select ${bundleName} Bundle File`,
                    message: `Please select the bundle file for the bundle named "${bundleName}".`,
                    buttonLabel: 'Select',
                    filters: [{name: 'Bundle Files', extensions: ['bundle']}],
                });
                if (dialogResult.canceled) {
                    // assume the user cancelled
                    return null;
                }
                bundlePath = dialogResult.filePaths[0];
            } else {
                bundlePath = window.prompt('Please provide the path to the bundle file for the bundle named "' + bundleName + '".');
            }

            // assume empty selection means the user cancelled
            if (!bundlePath)
                return null;

            // validate the name
            if (!bundlePath.endsWith(bundleName + '.bundle')) {
                if (haveDialog) {
                    const dialogResult = await dialog.showMessageBox({
                        title: 'Invalid Bundle Path',
                        message: 'The provided path does not end with the bundle name "' + bundleName + '.bundle".',
                        type: 'error',
                        buttons: ['Try Again', 'Cancel'],
                        defaultId: 0,
                        cancelId: 1
                    });
                    if (dialogResult.response === 1)
                        return null;
                } else {
                    const tryAgain = window.confirm('The provided path does not end with the bundle name "' + bundleName + '.bundle".\nTry again?');
                    if (!tryAgain)
                        return null;
                }
                continue;
            }

            const lastSlash = bundlePath.lastIndexOf('/');
            const nameFromPath = bundlePath.slice(lastSlash + 1);
            if (nameFromPath.startsWith(bundleName) && bundlePath[nameFromPath.length] === '.') {
                // bundle names can be 'Something.bundle' or 'Something.GuidGoesHere.bundle'
                // cut out the middle part, those are content bundles, we want the descriptor bundle
                if (nameFromPath.length > bundleName.length + 7) {
                    bundlePath = bundlePath.slice(0, lastSlash + 1 + bundleName.length) + '.bundle';
                }

                // verify exists, if we can
                if (haveFs) {
                    try {
                        await fs.access(bundlePath);
                    } catch (e) {
                        if (haveDialog) {
                            const dialogResult = await dialog.showMessageBox({
                                title: 'Bundle File Not Found',
                                message: `"${bundlePath}" is missing or can't be accessed.`,
                                type: 'error',
                                buttons: ['Try Again', 'Cancel'],
                                defaultId: 0,
                                cancelId: 1
                            });
                            if (dialogResult.response === 1)
                                return null;
                        } else {
                            const tryAgain = window.confirm(`"${bundlePath}" is missing or can't be accessed.\nTry again?`);
                            if (!tryAgain)
                                return null;
                        }
                        continue;
                    }
                }
                // success
                break;
            }
        }
    }

    /**
     * Resolves the path to the bundle file for the specified bundle name.
     *
     * @param bundleName {string}
     * @return {Promise<string>}
     */
    async #resolveBundlePath(bundleName) {
        // check data/db/bundles directory first
        const haveFs = 'fs' in window;
        if (!haveFs) throw Error('File system access is required to resolve bundle paths.');

        const bundlePath = path.join(this.#gameDir, `data`, `db`, `bundles`, `${bundleName}.bundle`);

        const existing = this.#loadedBundles.get(bundleName);
        if (existing && existing.path === bundlePath) return bundlePath;

        if (haveFs) {
            try {
                await fs.access(bundlePath);
            } catch (e) {
                // prompt for the path
                const resolved = await this.#promptForBundlePath(bundleName);
                if (!resolved) return null;
                return resolved;
            }
        } else {
            // just prompt for the path
            const resolved = await this.#promptForBundlePath(bundleName);
            if (!resolved) return null;
            return resolved;
        }

        const isoCtx = dw2ide.NewIsolationContext();
        const bundle = isoCtx.LoadBundle(bundlePath);
        this.#loadedBundles.set(bundleName, {path: bundlePath, bundle, isoCtx});
        return bundlePath;
    }

    /**
     * A cache for resolved image previews.
     *
     * Key is formatted: `${bundleName}:${objPath}`
     *
     * @type {Map<string, {
     * src:string,
     * bundleName:string,
     * objPath:string,
     * objId:Uint8Array,
     * previewWidth:number,
     * previewHeight:number
     * }|null>}
     */
    #imagePreviewCache = new Map();

    #commonBundleIsoCtx;

    async #loadCommonBundleContext() {
        if (this.#commonBundleIsoCtx !== undefined)
            return;
        const haveFs = 'fs' in window;
        if (!haveFs) throw Error('File system access is required to load bundles.');
        const bundleDir = path.join(this.#gameDir, `data`, `db`, `bundles`);
        const bundleFiles = await fs.readdir(bundleDir);
        const isoCtx = dw2ide.NewIsolationContext();
        for (const bundleFile of bundleFiles) {
            if (!bundleFile.endsWith('.bundle')) continue;
            const bundlePath = path.join(bundleDir, bundleFile);
            const bundleName = bundleFile.slice(0, -7);
            // check for guid in the middle
            const lastDot = bundleName.lastIndexOf('.');
            if (lastDot !== -1)
                continue;
            const bundle = isoCtx.LoadBundle(bundlePath);
            this.#loadedBundles.set(bundleName, {path: bundlePath, bundle, isoCtx});
        }
        this.#commonBundleIsoCtx = isoCtx;
    }
    async #createImagePreview(bundleName, objPath) {
        console.log(`Creating image preview...`);

        /** @type {DW2IDERuntimeBindings} */
        let isoCtx;
        if (!bundleName) {
            isoCtx = this.#commonBundleIsoCtx;
        } else {
            let bundleInfo = this.#loadedBundles.get(bundleName);

            if (!bundleInfo) {
                const bundlePath = this.#resolveBundlePath(bundleName);
                bundleInfo = this.#loadedBundles.get(bundleName);
            }

            isoCtx = bundleInfo.isoCtx;
        }

        const objId = new Uint8Array(16);
        if (!isoCtx.TryGetObjectId(objPath, objId)) {
            this.#imagePreviewCache.set(`${bundleName}:${objPath}`, null);
            return null;
        }

        console.log(`Loading object from bundle...`);
        const handle = isoCtx.InstantiateBundleItem(objPath);

        console.log(`Checking if object is an image...`);
        if (!isoCtx.IsImage(handle)) {
            isoCtx.ReleaseHandle(handle);
            this.#imagePreviewCache.set(`${bundleName}:${objPath}`, null);
            return null;
        }

        console.log(`Calculating preview image size...`);
        const dims = isoCtx.GetImageDimensions(handle);
        if (dims !== 2) {
            // not a 2D image
            isoCtx.ReleaseHandle(handle);
            this.#imagePreviewCache.set(`${bundleName}:${objPath}`, null);
            return null;
        }
        const mipLevels = isoCtx.GetImageMipLevels(handle);
        let targetMip = 0;
        // target width should be relative to the size of the window
        const targetLength = (Math.max(window.innerWidth, window.innerHeight) / 2)
            / window.devicePixelRatio;
        let previewWidth = 0;
        let previewHeight = 0;
        let lastDist = Infinity;
        for (let mipLevel = 0; mipLevel < mipLevels; ++mipLevel) {
            // check width and height separately as the calls aren't instant
            const width = isoCtx.GetImageWidth(handle, mipLevel);
            if (width === undefined) {
                //window.error(`Failed to get width of '${path}' mip level ${mipLevel}.`);
                continue;
            }
            const height = isoCtx.GetImageHeight(handle, mipLevel);
            if (height === undefined) {
                //window.error(`Failed to get height of '${path}' mip level ${mipLevel}.`);
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
        console.log(`Converting to WebP...`);
        if (!isoCtx.TryConvertImageToStreamWebp(handle, targetMip, function (buffer) {
            imgBuffers.push(buffer);
        })) {
            //window.error(`Failed to convert '${path}' to webp.`);
            this.#imagePreviewCache.set(`${bundleName}:${objPath}`, null);
            return null;
        }
        console.log(`Creating blob from ${imgBuffers.length} buffers...`);
        //const blob = new Blob(imgBuffers, {type: 'image/webp'});
        //const src = await registerBlob(blob);
        /*const svg = `data:image/svg+xml;utf8,`
            + (
                `<svg xmlns="http://www.w3.org/2000/svg" width="${previewWidth}" height="${previewHeight}">`
                + `<image href="${src}" width="${previewWidth}" height="${previewHeight}"/>`
                + `</svg>`
            ).replace(/[^0-9A-Za-z_=\/(),.]/g, m => `%${m.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
        */
        /*const src = await new Promise((resolve,reject) => {
            try {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(blob);
            } catch (e) {
                reject(e);
            }
        });*/
        /* FFS; this works fine but can't load in the hover frame
        const src = URL.createObjectURL(blob);
        const image = new Image();
        image.src = src;
        */
        const src = `data:image/webp;base64,${Buffer.concat(imgBuffers).toString('base64')}`;
        const result = {
            src,
            objId,
            bundleName,
            objPath,
            previewWidth,
            previewHeight
        };
        this.#imagePreviewCache.set(`${bundleName}:${objPath}`, result);
        return result;
    }

    /**
     * Provide a hover for the given position and document. Multiple hovers at the same
     * position will be merged by the editor. A hover can have a range which defaults
     * to the word range at the position when omitted.
     *
     * @implements {import('monaco-editor').languages.HoverProvider.provideHover}
     * @param {import('monaco-editor').editor.ITextModel} model
     * @param {import('monaco-editor').Position} position
     * @param {import('monaco-editor').CancellationToken} token
     * @returns {ProviderResult<Hover>}
     */
    async provideHover(model, position, token) {
        // provide hovers for foreign keys and bundle paths

        const dom = await this.#getDom(model);

        const root = dom.documentElement;

        if (!root) return {contents: []};

        const schema = this.#resolveSchema(dom, model.uri);

        if (!schema) return {contents: []};

        const offset = model.getOffsetAt(position);

        const nodePath = await this.#resolveNodePath(dom, offset);

        const completionContext = this.#getSchemaCompletionContext(schema, nodePath, offset);

        const schemaElem = completionContext.schemaElemPath[completionContext.schemaElemPath.length - 1];
        const schemaType = completionContext.schemaTypePath[completionContext.schemaTypePath.length - 1];

        if (schemaType instanceof Dw2DomSchemaComplexType) {
            const node = nodePath[nodePath.length - 1];
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName.endsWith('Color')) {
                    const range = window.monaco.Range.fromPositions(
                        model.getPositionAt(node.startOffset),
                        model.getPositionAt(node.endOffset)
                    );
                    let r, g, b, a;
                    for (const child of node.childNodes) {
                        switch (child.tagName) {
                            case 'R':
                                r = parseFloat(child.textContent);
                                if (typeof r !== 'number' || !isFinite(r)) r = 0;
                                break;
                            case 'G':
                                g = parseFloat(child.textContent);
                                if (typeof g !== 'number' || !isFinite(g)) g = 0;
                                break;
                            case 'B':
                                b = parseFloat(child.textContent);
                                if (typeof b !== 'number' || !isFinite(b)) b = 0;
                                break;
                            case 'A':
                                a = parseFloat(child.textContent);
                                if (typeof a !== 'number' || !isFinite(a)) a = 255;
                                break;

                        }
                    }
                    const rPct = (r / 255) * 100;
                    const gPct = (g / 255) * 100;
                    const bPct = (b / 255) * 100;
                    const aPct = (a / 255) * 100;
                    // a small square of the color without transparency that will be in a data uri
                    const svg = `data:image/svg+xml;utf8,`
                        + (
                            `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="16">`
                            + `<defs>`
                            + `<linearGradient id="g">`
                            + `<stop offset="0%" stop-color="black"/>`
                            + `<stop offset="100%" stop-color="white"/>`
                            + `</linearGradient>`
                            + `</defs>`
                            + `<rect x="0" y="2" width="10" height="12" fill="rgb(${r},${g},${b})"/>`
                            + `<rect x="16" y="0" width="48" height="16" fill="url(#g)"/>`
                            + `<rect x="16" y="2" width="48" height="12" fill="rgb(${r},${g},${b})" fill-opacity="${aPct}%"/>`
                            + `</svg>`
                        ).replace(/[^0-9A-Za-z_=\/(),.]/g, m => `%${m.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

                    return {
                        range,
                        contents: [
                            {
                                value:
                                    `![Color Preview](${svg}) / `
                                    + `R: ${rPct.toFixed(2)}% / `
                                    + `G: ${gPct.toFixed(2)}% / `
                                    + `B: ${bPct.toFixed(2)}% / `
                                    + `A: ${aPct.toFixed(2)}%`,
                                supportHtml: true,
                                isTrusted: true
                            }
                        ]
                    };
                }
            }
            return {contents: []};
        } else if (schemaType instanceof Dw2DomSchemaSimpleType) {
            return {contents: []};
        } else if (Dw2Dom.#classInherits(schemaType, Dw2DomNumberType)) {
            // check if foreign key
            return {contents: []};
        } else if (Dw2Dom.#classInherits(schemaType, Dw2DomString)) {
            // check if bundle path
            const node = nodePath[nodePath.length - 1];
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (completionContext.nodePathDepth === 2) {
                    const tagName = node.tagName;
                    if (tagName === 'BundleName') {
                        const bundleName = node.textContent.trim();
                        const bundlePath = await this.#resolveBundlePath(bundleName);
                        const startPos = model.getPositionAt(node.startOffset);
                        const endPos = model.getPositionAt(node.endOffset);
                        if (bundlePath) {
                            return {
                                range: window.monaco.Range.fromPositions(startPos, endPos),
                                contents: [
                                    {
                                        value: bundlePath,
                                        isTrusted: true
                                    }
                                ]
                            };
                        }
                    }
                    if (tagName.endsWith("Filename") || tagName.endsWith("Filepath")) {
                        // I think these are all bundle paths
                        // check for parent node containing BundleName
                        const objPath = node.textContent.trim();
                        let bundleName = null;
                        for (const otherNode of node.parentElement.childNodes) {
                            if (otherNode.nodeType === Node.ELEMENT_NODE && otherNode.tagName === "BundleName") {
                                bundleName = otherNode.textContent.trim();
                                break;
                            }
                        }
                        let bundlePath = null;
                        if (bundleName) {
                            bundlePath = await this.#resolveBundlePath(bundleName);
                        }

                        let preview = this.#imagePreviewCache.get(`${bundleName}:${objPath}`);
                        if (preview === undefined)
                            preview = await this.#createImagePreview(bundleName, objPath);

                        if (preview) {
                            const startPos = model.getPositionAt(node.startOffset);
                            const endPos = model.getPositionAt(node.endOffset);
                            return {
                                range: window.monaco.Range.fromPositions(startPos, endPos),
                                contents: [
                                    {
                                        value: "![Preview Image](" + preview.src + ")",
                                        isTrusted: true
                                    }
                                ]
                            };
                        } else {
                            const startPos = model.getPositionAt(node.startOffset);
                            const endPos = model.getPositionAt(node.endOffset);
                            return {
                                range: window.monaco.Range.fromPositions(startPos, endPos),
                                contents: [
                                    {
                                        value: "Unable to preview image.",
                                        isTrusted: true
                                    }
                                ]
                            };
                        }
                    } else if (schemaElem.name.endsWith("ImagePath")) {
                        if (nodePath[1].nodeName === "CharacterAnimation") {
                            // TODO: character anim paths are file system paths
                            const nodeContent = node.textContent.trim();
                            return {
                                contents: [
                                    {
                                        value: `${nodeContent}\n\nFull path:\n\nPreview:\n\n![]()`,
                                        isTrusted: true
                                    }
                                ]
                            };
                        } else {
                            // TODO: figure out if bundle or file system path
                            return {contents: []};
                        }
                    }
                }
            }
            return {contents: []};
        }

    }

    static #asyncParseXmlThresholdLength = 100;
    static asyncParseThresholdMs = 8; // ftr 60fps is 16ms

    static async parseXml(xml) {
        if (navigator.hardwareConcurrency === 1)
            return parseXml(xml);

        const sw = new Stopwatch();
        let result;
        let elapsed;
        const thresholdAtStart = Dw2Dom.#asyncParseXmlThresholdLength;
        const goAsync = xml.length > Dw2Dom.#asyncParseXmlThresholdLength;
        //const goAsync = false; // for debugging
        if (goAsync) {
            result = await Dw2DomWorkerManager.worker.parseXml(xml);
            elapsed = sw.elapsed;
            if (elapsed <= Dw2Dom.asyncParseThresholdMs) {
                if (xml.length > Dw2Dom.#asyncParseXmlThresholdLength) {
                    // creep up the threshold
                    Dw2Dom.#asyncParseXmlThresholdLength = (Dw2Dom.#asyncParseXmlThresholdLength + 2 + xml.length) / 2;
                }
            }
        } else {
            //result = new DOMParser().parseFromString(string, 'application/xml');
            result = parseXml(xml);
            elapsed = sw.elapsed;
            if (elapsed < Dw2Dom.asyncParseThresholdMs) {
                // creep down the threshold
                Dw2Dom.#asyncParseXmlThresholdLength = (Dw2Dom.#asyncParseXmlThresholdLength + 2 + xml.length) / 2;
            }
        }
        if (result.toString() === '[object Object]') debugger;
        console.log(`parseXml (${goAsync ? 'async' : 'sync'}) took ${elapsed}ms for ${xml.length} chars; threshold ${thresholdAtStart} -> ${Dw2Dom.#asyncParseXmlThresholdLength}`);
        return result;
    }

    /** @type {Promise<(import('node-libxml').XmlError|{schema?:string})[]>} */
    static async validateXml(xml, schemas) {
        const sw = new Stopwatch();
        const result = await Dw2DomWorkerManager.worker.validateXml(xml, schemas);
        console.log(`validateXml (async) took ${(sw.elapsed)}ms`);
        return result;
    }

    async #syncDom(model, versionId) {
        const currentVersionId = model.getVersionId();
        if (versionId !== undefined && versionId !== currentVersionId) {
            // reschedule
            model['domInSync'] = false;
            model['domUpdate'] = requestIdleCallback(() => this.#syncDom(model, currentVersionId));
            return;
        }
        // save updated dom even if out of sync
        model['dom'] = await Dw2Dom.parseXml(model.getValue());
        const currentVersionId2 = model.getVersionId();
        if (versionId !== undefined && versionId !== currentVersionId2) {
            // reschedule
            model['domInSync'] = false;
            model['domUpdate'] = requestIdleCallback(() => this.#syncDom(model, currentVersionId2));
            return;
        }
        model['domInSync'] = true;
        model['domUpdate'] = -1;
        const queue = model['onDomSync'];
        if (!queue) {
            model['onDomSync'] = [];
            return;
        }
        if (queue.length > 0) model['onDomSync'] = [];
        for (const cb of queue) {
            try {
                cb(model);
            } catch (error) {
                window.error('Error in onDomSync callback', error);
            }
        }
    }

    /**
     * Attaches a DOM to the specified model asynchronously.
     * @param model {import('monaco-editor').editor.ITextModel}
     */
    attach(model) {
        const domParser = this.#domParser || new DOMParser({locator: true, errorsAsTextNodes: true});
        model['dom'] = null;
        model['domInSync'] = false;
        model['onDomSync'] = [];
        const modelVersionId = model.getVersionId();
        model['domUpdate'] = requestIdleCallback(() => this.#syncDom(model, modelVersionId));

        model.onDidChangeContent((e) => {
                model['domInSync'] = false;
                if (model['domUpdate'] !== -1)
                    cancelIdleCallback(model['domUpdate']);
                const modelVersionId = model.getVersionId();
                model['domUpdate'] = requestIdleCallback(() => this.#syncDom(model, modelVersionId));
            }
        );
    }
}

export function createDw2XmlElementProxy(element) {
    return new Proxy(element, {
        get(target, prop, receiver) {
            if (typeof prop === 'string') {
                //const childElem = target.querySelector(`:scope>${prop}`);
                const childElem = target.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === prop);
                if (childElem)
                    return childElem.textContent;
            }
            return Reflect.get(target, prop, receiver);
        },
        set(target, prop, value, receiver) {
            if (typeof prop === 'string') {
                //const childElem = target.querySelector(`:scope>${prop}`);
                const childElem = target.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === prop);
                if (childElem)
                    childElem.textContent = value;
                else {
                    const newChildElem = childElem.document.createElement(prop);
                    newChildElem.textContent = value;
                    target.appendChild(newChildElem);
                }
            }
            return Reflect.set(target, prop, value, receiver);
        },
        deleteProperty(target, prop) {
            //const childElem = target.querySelector(`:scope>${prop}`);
            const childElem = target.childNodes.find(node => node.nodeType === Node.ELEMENT_NODE && node.tagName === prop);
            if (childElem)
                target.removeChild(childElem);
            return Reflect.deleteProperty(target, prop);
        }
    });
}

const cbor = new CborEncoder({structuredClone: true});
window.cbor = cbor;

console.log('Dw2Dom loaded');