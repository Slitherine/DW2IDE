/**
 * Calls the specified function and returns its result, or the specified default value if the function throws an error.
 * @template T
 * @template D
 * @param func {function|CallableFunction<any,T>}
 * @param defaultValue {D}
 * @returns {T|D}
 */
export function tryOrDefault(func, defaultValue) {
    try {
        return func();
    } catch {
        return defaultValue;
    }
}

/**
 * Calls the specified function and returns its result, or the specified default value if the function throws an error.
 * @template T
 * @template D
 * @param func {function|CallableFunction<Promise<T>>}
 * @param defaultValue {D}
 * @returns {Promise<T>|D}
 */
export async function tryAwaitOrDefault(func, defaultValue) {
    try {
        return await func();
    } catch {
        return defaultValue;
    }
}