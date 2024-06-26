import path from "node:path";
import fs from "node:fs/promises";
import mime from "mime-types";
import {tryAwaitOrDefault} from "./helpers.mjs";
import http from 'node:http';
import {GetHttpErrorPageAsync} from './http-error-page-cache.mjs';
import {app} from 'electron/main';
import {v4 as uuid} from 'uuid';

import ResourcesPath from './resources-path.mjs';
import {ipcMain as ipc} from 'electron';

export {AppDw2IdeClrProtocolHandler} from './scheme-app-dw2ide-clr.mjs';

const PreloadCssHeader = //language=text
    "<app://dw2ide/preload.css>; rel=preload; as=style";
const PreloadCssLinkHeader = //language=text
    "<app://dw2ide/preload.css>; rel=stylesheet; media=all"

function ContentTypeAppendCharset(mimeType) {
    switch (mimeType) {
        case 'text/plain':
        case 'text/css':
        case 'text/html':
        case 'text/xml':
        case 'application/json':
        case 'application/javascript':
        case 'application/xml':
        case 'application/xhtml+xml':
            return mimeType + '; charset=utf-8';
        default:
            return mimeType;
    }
}

function HandleHeadRequest(mimeType, stats, request) {
    const response = new Response(null, {
        status: 200,
        headers: {
            'Date': new Date().toUTCString(),
            'Content-Type': ContentTypeAppendCharset(mimeType),
            'Content-Length': stats.size,
            'Last-Modified': stats.mtime.toUTCString(),
            'Cache-Control': 'public, max-age=31536000, must-revalidate',
            'Accept-Ranges': 'bytes',
            'X-Content-Type-Options': 'nosniff'
        }
    });
    if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
        response.headers.append('Link', PreloadCssHeader);
        //response.headers.append('Link', PreloadCssLinkHeader);
    }
    return response;
}

async function HandleGetRequest(mimeType, stats, request, resolvedPath) {
    let rangeStart = 0;
    let rangeEnd = stats.size - 1;

    if (request.headers.has('if-modified-since')) {
        const ifModifiedSince = new Date(request.headers.get('if-modified-since'));
        if (ifModifiedSince >= stats.mtime) {
            const response = new Response(null, {
                status: 304,
                headers: {
                    'Date': new Date().toUTCString(),
                    'Content-Type': ContentTypeAppendCharset(mimeType),
                    'Content-Length': stats.size,
                    'Last-Modified': stats.mtime.toUTCString(),
                    'Cache-Control': 'public, max-age=31536000, must-revalidate',
                    'Accept-Ranges': 'bytes',
                    'X-Content-Type-Options': 'nosniff'
                }
            });
            if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
                response.headers.append('Link', PreloadCssHeader);
                //response.headers.append('Link', PreloadCssLinkHeader);
            }
            return response;
        }
    }

    const fh = await fs.open(resolvedPath, 'r');

    /** @type number */
    let successStatusCode;

    /** @type {import('node:fs').ReadStream|Buffer|ArrayBuffer|TypedArray|DataView|Blob} */
    let stream;

    const wantsRange = request.headers.has('range');
    if (wantsRange) {
        successStatusCode = 206; // Partial Content

        const ranges = request.headers.get('range')?.split(',');
        if (!ranges || ranges.length > 1) {
            // TODO: use multipart/byteranges ? Blob ? custom stream ?
            return new Response("Multiple Range Support Not Implemented", {status: 501}); // 416 ?
        }
        const range = ranges[0];
        if (range.startsWith('bytes=')) {
            const parts = range.substring(6).split("-", 2);
            if (parts.length > 2) {
                return new Response("Bad Request", {status: 400}); // 416 ?
            }
            rangeStart = parseInt(parts[0], 10);
            rangeEnd = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
            if (rangeStart > rangeEnd
                || rangeStart < 0
                || rangeEnd >= stats.size) {
                return new Response("Bad Request", {status: 400}); // 416 ?
            }

            if (rangeStart === rangeEnd) {
                stream = null;
            } else {
                //stream = fh.readableWebStream({type: 'bytes'});
                // TODO: something is up with this... needs testing
                stream = fh.createReadStream({start: rangeStart, end: rangeEnd, encoding: null});
            }
        } else {
            return new Response("Bad Request", {status: 400});
        }
    } else {
        successStatusCode = 200;
        stream = fh.createReadStream({encoding: null});
        /*const result = await fh.readFile({encoding: null});
        // convert to ArrayBuffer
        stream = new Uint8Array(result.buffer.buffer, 0, result.bytesRead);*/
    }

    const response = new Response(stream, {
        status: successStatusCode,
        headers: {
            'Date': new Date().toUTCString(),
            'Content-Type': ContentTypeAppendCharset(mimeType),
            'Content-Length': stats.size,
            'Last-Modified': stats.mtime.toUTCString(),
            'Cache-Control': 'public, max-age=31536000, must-revalidate',
            'Accept-Ranges': 'bytes',
            'X-Content-Type-Options': 'nosniff'
        }
    });
    if (wantsRange) {
        response.headers.append('Content-Range', `bytes ${rangeStart}-${rangeEnd}/${stats.size}`);
    }
    if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
        if (request.url !== 'app://dw2ide/background.html')
            response.headers.append('Link', PreloadCssHeader);
        //response.headers.append('Link', PreloadCssLinkHeader);
    }
    return response;
}

