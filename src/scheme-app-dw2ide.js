import path from "node:path";
import fs from "node:fs/promises";
import mime from "mime-types";
import {tryAwaitOrDefault} from "./helpers.js";
import http from 'node:http';
import {GetHttpErrorPageAsync} from './http-error-page-cache.js';
import {app} from 'electron/main';

import ResourcesPath from './resources-path.js';

export {AppDw2IdeClrProtocolHandler} from './scheme-app-dw2ide-clr.js';

const PreloadCssHeader = //language=text
    "<app://dw2ide/preload.css>; rel=preload; as=style";

function HandleHeadRequest(mimeType, stats) {
    const response = new Response(null, {
        status: 200,
        headers: {
            'Date': new Date().toUTCString(),
            'Content-Type': mimeType,
            'Content-Length': stats.size,
            'Last-Modified': stats.mtime.toUTCString(),
            'Cache-Control': 'public, max-age=31536000, must-revalidate',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes 0-${stats.size - 1}/${stats.size}`,
            'X-Content-Type-Options': 'nosniff'
        }
    });
    if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
        response.headers.append('Link', PreloadCssHeader);
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
                    'Content-Type': mimeType,
                    'Content-Length': stats.size,
                    'Last-Modified': stats.mtime.toUTCString(),
                    'Cache-Control': 'public, max-age=31536000, must-revalidate',
                    'Accept-Ranges': 'bytes',
                    'X-Content-Type-Options': 'nosniff'
                }
            });
            if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
                response.headers.append('Link', PreloadCssHeader);
            }
            return response;
        }
    }

    const fh = await fs.open(resolvedPath, 'r');

    /** @type number */
    let successStatusCode;

    /** @type import('node:fs').ReadStream */
    let stream;

    if (request.headers.has('range')) {
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
                stream = fh.createReadStream({start: rangeStart, end: rangeEnd, autoClose: true, encoding: 'binary'});
            }
        } else {
            return new Response("Bad Request", {status: 400});
        }
    } else {
        successStatusCode = 200;
        stream = fh.createReadStream({autoClose: true, encoding: 'binary'});
    }

    const response = new Response(stream, {
        status: successStatusCode,
        headers: {
            'Date': new Date().toUTCString(),
            'Content-Type': mimeType,
            'Content-Length': stats.size,
            'Last-Modified': stats.mtime.toUTCString(),
            'Cache-Control': 'public, max-age=31536000, must-revalidate',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${rangeStart}-${rangeEnd}/${stats.size}`,
            'X-Content-Type-Options': 'nosniff'
        }
    });
    if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') {
        response.headers.append('Link', PreloadCssHeader);
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
                'Content-Type': 'text/html'
            }
        });
    }

    return new Response(statusText, {
        status, statusText, headers: {
            'Content-Type': 'text/plain'
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

    return path.join(ResourcesPath, resolvedPath);
}

/**
 * @param {GlobalRequest} request
 * @param {URL} url
 * @returns {GlobalResponse|Promise<GlobalResponse>}
 */
export async function AppDw2IdeProtocolHandler(request, url) {

    let resolvedPath = ResolvePath(url);

    console.log("AppDw2IdeProtocolHandler: ", resolvedPath);

    const stats = await tryAwaitOrDefault(
        async () => await fs.stat(resolvedPath),
        null);

    if (stats === null)
        return await ErrorResponse(404); // Not Found

    if (stats.isFile()) {
        const mimeType = mime.lookup(resolvedPath);

        if (request.method === 'HEAD') {
            return HandleHeadRequest(mimeType, stats);
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