import {app, BrowserWindow, session} from 'electron/main';
import extensionInstaller, {VUEJS_DEVTOOLS} from 'electron-devtools-assembler';
import {AppDw2IdeClrProtocolHandler, AppDw2IdeProtocolHandler, InstallProtocolHandler} from './scheme-custom.js';
import {CreateWindowAsync, RegisterWindowingIpcHandlers} from "./windowing.js";

if (!app.requestSingleInstanceLock()) {
    app.exit(0);
}

const installExtension = 'default' in extensionInstaller
    ? extensionInstaller['default']
    : extensionInstaller;

//import * as url from 'url';
//const cwd = url.fileURLToPath(new URL('.', import.meta.url));

console.log("Waiting for app to be ready...");

function addCommandLineArguments(...args) {
    for (const arg of args) {
        if (Array.isArray(arg)) {
            if (arg.length > 2) {
                // concat args after 2nd with comma
                app.commandLine.appendSwitch(arg[0], arg.slice(1).join(','));
            }
            app.commandLine.appendSwitch(arg[0], arg[1]);
        }
        app.commandLine.appendSwitch(arg);
    }
}

addCommandLineArguments(
    // gpu stuff
    "enable-gpu-rasterization",
    "enable-zero-copy",
    "enable-begin-frame-scheduling",
    ["use-gl", "angle"],
    ["use-angle", "d3d11"],

    "enable-viewport",
    "autoplay-policy=no-user-gesture-required",
    "allow-pre-commit-input",
    "no-first-run",
    "no-proxy-server",
    "no-crash-upload",
    "no-default-browser-check",
    "no-pings",
    "no-startup-window",
    "no-service-autorun",
    "no-vr-runtime",
    "noerrdialogs",
    "disable-component-update",
    "no-report-upload",
    "disable-background-networking",
    "disable-boot-animation",
    "disable-cloud-import",
    "disable-component-cloud-policy",
    "disable-default-apps",
    "disable-infobars",
    "enable-quic",
    "enable-font-antialiasing",
    "enable-webassembly-baseline",
    "enable-webassembly-lazy-compilation",
    "enable-webassembly-tiering",
    "ppapi-antialiased-text-enabled",
    "enable-partial-raster",
    "disable-breakpad",
    "disable-crash-reporter",
    "enable-unsafe-webgpu",
    ["enable-features",
        "RawDraw", "DirectSockets",
        "CalculateNativeWinOcclusion", // the heck
        "ChromeLabs", "FontAccess", "VariableCOLRV1", // very handy
        "PrintWithReducedRasterization", // fast pdf production?
        "V8VmFuture", // javascript features
        "GpuRasterization", "UiGpuRasterization", // gpu stuff
        "EnableZeroCopyTabCapture",
        "DXGIWaitableSwapChain:DXGIWaitableSwapChainMaxQueuedFrames/3",
        "FluentScrollbar", "OverlayScrollbar", "SharedZstd",
        "JavaScriptExperimentalSharedMemory"],
    ["enable-blink-features",
        "DirectSockets",
        "AbortSignalAny", "Accelerated2dCanvas", "AcceleratedSmallCanvases", "AnimationWorklet", "CLSScrollAnchoring",
        "CSSAnchorPositioning", "CSSAnimationComposition", "CSSCalcSimplificationAndSerialization", "CSSColor4",
        "CSSColorContrast", "CSSColorContrast", "CSSColorTypedOM", "CSSDisplayAnimation", "CSSEnumeratedCustomProperties",
        "CSSFocusVisible", "CSSFoldables", "CSSFontFaceAutoVariableRange", "CSSFontFaceSrcTechParsing", "CSSFontSizeAdjust",
        "CSSGridTemplatePropertyInterpolation", "CSSHexAlphaColor", "CSSHyphenateLimitChars", "CSSIcUnit", "CSSImageSet",
        "CSSIndependentTransformProperties", "CSSInitialLetter", "CSSLastBaseline", "CSSLayoutAPI", "CSSLhUnit", "CSSLogical",
        "CSSLogicalOverflow", "CSSMarkerNestedPseudoElement", "CSSMixBlendModePlusLighter", "CSSNesting", "CSSObjectViewBox",
        "CSSOffsetPathRay", "CSSOffsetPathRayContain", "CSSOffsetPositionAnchor", "CSSOverflowForReplacedElements",
        "CSSPaintAPIArguments", "CSSPictureInPicture", "CSSPseudoPlayingPaused", "CSSScope", "CSSScrollbars",
        "CSSSelectorNthChildComplexSelector", "CSSToggles", "CSSTrigonometricFunctions", "CSSVariables2ImageValues",
        "CSSVariables2TransformValues", "CSSVideoDynamicRangeMediaQueries", "CSSViewportUnits4", "Canvas2dImageChromium",
        "Canvas2dLayers", "Canvas2dScrollPathIntoView", "CanvasFloatingPoint", "CanvasHDR", "CanvasImageSmoothing",
        "ClipboardCustomFormats", "ClipboardSvg", "ClipboardSvg", "CoepReflection", "CompositeBGColorAnimation",
        "CompositeBGColorAnimation", "CompositeBoxShadowAnimation", "CompositeClipPathAnimation", "CompositedSelectionUpdate",
        "ComputePressure", "ContextMenu", "ContextMenu", "CooperativeScheduling", "DisplaySurfaceConstraint",
        "DocumentPictureInPictureAPI", "EditContext", "ExtendedTextMetrics", "ExtraWebGLVideoTextureMetadata",
        "FencedFramesAPIChanges", "FontAccess", "FontVariantPosition", "HTMLPopoverAttribute", "HTMLSelectMenuElement",
        "InnerHTMLParserFastpath", "MediaCapabilitiesDynamicRange", "MediaCapabilitiesEncodingInfo",
        "MediaCapabilitiesSpatialAudio", "PageFreezeOptOut", "SanitizerAPI", "ScrollEndEvents", "ScrollOverlapOptimization",
        "ScrollbarWidth", "SecurePaymentConfirmationOptOut", "SendMouseEventsDisabledFormControls", "SharedArrayBuffer",
        "SharedArrayBufferOnDesktop", "SharedArrayBufferUnrestrictedAccessAllowed", "TextFragmentAPI",
        "UnrestrictedSharedArrayBuffer", "WebAnimationsSVG", "WebCodecs", "WebCryptoCurve25519",
        "WebFontResizeLCP", "WebGLDraftExtensions", "WebGLDraftExtensions", "WebGPU", "WebGPUDeveloperFeatures",
        "WebGPUImportTexture", "WebHID", "WebHIDOnServiceWorkers", "WebKitScrollbarStyling", "WebSocketStream",
        "WindowDefaultStatus", "ZeroCopyTabCapture"],
    ["default-background-color", "00000000"],
    ["blink-settings",
        "spellCheckEnabledByDefault=false", "hideDownloadUI=true", "mediaControlsEnabled=false",
        "prefersReducedMotion=false", "acceleratedCompositingEnabled=true"],
    ["restricted-api-origins", "app://dw2ide", "app://clr.dw2ide"],
    ["enable-dawn-features", "allow_unsafe_apis"],
// workaround for issue https://github.com/electron/electron/issues/38790
    ['disable-features', 'WidgetLayering',
        "UseDMSAAForTiles"],
);

