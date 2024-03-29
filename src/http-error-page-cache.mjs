import fs from 'fs/promises';
import path from 'node:path';

import ResourcesPath from './resources-path.mjs';

/** @type {Map<number, string|null>} */
export const ErrorPageCache = new Map();

/** @type {string|null|undefined} */
export let AnyErrorPage = undefined;

async function GetAnyHttpErrorPageAsync(status, statusText) {
    if (AnyErrorPage === undefined) {
        const anyErrorPagePath = path.join(ResourcesPath, `errors/any.html`);
        try {
            const anyErrorPageStats = await fs.stat(anyErrorPagePath);
            if (anyErrorPageStats.isFile()) {
                AnyErrorPage = await fs.readFile(anyErrorPagePath, 'utf-8');
            } else {
                AnyErrorPage = null;
            }
        } catch {
            AnyErrorPage = null;
        }
    }
    return AnyErrorPage !== null
        ? FormatContent(AnyErrorPage, status, statusText)
        : null;
}

function FormatContent(errorPage, status, statusText) {
    return errorPage
        .replace(/\[\[status]]/g, status.toString())
        .replace(/\[\[statusText]]/g, statusText);
}

/**
 * Gets the error page for the specified status code.
 * @param status {number} - the status code
 * @param statusText {string?} - the status text
 * @returns {Promise<string>} - the error page content
 */
export async function GetHttpErrorPageAsync(status, statusText) {
    if (ErrorPageCache.has(status))
        return ErrorPageCache.get(status);

    const errorPagePath = path.join(ResourcesPath, `errors/${status}.html`);
    try {
        const stats = await fs.stat(errorPagePath);
        if (stats.isFile()) {
            const errorPage = await fs.readFile(errorPagePath, 'utf-8');
            ErrorPageCache.set(status, errorPage);
            return FormatContent(errorPage, status, statusText);
        } else {
            ErrorPageCache.set(status, null);

            return await GetAnyHttpErrorPageAsync(status, statusText);
        }
    } catch (e) {
        console.error(e);
        ErrorPageCache.set(status, null);
        return await GetAnyHttpErrorPageAsync(status, statusText);
    }
}