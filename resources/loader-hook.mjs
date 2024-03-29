export async function initialize() {
    // Receives data from `register`.
    debugger;
    console.log('initialize', number, port);
}

export async function resolve(specifier, context, nextResolve) {
    // Take an `import` or `require` specifier and resolve it to a URL.
    debugger;
    console.log('resolve', specifier, context, nextResolve);
    return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
    // Take a resolved URL and return the source code to be evaluated.
    debugger;
    console.log('load', url, context, nextLoad);
    return nextLoad(url, context);
}