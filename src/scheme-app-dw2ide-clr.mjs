/**
 * @param {GlobalRequest} request
 * @param {URL} url
 * @returns {GlobalResponse|Promise<GlobalResponse>}
 */
export function AppDw2IdeClrProtocolHandler(request, url) {
    console.log(`AppDw2IdeClrHandler: ${url}`);
    return new Response("Not Implemented", {status: 501});
}