await InstallProtocolHandler('app', new Map([
        ['dw2ide', AppDw2IdeProtocolHandler],
        ['clr.dw2ide', AppDw2IdeClrProtocolHandler]
    ]),
    {
        standard: true,
        secure: true,
        corsEnabled: true,
        allowServiceWorkers: true,
        supportFetchAPI: true
    });
/*
await InstallProtocolHandler('node', new Map([
        ['*', NodeProtocolHandler],
    ]),
    {
        standard: false,
        secure: true,
        corsEnabled: true,
        allowServiceWorkers: true,
        supportFetchAPI: true
    });*/


const ContentSecurityPolicy
    = `default-src 'none';` // on the outset, nothing is allowed
    + `script-src-elem * node:;` // TODO: strict-dynamic, nonce and filling in nonce values on script refs
    + `style-src-elem 'self' 'unsafe-inline';`
    + `img-src 'self' blob: data:;`
    + `font-src 'self';`
    + `manifest-src 'self';`
;
app.prependOnceListener('ready', async () => {

    console.log("App is ready.");

    RegisterWindowingIpcHandlers();

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': ContentSecurityPolicy
            }
        });
    });

    try {
        console.log("Loading Vue.js 3 dev tools...");
        const vueJsExtName = await installExtension(VUEJS_DEVTOOLS);
        console.log(`Added Extension:  ${vueJsExtName}`);

    } catch (err) {
        console.log('An error occurred: ', err);
        if (err instanceof TypeError) {
            console.log("installExtension:", installExtension);
        }
    }

    await CreateWindowAsync('app://dw2ide/index.html', 800, 600, 'app://dw2ide/preload.mjs');

    // handle activation
    app.on('activate', async () => {
        console.log("Activate event triggered.");
        // re-create a window if none exists?
        if (BrowserWindow.getAllWindows().length !== 0)
            return;

        await CreateWindowAsync('app://dw2ide/index.html', 800, 600, 'app://dw2ide/preload.mjs');
    });

    // handle second instance, ensure single-instance and focus on window
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        console.log("Second-instance event triggered.");
        const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        if (!window) return;
        window.restore();
        window.focus();
    });

    // handle window-all-closed
    app.on('window-all-closed', () => {
        console.log("Window-all-closed event triggered.");
        // because mac has a menu bar still active?
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
});