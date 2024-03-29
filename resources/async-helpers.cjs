/**
 * An async delaying function that uses setTimeout.
 *
 * @param ms
 * @returns {Promise<unknown>}
 */
async function asyncDelay(ms) {
    let canceller;
    const p = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(resolve, ms);
        canceller = () => {
            clearTimeout(timeoutId);
            reject(new Error('asyncDelay cancelled'));
        };
    });
    p.cancel = canceller;
    return p;
}

/**
 * An async idling function that uses requestIdleCallback.
 *
 * @returns {Promise<unknown>}
 */
async function asyncIdle() {
    return new Promise((resolve) => {
        requestIdleCallback(resolve);
    });
}

/**
 * An async synchronizing function that uses requestAnimationFrame.
 *
 * @returns {Promise<unknown>}
 */
async function asyncAnimationFrame() {
    return new Promise((resolve) => {
        requestAnimationFrame(resolve);
    });
}

/**
 * A yielding function that uses setImmediate.
 *
 * @returns {Promise<void>}
 */
async function asyncYield() {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

/**
 * A micro-yielding function that uses process.nextTick
 * if available, otherwise it returns a resolved Promise.
 *
 * @returns {Promise<void>}
 */
const asyncMicroYield =
    process ? async () => {
        return new Promise((resolve) => {
            process.nextTick(resolve);
        });
    } : () => Promise.resolve();

class Stopwatch {
    /**
     * the current time in milliseconds relative to Performance.timeOrigin
     * essentially a bound version of performance.now()
     * @type {function(): number}
     */
    static now = performance.now.bind(performance);

    /**
     * the time in milliseconds when the stopwatch was started
     * relative to Performance.timeOrigin
     * performance.now() is used to populate this value
     * @type {number}
     */
    #started = Stopwatch.now();

    /**
     * creates a new Stopwatch instance
     * @param {(number|Stopwatch)?} relativeOffset a relative starting offset in milliseconds
     */
    constructor(relativeOffset) {
        if (relativeOffset === undefined)
            return;
        if (Number.isFinite(relativeOffset))
            this.#started += relativeOffset;
        else if (relativeOffset instanceof Stopwatch)
            this.#started += relativeOffset.elapsed;
    }

    /**
     * the time in milliseconds when the stopwatch was started
     * relative to Performance.timeOrigin
     * performance.now() is used to populate this value
     * @type {number}
     */
    get started() {
        return this.#started;
    }

    /**
     * resets the stopwatch as though it was just started
     */
    restart() {
        this.#started = Stopwatch.now();
    }

    /**
     * the time in milliseconds since the stopwatch was started
     * @returns {number}
     */
    get elapsed() {
        return Stopwatch.now() - this.#started;
    }

    /**
     * waits until the elapsed time is greater than or equal to the
     * given time in milliseconds
     * @param ms {number} the time in milliseconds to wait for
     * @param highPrecision {boolean} if true, use micro-yielding to wait
     * @returns {Promise<void>} a Promise that resolves after the given time
     */
    async waitUntil(ms, highPrecision = false) {
        const target = this.#started + ms;
        const yieldTarget = target - 0.5;
        const timeoutTarget = target - 60;
        if (Stopwatch.now() < timeoutTarget)
            await asyncDelay(ms - 60);
        while (Stopwatch.now() < yieldTarget)
            await asyncYield();
        // close enough
        if (highPrecision) {
            // micro-yielding is essentially spinning using process.nextTick
            // which is considered the micro-task queue.
            //
            // Two nextTicks back-to-back are essentially the same as a single
            // nextTick but with more overhead, so this isn't necessarily the
            // best idea, but still allows for the possibility of something else
            // running in the micro-task queue, however unlikely
            while (Stopwatch.now() < target)
                await asyncMicroYield();
        }
    }

    /**
     * If the elapsed time is greater than the ms parameter,
     * restart the stopwatch and execute the callback, or
     * yield to the event loop if no callback is provided
     *
     * The purpose of this function is to simplify cooperative
     * multitasking on the shared event loop of the main thread
     *
     * NOTE: This still allocates a Promise object, so just inline the code
     *   of this method as a template for your own use cases where performance
     *   is a concern.
     * @param ms {number} the time in milliseconds to compare against
     * @param asyncCallback {(() => Promise|null)?} the async callback to call
     * @returns {Promise<void>} a Promise that resolves immediately or after yielding
     */
    async callbackAndRestartIfElapsed(ms, asyncCallback = null) {
        if (this.elapsed <= ms)
            return;
        this.restart();
        if (asyncCallback)
            await asyncCallback();
        else
            await asyncYield();
    }
}

if (typeof window !== 'undefined') {
    // browser environment
    window.asyncDelay = asyncDelay;
    window.asyncIdle = asyncIdle;
    window.asyncAnimationFrame = asyncAnimationFrame;
    window.asyncYield = asyncYield;
    window.Stopwatch = Stopwatch;
    window['asyncMicroYield'] = asyncMicroYield;
} else if (typeof global !== 'undefined') {
// Node.js environment
    global.asyncDelay = asyncDelay;
    global.asyncIdle = asyncIdle;
    global.asyncAnimationFrame = asyncAnimationFrame;
    global.asyncYield = asyncYield;
    global.Stopwatch = Stopwatch;
    global['asyncMicroYield'] = asyncMicroYield;
}

if ('exports' in module) {
    Object.assign(module.exports, {
        asyncDelay,
        asyncIdle,
        asyncAnimationFrame,
        asyncYield,
        asyncMicroYield,
        Stopwatch,
    });
}