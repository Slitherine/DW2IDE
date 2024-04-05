/**
 * A simple DOM parser for XML-like strings.
 * The produced DOM is immutable.
 * Errors in syntax are just parsed as text nodes.
 *
 * Limitations:
 * Preprocessing instructions are ignored.
 *
 * @param text {string}
 * @param options {{isHtml:boolean}?}
 */
export default function parse(text, options) {
    /** @type {Node[]} */
    const nodes = [];
    const doc = new Document(nodes, options);
    /** @type {Element[]} */
    const openElemStack = [];
    let match;
    let lastMatchEnd = 0;
    for (; ;) {
        match = rxNode.exec(text);
        if (match === null) {
            if (lastMatchEnd < text.length) {
                // interpret as de-normalized text node
                /** @type {RegExpExecArray} */
                const fakeMatch = Object.assign(
                    /** @type {RegExpExecArray} */
                    [
                        text.slice(lastMatchEnd)
                    ], {
                        index: lastMatchEnd,
                        input: text,
                    });
                nodes.push(new Text(
                    doc,
                    nodes.length,
                    fakeMatch));
            }
            break;
        }

        if (match.index !== lastMatchEnd) {
            // interpret as de-normalized text node
            /** @type {RegExpExecArray} */
            const fakeMatch = Object.assign(
                /** @type {RegExpExecArray} */
                [
                    text.slice(lastMatchEnd, match.index)
                ], {
                    index: lastMatchEnd,
                    input: text,
                });
            nodes.push(new Text(
                doc,
                nodes.length,
                fakeMatch));
            lastMatchEnd = match.index;
            continue;
        }

        lastMatchEnd = match.index + match[0].length;
        //console.log("%d - %d: %s", match.index, match.index + match[0].length, match[0]);
        const g = match.groups;
        if (g['openTag'] !== undefined) {
            const node = new Element(
                doc,
                nodes.length,
                match);
            nodes.push(node);
            const matchStr = match[0];
            if (matchStr[matchStr.length - 2] !== '/')
                openElemStack.push(node);
            continue;
        }

        if (g['closeTag'] !== undefined) {
            let closed = false;
            const closingTagName = g['closeTag'];
            for (let i = openElemStack.length - 1; i >= 0; i--) {
                const openElem = openElemStack[i];
                if (openElem.tagName !== closingTagName)
                    continue;

                closed = true;
                const endOffset = match.index + match[0].length;
                const xmlFrag = text.slice(openElem.startOffset, endOffset);
                openElem.finalize(xmlFrag);
                // remove the closed element and subsequent elements from the stack
                const openElemsToClose = openElemStack.splice(i);
                // close all unclosed elements between the current and the closing element
                for (let j = openElemsToClose.length - 1; j > 0; j--) {
                    const otherOpenElem = openElemsToClose[j];
                    if (otherOpenElem === openElem) {
                        console.warn("Closing element duplicated in stack.");
                        continue; // TODO: this shouldn't happen, logic bug somewhere
                    }
                    // exclude the closing element itself
                    const otherXmlFrag = text.slice(otherOpenElem.startOffset, match.index);
                    otherOpenElem.finalize(otherXmlFrag);
                }
                break;
            }

            if (!closed) {
                // interpret as de-normalized text node instead
                nodes.push(new Text(
                    doc,
                    nodes.length,
                    match));
            }

            continue;
        }

        if (g['commentText'] !== undefined) {
            nodes.push(new Comment(
                doc,
                nodes.length,
                match));
            continue;
        }

        if (g['pi'] !== undefined) {
            nodes.push(new ProcessingInstruction(
                doc,
                nodes.length,
                match));
            continue;
        }

        if (g['dt'] !== undefined) {
            nodes.push(new DocumentType(
                doc,
                nodes.length,
                match));
            continue;
        }

        if (g['text'] !== undefined) {
            nodes.push(new Text(
                doc,
                nodes.length,
                match));
            continue;
        }

        throw new UnreachableError();
    }

    // close any remaining open elements
    if (openElemStack.length > 0) {
        //console.log("Unclosed elements: %d", elemStack.length);
        for (let i = openElemStack.length - 1; i >= 0; i--) {
            const openElem = openElemStack[i];
            const xmlFrag = text.slice(openElem.startOffset);
            openElem.finalize(xmlFrag);
        }
    }

    Object.freeze(nodes);
    return doc;
}

/**
 * This class exists only for compatibility with the other DOM parser implementations.
 *
 * It just provides access to the parse function together with some options.
 *
 * @public
 */
export class DOMParser {

    /**
     * Create a new DOMParser.
     *
     * @param options {{isHtml:boolean}}
     */
    constructor(options) {
        this.options = options;
    }

    /**
     * Parse an XML-like string into a Document.
     *
     * @param text {string}
     * @param mimeType {string}
     * @returns {Document}
     */
    parseFromString(text, mimeType) {
        switch (mimeType) {
            // dialects of html
            case 'text/html':
                return parse(text, {...this.options, isHtml: true});
            // common xml cases to avoid using the regex
            case 'application/xml':
            case 'application/xhtml+xml':
            case 'text/xml':
            case 'image/svg+xml':
                return parse(text, this.options);
            default:
                if (/^(application|text|image)\/[-a-z+]+\+xml$/.test(mimeType))
                    return parse(text, this.options);
        }
        throw Error('Unsupported MIME type: ' + mimeType);
    }
}

/**
 * A document object.
 *
 * Note: In this implementation, the document object is not a node itself.
 *
 * @public
 * @hideconstructor
 */
export class Document {
    /** @type {Node[]} */
    nodes;

    /** @type {{isHtml:boolean}} */
    options;

    #documentElement;

    get documentElement() {
        if (this.#documentElement === undefined) {
            for (const node of this.nodes) {
                if (node instanceof Element) {
                    this.#documentElement = node;
                    break;
                }
            }
        }
        return this.#documentElement;
    }

    /**
     * Create a new Document.
     *
     * @param nodes {Node[]}
     * @param options {{isHtml:boolean}?}
     */
    constructor(nodes, options) {
        if (!nodes)
            throw Error('nodes must be provided');
        this.nodes = nodes;
        this.options = Object.assign(Object.create(null), options || {});
        Object.freeze(this);
    }

