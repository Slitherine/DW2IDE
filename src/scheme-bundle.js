/**
 * @param {GlobalRequest} request
 * @param {URL} url
 * @returns {GlobalResponse|Promise<GlobalResponse>}
 */
export function BundleProtocolHandler(request, url) {
    console.log(`BundleHandler: ${url}`);




    return new Response("Not Implemented", {status: 501});
}