async function ErrorResponse(status, statusText) {
    //const errorPagePath = path.join(ResourcesPath, `errors/${status}.html`);
    if (status < 0 || (status >= 100 && status < 400) || status > 999)
        status = 500; // Internal Server Error
    if (statusText === null || statusText === undefined)
        statusText = http.STATUS_CODES[status];
    if (statusText === null || statusText === undefined)
        statusText = "Unknown Error";

    const errorPage = await GetHttpErrorPageAsync(status, statusText);

    if (errorPage !== null) {
        return new Response(errorPage, {
            status, statusText, headers: {
                'Content-Type': ContentTypeAppendCharset('text/html')
            }
        });
    }

    return new Response(statusText, {
        status, statusText, headers: {
            'Content-Type': ContentTypeAppendCharset('text/plain')
        }
    });
}

/**
 * Resolves the specified url to a path.
 * @param {URL} url - the url to resolve
 * @returns {string} the resolved path
 */
export function ResolvePath(url) {
    let resolvedPath = url.pathname;

    if (resolvedPath === null || resolvedPath === undefined) {
        resolvedPath = '/index.html';
    } else if (resolvedPath.endsWith('/')) {
        resolvedPath += 'index.html';
    }

    if (resolvedPath.startsWith('/node_modules/')) {
        return path.join(app.getAppPath(), resolvedPath);
    }

    // for debugging
    if (resolvedPath.startsWith('/min-maps/')) {
        return path.join(app.getAppPath(), "node_modules/monaco-editor", resolvedPath);
    }

    return path.join(ResourcesPath, resolvedPath);
}

/** @type {Map<string, string>} */
const HardCodedRedirects = new Map([
    ['app://dw2ide/base/browser/ui/codicons/codicon/codicon.css',
        'app://dw2ide/icons/codicon/codicon.css']
]);

/** @type {Map<string, {buffer:Uint8Array,type:string}>} */
const RegisteredBlobs = new Map();

/**
 * @param {GlobalRequest} request
 * @param {URL} url
 * @returns {GlobalResponse|Promise<GlobalResponse>}
 */
export async function AppDw2IdeProtocolHandler(request, url) {

    const hardCodedRedirect = HardCodedRedirects.get(url.pathname);
    if (hardCodedRedirect !== undefined) {
        return new Response(null, {
            status: 301,
            headers: {
                'Location': hardCodedRedirect
            }
        });
    }

    const registeredBlob = RegisteredBlobs.get(url.pathname);
    if (registeredBlob !== undefined) {
        return new Response(registeredBlob.buffer, {
            status: 200,
            headers: {
                'Content-Type': registeredBlob.type,
                'Cache-Control': 'public, max-age=31536000, must-revalidate',
                'X-Content-Type-Options': 'nosniff',
                // allow CORS
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Max-Age': '31536000'
            }
        });
    }

    let resolvedPath = ResolvePath(url);

    console.log("AppDw2IdeProtocolHandler: ", request.method, resolvedPath);

    const stats = await tryAwaitOrDefault(
        async () => await fs.stat(resolvedPath),
        null);

    if (stats === null)
        return await ErrorResponse(404); // Not Found

    if (stats.isFile()) {
        let mimeType = mime.lookup(resolvedPath);

        /*if (mimeType.startsWith('font/woff')) {
            mimeType = 'application/font-woff'
                + mimeType.slice(9);
        }*/

        if (request.method === 'HEAD') {
            return HandleHeadRequest(mimeType, stats, request);
        } else if (request.method === 'GET') {
            return await HandleGetRequest(mimeType, stats, request, resolvedPath);
        } else {
            return await ErrorResponse(405); // Method Not Allowed
        }
    } else if (stats.isDirectory()) {
        return await ErrorResponse(403); // Forbidden
    }

    if (stats.isBlockDevice() || stats.isCharacterDevice() || stats.isFIFO() || stats.isSocket())
        return await ErrorResponse(501, "Not Supported");

    if (await stats.exists()) {
        debugger; // what else could it be? a device, fifo, junction, pipe, etc.?
        return await ErrorResponse(501); // Not Implemented
    }
}


export function RegisterAppDw2IdeIpcHandler() {
    ipc.handle('register-blob', async (event, arg) => {
        const path = "/blob/" + uuid();
        RegisteredBlobs.set(path, arg);
        return "app://dw2ide" + path;
    });
}