    /** @type {ReadonlyArray<Node>} */
    #childNodes;
    /** @type {ReadonlyArray<Node>} */
    get childNodes() {
        if (this.#childNodes === undefined) {
            return (this.#childNodes = Object.freeze(this.nodes
                .filter(n => n.parentElement === null)));
        }
        return this.#childNodes;
    }

    /** @type {ReadonlyArray<Element>} */
    #children;
    /** @type {ReadonlyArray<Element>} */
    get children() {
        if (this.#children === undefined) {
            this.#children = Object.freeze(this.childNodes
                .filter(n => n instanceof Element));
        }
        return this.#children;
    }

    /** @type {Node|null} */
    #firstChild;
    /** @type {Node|null} */
    get firstChild() {
        if (this.#firstChild === undefined) {
            if (this.#childNodes !== undefined)
                return (this.#firstChild = this.#childNodes[0]);
            return (this.#firstChild = this.nodes
                .find(n => n.parentElement === null));
        }
        return this.#firstChild;
    }

    /** @type {Node|null} */
    #lastChild;
    /** @type {Node|null} */
    get lastChild() {
        if (this.#lastChild === undefined) {
            if (this.#childNodes !== undefined)
                return (this.#lastChild = this.#childNodes[this.#childNodes.length - 1]);
            return (this.#lastChild = this.nodes
                .findLast(n => n.parentElement === null));
        }
        return this.#lastChild;
    }

    /** @type {string} */
    #nodeValue;
    /** @type {string} */
    get nodeValue() {
        if (this.#nodeValue === undefined) {
            return (this.#nodeValue = this.childNodes
                .map(n => n.nodeValue)
                .join(''));
        }
        return this.#nodeValue;
    }

    /** @type {string} */
    #textContent;
    /** @type {string} */
    get textContent() {
        if (this.#textContent === undefined) {
            return (this.#textContent = this.childNodes
                .map(n => n.textContent)
                .join(''));
        }
        return this.#textContent;
    }


    toString() {
        return this.childNodes.map(n => n.xmlFragment).join('');
    }

    [Symbol.toStringTag]() {
        if (this.documentElement)
            return `Document(${this.documentElement.tagName})`;
        return 'Document';
    }

    [Symbol.toPrimitive](hint) {
        switch (hint) {
            case 'string':
                return this.toString();
            case 'number':
                return Number.NaN;
            default:
                return this;
        }
    }
}

function isNumeric(str) {
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) < 48 || str.charCodeAt(i) > 57)
            return false;
    }
    return true;
}

/**
 * An abstraction for a node in the DOM.
 *
 * @abstract
 * @public
 * @hideconstructor
 */
export class Node {
    /**
     * Create a new Node.
     *
     * @param doc {Document}
     * @param nodeIndex {number}
     * @param match {RegExpExecArray}
     * @hideconstructor
     */
    constructor(doc, nodeIndex, match) {
        if (!doc)
            throw Error('doc must be provided');
        if (typeof nodeIndex !== "number")
            throw Error('nodeIndex must be provided');
        if (!match)
            throw Error('match must be provided');
        this.ownerDocument = doc;
        this.nodeIndex = nodeIndex;
        this.startOffset = match.index;
        this.xmlFragment = match[0];
    }

    /** @type {Document} */
    ownerDocument;

    /** @type {number} */
    nodeIndex;

    /** @type {number} */
    startOffset;

    /** @type {string} */
    xmlFragment;

    /** @type {number} */
    get endOffset() {
        return this.startOffset + this.xmlFragment.length;
    }

    /** @type {Element|null} */
    #parentElement;
    /**
     * Get the parent element node.
     *
     * @returns {Element|null}
     */
    get parentElement() {
        if (this.#parentElement === undefined) {
            if (this.ownerDocument.documentElement === this)
                return (this.#parentElement = null);

            for (let i = this.nodeIndex - 1; i >= 0; i--) {
                const node = this.ownerDocument.nodes[i];

                // node type check
                if (!(node instanceof Element))
                    continue;

                // sibling check
                if (node.endOffset > this.startOffset)
                    return (this.#parentElement = node);
            }

            // no parent element, must be the document element?
            return (this.#parentElement = null);
        }
        return this.#parentElement;
    }

    /** @type {Node|null} */
    #nextSibling;

    /**
     * Get the next sibling node.
     *
     * @returns {Node|null}
     */
    nextSibling() {
        if (this.#nextSibling !== undefined)
            return this.#nextSibling;

        const doc = this.ownerDocument;
        const nextIndex = this.nodeIndex + 1;

        // last node check
        if (nextIndex >= doc.nodes.length)
            return (this.#nextSibling = null);

        const node = doc.nodes[nextIndex];
        const parent = this.parentElement;

        // last child check
        if (node.startOffset > parent.endOffset)
            return (this.#nextSibling = null);

        return (this.#nextSibling = node);
    }

    /** @type {Node|null} */
    #previousSibling;

    /**
     * Get the previous sibling node.
     *
     * @returns {Node|null}
     */
    previousSibling() {
        if (this.#previousSibling !== undefined)
            return this.#previousSibling;

        const prevIndex = this.nodeIndex - 1;

        // first node check
        if (prevIndex < 0)
            return (this.#previousSibling = null);

        const doc = this.ownerDocument;
        const node = doc.nodes[prevIndex];
        const parent = this.parentElement;

        // first child check
        if (node.startOffset < parent.startOffset)
            return (this.#previousSibling = null);

        return (this.#previousSibling = node);
    }

    /**
     * Get the node type, for compatibility with the other DOM parser implementations.
     *
     * @returns {number}
     */
    get nodeType() {
        if (this instanceof Element)
            return 1; // Node.ELEMENT_NODE
        if (this instanceof Text)
            return 3; // Node.TEXT_NODE
        if (this instanceof Comment)
            return 8; // Node.COMMENT_NODE
        if (this instanceof ProcessingInstruction)
            return 7; // Node.PROCESSING_INSTRUCTION_NODE
        if (this instanceof DocumentType)
            return 10; // Node.DOCUMENT_TYPE_NODE
        throw new UnreachableError();
    }

    toString() {
        return this.xmlFragment;
    }

    [Symbol.toPrimitive](hint) {
        switch (hint) {
            case 'string':
                return this.toString();
            case 'number':
                return Number.NaN;
            default:
                return this;
        }
    }
}

/**
 * @param str {string}
 * @param charCodes {Set<number>}
 * @param start {number}
 * @return {number|-1}
 */
function indexOfAnyCharByCharCode(str, charCodes, start) {
    for (let i = start; i < str.length; i++) {
        if (charCodes.has(str.charCodeAt(i)))
            return i;
    }
    return -1;
}

const EndTagNameChars = new Set([
    '/',
    '>',
    ' '
].map(c => c.charCodeAt(0)));

/**
 * An element node.
 *
 * @public
 * @hideconstructor
 */
export class Element extends Node {
    /**
     * Create a new Element.
     *
     * @param doc {Document}
     * @param nodeIndex {number}
     * @param match {RegExpExecArray}
     */
    constructor(doc, nodeIndex, match) {
        super(doc, nodeIndex, match);
    }

    /** @type {Element|null} */
    #nextElementSibling;
    /** @return {Element|null} */
    get nextElementSibling() {
        if (this.#nextElementSibling !== undefined)
            return this.#nextElementSibling;

        const parent = this.parentElement;

        for (let i = this.nodeIndex + 1; i < this.ownerDocument.nodes.length; i++) {
            const node = this.ownerDocument.nodes[i];
            // node type check
            if (!(node instanceof Element))
                continue;

            // child check
            if (node.startOffset > parent.endOffset)
                return (this.#nextElementSibling = null);

            return (this.#nextElementSibling = node);
        }

        // last element in document
        return (this.#nextElementSibling = null);
    }

    /** @type {Element|null} */
    #previousElementSibling;
    /** @return {Element|null} */
    get previousElementSibling() {
        if (this.#previousElementSibling !== undefined)
            return this.#previousElementSibling;

        const parent = this.parentElement;

        for (let i = this.nodeIndex - 1; i >= 0; i--) {
            const node = this.ownerDocument.nodes[i];

            // node type check
            if (!(node instanceof Element))
                continue;

            // child check
            if (node.startOffset > parent.endOffset)
                return (this.#nextElementSibling = null);

            return (this.#previousElementSibling = node);
        }

        // first element in document
        return (this.#previousElementSibling = null);
    }

    /** @type {string} */
    #tagName;
    /** @return {string} */
    get tagName() {
        if (this.#tagName === undefined) {
            let end = indexOfAnyCharByCharCode(this.xmlFragment, EndTagNameChars, 1);

            if (end >= 0)
                return (this.#tagName = this.xmlFragment.slice(1, end));

            return (this.#tagName = this.xmlFragment.slice(1));
        }
        return this.#tagName;
    }

    /** @type {ChildNodeList|ReadonlyArray<Node>} */
    #childNodes;
    /** @return {ReadonlyArray<Node>} */
    get childNodes() {
        if (this.#childNodes === undefined)
            return (this.#childNodes = new ChildNodeList(this));

        return this.#childNodes;
    }

    getChildNodes() {
        // populate #childNodes directly with a frozen array
        if (this.#childNodes === undefined) {
            /** @type {Node[]} */
            const children = [];
            for (let i = this.nodeIndex + 1; i < this.ownerDocument.nodes.length; i++) {
                const node = this.ownerDocument.nodes[i];
                if (node.startOffset >= this.endOffset)
                    break;
                if (node.parentElement === this)
                    children.push(node);
            }
            return (this.#childNodes = Object.freeze(children));
        }
        return this.#childNodes;
    }

    /** @type {ReadonlyArray<Element>} */
    #children;
    /** @return {ReadonlyArray<Element>} */
    get children() {
        if (this.#children === undefined)
            return (this.#children = new ChildElementsList(this));
        return this.#children;
    }

    getChildren() {
        // populate #children directly with a frozen array
        if (this.#children === undefined) {
            /** @type {Element[]} */
            const children = [];

            if (this.#childNodes !== undefined) {
                if (this.#childNodes instanceof ChildNodeList) {
                    if (this.#childNodes.isFullyPopulated) {
                        for (const node of this.#childNodes) {
                            if (node instanceof Element)
                                children.push(node);
                        }
                        return (this.#children = Object.freeze(children));
                    }
                }

                // it is a pre-populated array of nodes
                for (const node of this.#childNodes) {
                    if (node instanceof Element)
                        children.push(node);
                }
                return (this.#children = Object.freeze(children));
            }

            for (let i = this.nodeIndex + 1; i < this.ownerDocument.nodes.length; i++) {
                const node = this.ownerDocument.nodes[i];
                if (node.startOffset >= this.endOffset)
                    break;
                if (node instanceof Element && node.parentElement === this)
                    children.push(node);
            }
            return (this.#children = Object.freeze(children));
        }
        return this.#children;
    }

    /** @type {Node|null} */
    #firstChild;
    /** @return {Node|null} */
    get firstChild() {
        if (this.#firstChild === undefined) {
            if (this.#childNodes !== undefined)
                return (this.#firstChild = this.#childNodes[0]);
            for (let i = this.nodeIndex + 1; i < this.ownerDocument.nodes.length; i++) {
                const node = this.ownerDocument.nodes[i];
                if (node.startOffset >= this.endOffset)
                    break;
                if (node.parentElement === this)
                    return (this.#firstChild = node);
            }

            return (this.#firstChild = null);
        }
        return this.#firstChild;
    }

    /** @return {Node|null} */
    get lastChild() {
        if (this.childNodes.length > 0)
            return this.childNodes[this.childNodes.length - 1];
        return null;
    }

    /** @type {Element|null} */
    #firstElementChild;
    /** @return {Element|null} */
    get firstElementChild() {
        if (this.#firstElementChild === undefined) {
            if (this.#children !== undefined)
                return (this.#firstElementChild = this.#children[0]);
            if (this.#childNodes !== undefined) {
                for (const node of this.#childNodes) {
                    if (node instanceof Element)
                        return (this.#firstElementChild = node);
                }
                return (this.#firstElementChild = null);
            }
            for (let i = this.nodeIndex + 1; i < this.ownerDocument.nodes.length; i++) {
                const node = this.ownerDocument.nodes[i];
                if (node.startOffset >= this.endOffset)
                    break;
                // note on perf; doesn't evaluate parentElement, faster than using childNodes
                if (node instanceof Element && node.parentElement === this)
                    return (this.#firstElementChild = node);
            }
            return (this.#firstElementChild = null);
        }
        return this.#firstElementChild;
    }

    /** @type {Element|null} */
    #lastElementChild;
    /** @return {Element|null} */
    get lastElementChild() {
        if (this.#lastElementChild === undefined) {
            if (this.#children !== undefined)
                return (this.#lastElementChild = this.#children[this.#children.length - 1]);
            if (this.#childNodes !== undefined) {
                for (let i = this.#childNodes.length - 1; i >= 0; i--) {
                    const node = this.#childNodes[i];
                    if (node instanceof Element)
                        return (this.#lastElementChild = node);
                }
                return (this.#lastElementChild = null);
            }
            return (this.#lastElementChild = this.children[this.children.length - 1]);
        }
        return this.#lastElementChild;
    }

    /** @type {string} */
    #textContent;
    /** @return {string} */
    get textContent() {
        if (this.#textContent === undefined) {
            return (this.#textContent = this.childNodes
                .map(n => n.textContent)
                .join(''));
        }
        return this.#textContent;
    }

    /** @type {ReadonlyArray<Attribute>} */
    #attributes;
    /** @return {ReadonlyArray<Attribute>} */
    get attributes() {
        if (this.#attributes === undefined) {
            const attributes = [];
            const frag = this.xmlFragment;
            const end = frag.indexOf('>');
            if (end === -1)
                return (this.#attributes = Object.freeze(attributes));

            const start = frag.indexOf(' ') + 1;
            if (start === 0 || start >= end)
                return (this.#attributes = Object.freeze(attributes));

            const attrFrag = frag.slice(start, end);
            let match;

            while ((match = rxAttr.exec(attrFrag)) !== null)
                attributes.push(new Attribute(this.ownerDocument, this.nodeIndex, match, this));

            return (this.#attributes = Object.freeze(attributes));
        }
        return this.#attributes;
    }

    /** @type {ReadonlyMap<string,Attribute>} */
    #attributeMap;

    getAttribute(name) {
        if (this.#attributeMap === undefined) {
            const map = new Map();
            for (const attr of this.attributes)
                map.set(attr.name, attr);

            return (this.#attributeMap = Object.freeze(map));
        }
        return this.#attributeMap.get(name);
    }

    /** @internal */
    finalize(xmlFrag) {
        if (Object.isFrozen(this)) {
            if (this.xmlFragment !== xmlFrag) {
                console.warn('Attempt to re-finalize element with different XML fragment.');
            }
            return this;
        }

        this.xmlFragment = xmlFrag;
        Object.freeze(this);
        return this;
    }

    toString() {
        return this.xmlFragment;
    }

    [Symbol.toStringTag]() {
        return `Element(${this.tagName})`;
    }

    [Symbol.toPrimitive](hint) {
        switch (hint) {
            case 'string':
                return this.toString();
            case 'number':
                return Number.NaN;
            default:
                return this;
        }
    }
}

/**
 * A text node.
 *
 * @public
 * @hideconstructor
 */
export class Text extends Node {
    /**
     * Create a new Element.
     *
     * @param doc {Document}
     * @param nodeIndex {number}
     * @param match {RegExpExecArray}
     */
    constructor(doc, nodeIndex, match) {
        super(doc, nodeIndex, match);
        Object.freeze(this);
    }

    /** @return {string} */
    get nodeValue() {
        return this.xmlFragment;
    }

    /** @type {string} */
    #textContent;
    /** @return {string} */
    get textContent() {
        if (this.#textContent === undefined) {
            const v = this.nodeValue;
            return (this.#textContent = parseTextContent(v));
        }
        return this.#textContent;
    }

    toString() {
        return this.xmlFragment;
    }

    [Symbol.toStringTag]() {
        if (this.textContent.length > 10)
            return `Text(${this.textContent.slice(0, 10)}...)`;
        return `Text(${this.textContent})`;
    }

    [Symbol.toPrimitive](hint) {
        switch (hint) {
            case 'string':
                return this.toString();
            case 'number':
                return Number.NaN;
            default:
                return this;
        }
    }
}

/**
 * A comment node.
 *
 * @public
 * @hideconstructor
 */
export class Comment extends Node {
    /**
     * Create a new Element.
     *
     * @param doc {Document}
     * @param nodeIndex {number}
     * @param match {RegExpExecArray}
     */
    constructor(doc, nodeIndex, match) {
        super(doc, nodeIndex, match);
        Object.freeze(this);
    }

    /** @type {string} */
    #nodeValue;

    /** @return {string} */
    get nodeValue() {
        if (this.#nodeValue !== undefined)
            return this.#nodeValue;

        // remove <!-- and -->
        this.#nodeValue = this.xmlFragment.slice(4, -3);
    }


    /** @type {string} */
    #textContent;
    /** @return {string} */
    get textContent() {
        if (this.#textContent !== undefined)
            return this.#textContent;

        this.#textContent = parseTextContent(this.nodeValue);
    }

    toString() {
        return this.xmlFragment;
    }

    [Symbol.toStringTag]() {
        if (this.textContent.length > 10)
            return `Comment(${this.textContent.slice(0, 10)}...)`;
        return `Comment(${this.textContent})`;
    }

    [Symbol.toPrimitive](hint) {
        switch (hint) {
            case 'string':
                return this.toString();
            case 'number':
                return Number.NaN;
            default:
                return this;
        }
    }
}

/**
 * A processing instruction node.
 *
 * @public
 * @hideconstructor
 */
export class ProcessingInstruction extends Node {
    /**
     * Create a new ProcessInstruction.
     *
     * @param doc {Document}
     * @param nodeIndex {number}
     * @param match {RegExpExecArray}
     */
    constructor(doc, nodeIndex, match) {
        super(doc, nodeIndex, match);
        Object.freeze(this);
    }

    /** @type {string} */
    #target;

    get target() {
        if (this.#target !== undefined)
            return this.#target;

        const targetEnd = this.xmlFragment.indexOf(' ', 2);
        if (targetEnd === -1)
            this.#target = '';
        else
            this.#target = this.xmlFragment.slice(2, targetEnd);
    }

    toString() {
        return this.xmlFragment;
    }

    [Symbol.toStringTag]() {
        return `ProcessInstruction(${this.target})`;
    }

    [Symbol.toPrimitive](hint) {
        switch (hint) {
            case 'string':
                return this.toString();
            case 'number':
                return Number.NaN;
            default:
                return this;
        }
    }

    get nodeType() {
        return 7; // Node.PROCESSING_INSTRUCTION_NODE
    }
}

/**
 * A DocumentType node.
 *
 * @public
 * @hideconstructor
 */
export class DocumentType extends Node {
    /**
     * Create a new DocumentType.
     *
     * @internal
     * @param doc {Document}
     * @param nodeIndex {number}
     * @param match {RegExpExecArray}
     */
    constructor(doc, nodeIndex, match) {
        super(doc, nodeIndex, match);
        Object.freeze(this);
    }

    /** @type {string} */
    #name;
    get name() {
        if (this.#name !== undefined)
            return this.#name;

        const nameEnd = this.xmlFragment.indexOf(' ', 2);
        if (nameEnd === -1)
            this.#name = '';
        else
            this.#name = this.xmlFragment.slice(2, nameEnd);
    }


    toString() {
        return this.xmlFragment;
    }

    [Symbol.toStringTag]() {
        return `DocumentType(${this.name})`;
    }

    [Symbol.toPrimitive](hint) {
        switch (hint) {
            case 'string':
                return this.toString();
            case 'number':
                return Number.NaN;
            default:
                return this;
        }
    }

    get nodeType() {
        return 10; // Node.DOCUMENT_TYPE_NODE
    }
}

/**
 * An attribute.
 *
 * Note: Not a node in this implementation.
 *
 * @public
 * @hideconstructor
 */
export class Attribute {
    /**
     * Create a new Attribute.
     *
     * @internal
     * @param doc {Document}
     * @param parentNodeIndex {number}
     * @param match {RegExpExecArray}
     * @param parentElement {Element}
     */
    constructor(doc, parentNodeIndex, match, parentElement) {
        if (!doc)
            throw Error('doc must be provided');
        if (typeof parentNodeIndex !== "number")
            throw Error('parentNodeIndex must be provided');
        if (!match)
            throw Error('match must be provided');
        if (!parentElement)
            throw Error('parentElement must be provided');
        this.ownerDocument = doc;
        this.parentNodeIndex = parentNodeIndex;
        this.startOffset = parentElement.startOffset + match.index;
        this.endOffset = this.startOffset + match[0].length;
    }

    /** @type {Document} */
    ownerDocument;

    /** @type {number} */
    parentNodeIndex;

    /** @type {number} */
    startOffset;

    /** @type {number} */
    endOffset;

    /** @type {Element} */
    #parentElement;
    get parentElement() {
        if (this.#parentElement !== undefined)
            return this.#parentElement;

        return (this.#parentElement = this.ownerDocument.nodes[this.parentNodeIndex]);
    }

    /** @type {number} */
    #attributeIndex;
    /**
     * Get the index of this attribute in the parent element's attributes.
     *
     * @return {number} */
    get attributeIndex() {
        if (this.#attributeIndex !== undefined)
            return this.#attributeIndex;

        // the parent element is the one that creates the attributes
        // so just find the index of this attribute in the parent's attributes
        const attrs = this.parentElement.attributes;
        for (let i = 0; i < attrs.length; i++)
            if (attrs[i] === this)
                return (this.#attributeIndex = i);

        throw new UnreachableError();
    }

    /** @type {string} */
    #xmlFragment;
    /**
     * Get the XML fragment of this attribute.
     *
     * @return {string}
     */
    get xmlFragment() {
        if (this.#xmlFragment !== undefined)
            return this.#xmlFragment;

        const parent = this.parentElement;
        const parentFrag = parent.xmlFragment;
        const start = this.startOffset - parent.startOffset;
        const end = this.endOffset - parent.startOffset;
        return (this.#xmlFragment = parentFrag.slice(start, end));
    }

    /** @type {string} */
    #name;
    /**
     * Get the attribute name.
     *
     * @returns {string}
     */
    get name() {
        if (this.#name === undefined) {
            const nameEnd = this.xmlFragment.indexOf('=');
            if (nameEnd === -1)
                return (this.#name = '');
            return (this.#name = this.xmlFragment.slice(0, nameEnd).trim());
        }
        return this.#name;
    }

    /** @type {string} */
    #value;
    /**
     * Get the attribute value.
     *
     * @returns {string}
     */
    get value() {
        if (this.#value !== undefined) {
            return this.#value;
        }
        const valueStart = this.xmlFragment.indexOf('=');
        if (valueStart === -1)
            return (this.#value = '');

        const unescapedValue = this.xmlFragment.slice(valueStart + 1, -1);

        const firstChar = unescapedValue[0];
        if (!(firstChar === '"' || firstChar === "'"))
            return (this.#value = parseTextContent(unescapedValue));

        const lastChar = unescapedValue[unescapedValue.length - 1];

        // if it's an awkward quote situation, include the quotes
        if (lastChar !== firstChar)
            return (this.#value = parseTextContent(unescapedValue));

        return (this.#value = parseTextContent(unescapedValue.slice(1, -1)));
    }

    /**
     * Get the attribute value as a node value.
     *
     * @return {string} */
    get nodeValue() {
        return this.value;
    }

    /**
     * Get the attribute value as text content.
     *
     * @return {string} */
    get textContent() {
        return this.value;
    }

    /**
     * Get the node type.
     *
     * Note: Attributes in this implementation are technically not nodes.
     *
     * @return {number} */
    get nodeType() {
        return 2; // Node.ATTRIBUTE_NODE
    }

    /** @type {Attribute|null} */
    #nextAttribute;
    /** @return {Attribute|null} */
    get nextAttribute() {
        if (this.#nextAttribute !== undefined)
            return this.#nextAttribute;

        const attrs = this.parentElement.attributes;
        const nextIndex = this.attributeIndex + 1;

        // last attribute check
        if (nextIndex >= attrs.length)
            return (this.#nextAttribute = null);

        return (this.#nextAttribute = attrs[nextIndex]);
    }

    /** @type {Attribute|null} */
    #previousAttribute;
    /** @return {Attribute|null} */
    get previousAttribute() {
        if (this.#previousAttribute !== undefined)
            return this.#previousAttribute;

        const prevIndex = this.attributeIndex - 1;

        // first attribute check
        if (prevIndex < 0)
            return (this.#previousAttribute = null);

        return (this.#previousAttribute = this.parentElement.attributes[prevIndex]);
    }

    toString() {
        return this.xmlFragment;
    }

    [Symbol.toStringTag]() {
        return `Attribute(${this.name})`;
    }

    [Symbol.toPrimitive](hint) {
        switch (hint) {
            case 'string':
                return this.toString();
            case 'number':
                return Number.NaN;
            default:
                return this;
        }
    }
}

/**
 * Error for unreachable code.
 *
 * @public
 */
export class UnreachableError extends Error {
    constructor() {
        super('Unreachable code reached, should not happen, code logic error.');
    }
}


/**
 * Regular expression for parsing XML-like strings.
 *
 * @type {RegExp}
 */
const rxNode = new RegExp(
    //language=regexp
    ''
    // open element tag
    + '<(?<openTag>[a-zA-Z0-9:_-]+)(?:\\s+(?<attrs>[^>]*))?/?>'
    // close element tag
    + '|</(?<closeTag>[a-zA-Z0-9:_-]+)>'
    // self-closing element tag
    + '|<!--(?<commentText>.*?)-->'
    // processing instruction
    + '|<\\?(?<pi>[^?\s]*)[^?]+\\?>'
    // doctype or entity decl probably
    + '|<!(?<dt>[^>\s]*)[^>]+>'
    // text content, CDATA, entities, errors, etc.
    + '|(?<text>(?:<!\\[CDATA\\[.*?]]>|&[^;]+;|[^<]|<[^?/!a-zA-Z0-9:_-])+)'
    ,
    // generate indices for substring matches
    'd'
    // global search
    + 'g'
    // allow . to match newlines
    + 's'
    // perform a "sticky" search that matches starting at the current position in the target string
    + 'y');
// /([a-zA-Z0-9:_-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^'"\s]+))?/dgsy
const rxAttr = new RegExp(
    //language=regexp
    ''
    // attribute name
    + '(?<name>[a-zA-Z0-9:_-]+)'
    // equals sign
    + '(?:\\s*=\\s*'
    // attribute value
    + '(?<value>"[^"\r\n]*?"|\'[^\'\r\n]*?\'|[^\'">\S]+))?'
    ,
    // generate indices for substring matches
    'd'
    // global search
    + 'g'
    // allow . to match newlines
    + 's'
    // perform a "sticky" search that matches starting at the current position in the target string
    + 'y');

/**
 * Loads the HTML entities JSON file and builds a Function that resolves entities.
 *
 * @returns {function(string):string}
 */
function buildHtmlEntitiesResolver() {
    // https://github.com/w3c/html/blob/master/entities.json
    const entities = require('./html-entities.json');
    /*
     *  {
     *    "&Aacute;": { "codepoints": [193], "characters": "\u00C1" },
     *    ...
    * */
    let funcBody = 'switch(e){';
    for (const [entity, {characters}] of Object.entries(entities)) {
        funcBody += `case ${JSON.stringify(entity)}:return ${JSON.stringify(characters)};`;
    }
    funcBody += 'default: return e;}';

    return new Function('e', funcBody);
}

/** @type {function(string):string} */
let htmlEntitiesResolver;

function getHtmlEntitiesResolver() {
    return (htmlEntitiesResolver
        ??= buildHtmlEntitiesResolver());
}


/**
 * Parse text content with respect to the document's options.
 *
 * @param nodeValue {string}
 * @param entityResolver {(function(string):string)?}
 * @param document {Document?}
 * @returns {string}
 */
function parseTextContent(nodeValue, entityResolver, document) {
    if (document?.options.isHtml && entityResolver === undefined)
        entityResolver = getHtmlEntitiesResolver();
    // parse CDATA, entities, etc.
    if (!nodeValue) return '';
    return nodeValue
        .replace(/<!\[CDATA\[(.*?)]]>/g, '$1')
        .replace(/&[^;]+;/g, m => {
            switch (m) {
                //@formatter:off
                case '&amp;': return '&';
                case '&lt;': return '<';
                case '&gt;': return '>';
                case '&quot;': return '"';
                case '&apos;': return "'";
                //@formatter:on
                default: {
                    if (m.startsWith('&#x')) {
                        const valueStr = m.slice(3, -1);
                        if (isNumeric(valueStr)) {
                            const value = parseInt(valueStr, 16);
                            if (value >= 0 && value <= 0x10FFFF)
                                return String.fromCharCode(value);
                        }
                    } else if (m.startsWith('&#')) {
                        const valueStr = m.slice(2, -1);
                        if (isNumeric(valueStr)) {
                            const value = parseInt(valueStr, 10);
                            if (value >= 0 && value <= 0x10FFFF)
                                return String.fromCharCode(value);
                            // else fall through
                        }
                        // else fall through
                    }
                    if (entityResolver) {
                        return entityResolver(m);
                    }
                    return m;
                }
            }
        });
}

/**
 * A list of child nodes for an element.
 *
 * Automatically populates the list of child nodes as needed.
 * Uses a Proxy to handle array-like access to the child nodes.
 *
 * @implements {ReadonlyArray<Node>}
 * @package
 */
class ChildNodeList {
    /** @type {Element} */
    #element;
    #childNodes = [];
    #final = false;
    #iter;

    constructor(element) {
        this.#element = element;
        return CreateListLikeProxy(this);
    }

    get isFullyPopulated() {
        return this.#final;
    }

    * #enumerate() {
        const elem = this.#element;
        const nodes = elem.ownerDocument.nodes;
        for (let i = elem.nodeIndex + 1; i < nodes.length; i++) {
            const node = nodes[i];
            if (node.startOffset >= elem.endOffset)
                break;
            if (node.parentElement === elem)
                yield node;
        }
    }

    item(index) {
        const childNodes = this.#childNodes;
        if (childNodes.length > index)
            return childNodes[index];
        if (this.#final)
            return null;
        let result;
        const iter = (this.#iter ??= this.#enumerate());
        while (index >= childNodes.length) {
            result = iter.next();
            if (result.done) {
                this.#final = true;
                Object.freeze(this.#childNodes);
                return null;
            }
            childNodes.push(result.value);
        }
        return result.value;
    }

    /** @field [Symbol.unscopables] {} */
    get [Symbol.unscopables]() {
        return ReadonlyArrayUnscopables;
    }

    /** @field length {number} */
    get length() {
        const childNodes = this.#childNodes;
        if (this.#final)
            return childNodes.length;
        let result;
        const iter = (this.#iter ??= this.#enumerate());
        for (; ;) {
            result = iter.next();
            if (result.done) {
                this.#final = true;
                break;
            }
            childNodes.push(result.value);
        }
        return this.#childNodes.length;
    }

    * [Symbol.iterator]() {
        for (let i = 0; ; ++i) {
            const result = this.item(i);
            if (result === null)
                break;
            yield result;
        }
    }

    [Symbol.toStringTag]() {
        // for compatibility with the other DOM parser implementations
        return 'NodeList';
    }

    at(index) {
        return this.item(index);
    }

    concat(...items) {
        return [...this, ...items];
    }

    * entries() {
        for (let i = 0; ; ++i) {
            const result = this.item(i);
            if (result === null)
                break;
            yield [i, result];
        }
    }

    every(predicate, thisArg) {
        for (const node of this)
            if (!predicate.call(thisArg, node))
                return false;
        return true;
    }

    filter(predicate, thisArg) {
        const result = [];
        for (const node of this)
            if (predicate.call(thisArg, node))
                result.push(node);
        return result;
    }

    find(predicate, thisArg) {
        for (const node of this)
            if (predicate.call(thisArg, node))
                return node;
        return undefined;
    }

    findIndex(predicate, thisArg) {
        for (let i = 0; ; i++) {
            const node = this.item(i);
            if (node === null)
                break;
            if (predicate.call(thisArg, node))
                return i;
        }
        return -1;
    }

    findLast(predicate, thisArg) {
        // using length here populates the whole state, but predicate could be more expensive
        for (let i = this.length - 1; i >= 0; i--) {
            const node = this.item(i);
            if (node !== null && predicate.call(thisArg, node))
                return node;
        }
        return undefined;
    }

    findLastIndex(predicate, thisArg) {
        // using length here populates the whole state, but predicate could be more expensive
        for (let i = this.length - 1; i >= 0; i--) {
            const node = this.item(i);
            if (node !== null && predicate.call(thisArg, node))
                return i;
        }
        return -1;
    }

    * asFlat(depth) {
        // expand all child nodes and their child nodes, etc.
        for (const node of this) {
            yield node;
            if (depth > 0 && node instanceof Element)
                yield* node.childNodes.asFlat(depth - 1);
        }
    }

    flat(depth) {
        // expand all child nodes and their child nodes, etc.
        return [...this.asFlat(depth)];
    }

    flatMap(callback, thisArg) {
        const iter = this.asFlat(1);
        const result = [];
        for (const node of iter)
            result.push(callback.call(thisArg, node));
        return result;
    }

    forEach(callback, thisArg) {
        for (const node of this)
            callback.call(thisArg, node);
    }

    includes(searchElement, fromIndex) {
        return this.indexOf(searchElement, fromIndex) >= 0;
    }

    indexOf(searchElement, fromIndex) {
        for (let i = fromIndex ?? 0; ; i++) {
            const node = this.item(i);
            if (node === null)
                break;
            if (node === searchElement)
                return i;
        }
        return -1;
    }

    join(separator) {
        // this is kinda dumb, but nobody should use this anyway
        return [...this].join(separator);
    }

    keys() {
        // this populates the whole state
        const keys = new Array(this.length);
        for (let i = 0; i < keys.length; i++)
            keys[i] = i;
    }

    lastIndexOf(searchElement, fromIndex) {
        // this populates the whole state
        for (let i = fromIndex ?? this.length - 1; i >= 0; i--) {
            const node = this.item(i);
            if (node === null)
                break;
            if (node === searchElement)
                return i;
        }
        return -1;
    }

    map(callback, thisArg) {
        const result = [];
        for (const node of this)
            result.push(callback.call(thisArg, node));
        return result;
    }

    reduce(callback) {
        let result;
        for (let i = 0; ; i++) {
            const node = this.item(i);
            if (node === null)
                break;
            result = callback(result, node, i, this);
        }
        return result;
    }

    reduceRight(callback) {
        // this populates the whole state
        let result;
        for (let i = this.length - 1; i >= 0; i--) {
            const node = this.item(i);
            if (node === null)
                break;
            result = callback(result, node, i, this);
        }
        return result;
    }

    slice(start, end) {
        const result = [];
        for (let i = start; i < end; i++) {
            const node = this.item(i);
            if (node === null)
                break;
            result.push(node);
        }
        return result;
    }

    some(predicate, thisArg) {
        for (const node of this)
            if (predicate.call(thisArg, node))
                return true;
        return false;
    }

    static #localeTag = Object.prototype.toLocaleString().replace('Object', 'NodeList');

    toLocaleString() {
        return ChildNodeList.#localeTag;
    }

    toReversed() {
        return [...this].reverse();
    }

    toSorted(compare) {
        return [...this].sort(compare);
    }

    toSpliced(start, deleteCount, ...items) {
        const result = [...this];
        result.splice(start, deleteCount, ...items);
        return result;
    }

    toString() {
        return "[object NodeList]";
    }

    values() {
        return this[Symbol.iterator]();
    }

    with(index, value) {
        return this.toSpliced(index, 1, value);
    }
}


const ListlikeProxyHandler = {
    // handle array-like access
    get: (target, prop, receiver) => {
        switch (typeof prop) {
            case 'string':
                if (isNumeric(prop))
                    return target.item(parseInt(prop, 10));
            // fallthrough
            default:
                const item = target[prop];
                if (item instanceof Function) {
                    const func = targetBoundFuncs.get(prop);
                    if (func) return func;
                    if (!receiver) receiver = target;
                    const newFunc = function (...args) {
                        return item.call(this === receiver ? target : this, ...args);
                    };
                    targetBoundFuncs.set(prop, newFunc);
                    return newFunc;
                }
            case 'number':
                return target.item(prop);
        }
    },
    // handle 'in' operator
    has: (target, prop) => {
        switch (typeof prop) {
            case 'string':
                if (isNumeric(prop))
                    return target.item(parseInt(prop, 10)) !== null;
                break;
            case 'number':
                return target.item(prop) !== null;
            default:
                return prop in target;
        }
    },
    getOwnPropertyDescriptor: (target, prop) => {
        switch (typeof prop) {
            case 'number':
                const value = target.item(prop);
                if (value === null)
                    return undefined;
                return {value, writable: false, enumerable: true, configurable: false};
            case 'string':
                if (isNumeric(prop)) {
                    const index = parseInt(prop, 10);
                    const value = target.item(index);
                    if (value === null)
                        return undefined;
                    return {value, writable: false, enumerable: true, configurable: false};
                }
            // fallthrough
            default:
                return Reflect.getOwnPropertyDescriptor(target, prop);
        }
    },
    ownKeys: (target) => {
        const keys = [];
        for (let i = 0; ; ++i) {
            if (target.item(i) === null)
                break;
            keys.push(i.toString());
        }
        return keys;
    },
    getPrototypeOf(target) {
        return ChildElementsList.prototype;
    },
    setPrototypeOf(target, v) {
        return false;
    },
    set: (target, prop, value) => {
        return false;
    },
    defineProperty(target, property, attributes) {
        return false;
    },
    deleteProperty(target, p) {
        return false;
    },
    preventExtensions(target) {
        return false;
    },
    isExtensible(target) {
        return false;
    }
};

/**
 * A list of child elements for an element.
 *
 * Automatically populates the list of child elements as needed.
 * Uses a Proxy to handle array-like access to the child elements.
 *
 * Has specific behavior that avoids populating the whole state when possible.
 *
 * @implements {ReadonlyArray<Node>}
 * @package
 */
class ChildElementsList {
    /** @type {Element} */
    #element;
    #children = [];
    #final = false;
    #iter;

    constructor(element) {
        this.#element = element;
        return CreateListLikeProxy(this);
    }

    get isFullyPopulated() {
        return this.#final;
    }

    * #enumerate() {
        const elem = this.#element;
        for (const node of elem.childNodes)
            if (node instanceof Element)
                yield node;
    }

    item(index) {
        const children = this.#children;
        if (children.length > index)
            return children[index];
        if (this.#final)
            return null;
        let result;
        const iter = (this.#iter ??= this.#enumerate());
        while (index >= children.length) {
            result = iter.next();
            if (result.done) {
                this.#final = true;
                Object.freeze(this.#children);
                return null;
            }
            children.push(result.value);
        }
        return result.value;
    }

    /** @field [Symbol.unscopables] {} */
    get [Symbol.unscopables]() {
        return ReadonlyArrayUnscopables;
    }

    /** @field length {number} */
    get length() {
        const children = this.#children;
        if (this.#final)
            return children.length;
        let result;
        const iter = (this.#iter ??= this.#enumerate());
        for (; ;) {
            result = iter.next();
            if (result.done) {
                this.#final = true;
                break;
            }
            children.push(result.value);
        }
        return this.#children.length;
    }

    * [Symbol.iterator]() {
        for (let i = 0; ; ++i) {
            const result = this.item(i);
            if (result === null)
                break;
            yield result;
        }
    }

    [Symbol.toStringTag]() {
        // for compatibility with the other DOM parser implementations
        return 'HTMLCollection';
    }

    at(index) {
        return this.item(index);
    }

    concat(...items) {
        return [...this, ...items];
    }

    * entries() {
        for (let i = 0; ; ++i) {
            const result = this.item(i);
            if (result === null)
                break;
            yield [i, result];
        }
    }

    every(predicate, thisArg) {
        for (const node of this)
            if (!predicate.call(thisArg, node))
                return false;
        return true;
    }

    filter(predicate, thisArg) {
        const result = [];
        for (const node of this)
            if (predicate.call(thisArg, node))
                result.push(node);
        return result;
    }

    find(predicate, thisArg) {
        for (const node of this)
            if (predicate.call(thisArg, node))
                return node;
        return undefined;
    }

    findIndex(predicate, thisArg) {
        for (let i = 0; ; i++) {
            const node = this.item(i);
            if (node === null)
                break;
            if (predicate.call(thisArg, node))
                return i;
        }
        return -1;
    }

    findLast(predicate, thisArg) {
        // using length here populates the whole state, but predicate could be more expensive
        for (let i = this.length - 1; i >= 0; i--) {
            const node = this.item(i);
            if (node !== null && predicate.call(thisArg, node))
                return node;
        }
        return undefined;
    }

    findLastIndex(predicate, thisArg) {
        // using length here populates the whole state, but predicate could be more expensive
        for (let i = this.length - 1; i >= 0; i--) {
            const node = this.item(i);
            if (node !== null && predicate.call(thisArg, node))
                return i;
        }
        return -1;
    }

    * asFlat(depth) {
        // expand all child nodes and their child nodes, etc.
        for (const node of this) {
            yield node;
            if (depth > 0)
                yield* node.childNodes.asFlat(depth - 1);
        }
    }

    flat(depth) {
        // expand all child nodes and their child nodes, etc.
        return [...this.asFlat(depth)];
    }

    flatMap(callback, thisArg) {
        const iter = this.asFlat(1);
        const result = [];
        for (const node of iter)
            result.push(callback.call(thisArg, node));
        return result;
    }

    forEach(callback, thisArg) {
        for (const node of this)
            callback.call(thisArg, node);
    }

    includes(searchElement, fromIndex) {
        return this.indexOf(searchElement, fromIndex) >= 0;
    }

    indexOf(searchElement, fromIndex) {
        for (let i = fromIndex ?? 0; ; i++) {
            const node = this.item(i);
            if (node === null)
                break;
            if (node === searchElement)
                return i;
        }
        return -1;
    }

    join(separator) {
        // this is kinda dumb, but nobody should use this anyway
        return [...this].join(separator);
    }

    keys() {
        // this populates the whole state
        const keys = new Array(this.length);
        for (let i = 0; i < keys.length; i++)
            keys[i] = i;
    }

    lastIndexOf(searchElement, fromIndex) {
        // this populates the whole state
        for (let i = fromIndex ?? this.length - 1; i >= 0; i--) {
            const node = this.item(i);
            if (node === null)
                break;
            if (node === searchElement)
                return i;
        }
        return -1;
    }

    map(callback, thisArg) {
        const result = [];
        for (const node of this)
            result.push(callback.call(thisArg, node));
        return result;
    }

    reduce(callback) {
        let result;
        for (let i = 0; ; i++) {
            const node = this.item(i);
            if (node === null)
                break;
            result = callback(result, node, i, this);
        }
        return result;
    }

    reduceRight(callback) {
        // this populates the whole state
        let result;
        for (let i = this.length - 1; i >= 0; i--) {
            const node = this.item(i);
            if (node === null)
                break;
            result = callback(result, node, i, this);
        }
        return result;
    }

    slice(start, end) {
        const result = [];
        for (let i = start; i < end; i++) {
            const node = this.item(i);
            if (node === null)
                break;
            result.push(node);
        }
        return result;
    }

    some(predicate, thisArg) {
        for (const node of this)
            if (predicate.call(thisArg, node))
                return true;
        return false;
    }

    static #localeTag = Object.prototype.toLocaleString().replace('Object', 'HTMLCollection');

    toLocaleString() {
        return ChildElementsList.#localeTag;
    }

    toReversed() {
        return [...this].reverse();
    }

    toSorted(compare) {
        return [...this].sort(compare);
    }

    toSpliced(start, deleteCount, ...items) {
        const result = [...this];
        result.splice(start, deleteCount, ...items);
        return result;
    }

    toString() {
        return "[object HTMLCollection]";
    }

    values() {
        return this[Symbol.iterator]();
    }

    with(index, value) {
        return this.toSpliced(index, 1, value);
    }
}


/**
 * Create a new list-like proxy.
 *
 * @template T
 * @param {T} listLike
 * @returns {Proxy<T>
 */
function CreateListLikeProxy(listLike) {
    const targetBoundMethods = new Map();
    return new Proxy(listLike, {
        // handle array-like access
        get: (target, prop, receiver) => {
            switch (typeof prop) {
                case 'string':
                    if (isNumeric(prop))
                        return target.item(parseInt(prop, 10));
                // fallthrough
                default:
                    const item = target[prop];
                    if (item instanceof Function) {
                        const func = targetBoundMethods.get(prop);
                        if (func) return func;

                        if (!receiver) receiver = target;
                        const newFunc = function (...args) {
                            return item.call(this === receiver ? target : this, ...args);
                        };
                        targetBoundMethods.set(prop, newFunc);
                        return newFunc;
                    }
                    return item;
                case 'number':
                    return target.item(prop);
            }
        },
        // handle 'in' operator
        has: (target, prop) => {
            switch (typeof prop) {
                case 'string':
                    if (isNumeric(prop))
                        return target.item(parseInt(prop, 10)) !== null;
                    break;
                case 'number':
                    return target.item(prop) !== null;
                default:
                    return prop in target;
            }
        },
        getOwnPropertyDescriptor: (target, prop) => {
            switch (typeof prop) {
                case 'number':
                    const value = target.item(prop);
                    if (value === null)
                        return undefined;
                    return {value, writable: false, enumerable: true, configurable: false};
                case 'string':
                    if (isNumeric(prop)) {
                        const index = parseInt(prop, 10);
                        const value = target.item(index);
                        if (value === null)
                            return undefined;
                        return {value, writable: false, enumerable: true, configurable: false};
                    }
                // fallthrough
                default:
                    return Reflect.getOwnPropertyDescriptor(target, prop);
            }
        },
        ownKeys: (target) => {
            const keys = [];
            for (let i = 0; ; ++i) {
                if (target.item(i) === null)
                    break;
                keys.push(i.toString());
            }
            return keys;
        },
        getPrototypeOf(target) {
            return ChildElementsList.prototype;
        },
        setPrototypeOf(target, v) {
            return false;
        },
        set: (target, prop, value) => {
            return false;
        },
        defineProperty(target, property, attributes) {
            return false;
        },
        deleteProperty(target, p) {
            return false;
        },
        preventExtensions(target) {
            return false;
        },
        isExtensible(target) {
            return false;
        }
    });
}

const ReadonlyArrayUnscopables = Object.freeze(Object.assign(Object.create(null), {
    at: true,
    entries: true,
    find: true,
    findIndex: true,
    findLast: true,
    findLastIndex: true,
    flat: true,
    flatMap: true,
    includes: true,
    keys: true,
    toReversed: true,
    toSorted: true,
    toSpliced: true,
    values: true
}));

const NodeTypeToDeserializer = new Map([
    [/*Comment*/ 8, ({
                         ownerDocument,
                         nodeIndex,
                         startOffset,
                         xmlFragment
                     }) => new Comment(ownerDocument, nodeIndex, {index: startOffset, "0": xmlFragment})],
    [/*DocumentType*/ 10, ({
                               ownerDocument,
                               nodeIndex,
                               startOffset,
                               xmlFragment
                           }) => new DocumentType(ownerDocument, nodeIndex, {index: startOffset, "0": xmlFragment})],
    [/*Element*/ 1, ({
                         ownerDocument,
                         nodeIndex,
                         startOffset,
                         xmlFragment
                     }) => new Element(ownerDocument, nodeIndex, {
        index: startOffset,
        "0": xmlFragment
    }).finalize(xmlFragment)],
    [/*ProcessingInstruction*/ 7, ({
                                       ownerDocument,
                                       nodeIndex,
                                       startOffset,
                                       xmlFragment
                                   }) => new ProcessingInstruction(ownerDocument, nodeIndex, {
        index: startOffset,
        "0": xmlFragment
    })],
    [/*Text*/ 3, ({
                      ownerDocument,
                      nodeIndex,
                      startOffset,
                      xmlFragment
                  }) => new Text(ownerDocument, nodeIndex, {index: startOffset, "0": xmlFragment})]
]);

/**
 * Register the DOM classes with CBOR-X.
 *
 * The default tag is 40501, but that may be overridden.
 *
 * @param {import('cbor-x').addExtension} cborAddExtension
 * @param {number?} tag
 * @return {void}
 */
export function RegisterWithCborX(cborAddExtension, tag) {
    if (!tag) tag = 40501;
    cborAddExtension({
        tag: tag++,
        Class: Document,
        encode(instance, encode) {
            const data = structuredClone(instance);
            for (let i = 0; i < data.nodes.length; i++)
                data.nodes[i]['$nodeType'] = instance.nodes[i].nodeType;
            encode(data);
        },
        decode({nodes, options}) {
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                const des = NodeTypeToDeserializer.get(node['$nodeType']);
                if (!des) throw new Error('Unknown node type');
                nodes[i] = des(node);
            }
            return new Document(nodes, options);
        }
    });
    cborAddExtension({
        tag: tag++,
        Class: Comment,
        encode(instance, encode) {
            encode(structuredClone(instance));
        },
        decode({ownerDocument, nodeIndex, startOffset, xmlFragment}) {
            return new Comment(ownerDocument, nodeIndex, {index: startOffset, "0": xmlFragment});
        }
    });
    cborAddExtension({
        tag: tag++,
        Class: DocumentType,
        encode(instance, encode) {
            encode(structuredClone(instance));
        },
        decode({ownerDocument, nodeIndex, startOffset, xmlFragment}) {
            return new DocumentType(ownerDocument, nodeIndex, {index: startOffset, "0": xmlFragment});
        }
    });
    cborAddExtension({
        tag: tag++,
        Class: Element,
        encode(instance, encode) {
            encode(structuredClone(instance));
        },
        decode({ownerDocument, nodeIndex, startOffset, xmlFragment}) {
            return new Element(ownerDocument, nodeIndex, {index: startOffset, "0": xmlFragment}).finalize(xmlFragment);
        }
    });
    cborAddExtension({
        tag: tag++,
        Class: ProcessingInstruction,
        encode(instance, encode) {
            encode(structuredClone(instance));
        },
        decode({ownerDocument, nodeIndex, startOffset, xmlFragment}) {
            return new ProcessingInstruction(ownerDocument, nodeIndex, {index: startOffset, "0": xmlFragment});
        }
    });
    cborAddExtension({
        tag: tag++,
        Class: Text,
        encode(instance, encode) {
            encode(structuredClone(instance));
        },
        decode({ownerDocument, nodeIndex, startOffset, xmlFragment}) {
            return new Text(ownerDocument, nodeIndex, {index: startOffset, "0": xmlFragment});
        }
    });
}