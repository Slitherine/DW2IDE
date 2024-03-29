import {ipcMain as ipc} from 'electron';
import * as inspector from 'node:inspector/promises';

export function RegisterUnlockInternalsIpcHandler() {

    // map of webContents to debuggerId
    const ipcReplayBreakMap = new Map();

    ipc.handle('unlock-internals', async (event, arg) => {
        try {
            const webContents = event.sender;
            //console.log("unlock-internals", event, arg);
            console.log("unlock-internals", webContents.id, webContents.getURL());

            // uses the debugger to create a breakpoint in the realm script,
            // this will wait until require is called on an internal module,
            // then evaluates BuiltinModule.exposeInternals() inside the paused context
            // seamlessly
            async function actuallyUnlockInternals(readyToReturnResolve) {
                const dbg = webContents.debugger;
                const reopenDevTools = webContents.isDevToolsOpened();
                if (reopenDevTools)
                    webContents.closeDevTools();
                if (!dbg.isAttached())
                    dbg.attach();
                let debuggerId = null;
                const scriptUrlToId = new Map();
                //const scriptIdToExecCtx = new Map();
                let debuggerPausedResolver = null;
                let debuggerPausedPromise = new Promise
                ((resolve) => debuggerPausedResolver = resolve);

                function DebuggerMessageHandler(event, method, params) {
                    //console.log("unlock-internals message", event, method, params);
                    switch (method) {
                        case 'Debugger.scriptParsed':
                            /*scriptIdToExecCtx.set(params.scriptId, {
                                url: params.url,
                                executionContextId: params.executionContextId,
                                ...params.executionContextAuxData
                            });*/
                            if (params.url === "")
                                break;
                            scriptUrlToId.set(params.url, params.scriptId);
                            break;
                        case 'Debugger.paused':
                            //console.log("Debugger.paused", event, method, params);
                            debuggerPausedResolver({event, method, params});
                            debuggerPausedPromise = new Promise
                            ((resolve) => debuggerPausedResolver = resolve);
                            break;
                        default:
                            console.warn("unhandled unlock-internals message", method, params);
                    }
                }

                dbg.on('message', DebuggerMessageHandler);
                const debuggerObj = await dbg.sendCommand('Debugger.enable');
                debuggerId = debuggerObj.debuggerId;
                //console.log("debuggerId", debuggerId);
                const otherDebuggerId = ipcReplayBreakMap.get(webContents);
                if (otherDebuggerId === debuggerId) {
                    console.warn("unlock-internals already enabled for this webContents, potential ipc replay");
                    readyToReturnResolve();
                    return;
                }
                ipcReplayBreakMap.set(webContents, debuggerId);
                await dbg.sendCommand('Debugger.setPauseOnExceptions', {state: "none"});
                let breakpointInfo = null;
                try {
                    const realmScriptId = scriptUrlToId.get("node:internal/bootstrap/realm");
                    //const {scriptSource} = await dbg.sendCommand('Debugger.getScriptSource', {scriptId: realmScriptId});
                    //console.log("scriptSource", scriptSource);
                    //console.log("realmScriptId", realmScriptId);
                    const {result: matches} = await dbg.sendCommand("Debugger.searchInContent", {
                        scriptId: realmScriptId,
                        query: "static canBeRequiredByUsers(id)",
                        caseSensitive: true
                    });
                    //console.log("matches", matches);
                    if (!matches || matches.length === 0)
                        throw new Error("can't find 'static canBeRequiredByUsers(id)' in realm script");
                    const nextLine = matches[0].lineNumber + 1;
                    breakpointInfo = await dbg.sendCommand('Debugger.setBreakpoint', {
                        location: {
                            scriptId: realmScriptId,
                            lineNumber: nextLine,
                            columnNumber: 0
                        }
                    });
                    await dbg.sendCommand('Debugger.setBreakpointsActive', {active: true});
                    //console.log("breakpointInfo", breakpointInfo);
                    readyToReturnResolve();
                    const pausedEvent = await debuggerPausedPromise;
                    //console.log("pausedEvent", pausedEvent);
                    const evalResult = await dbg.sendCommand('Debugger.evaluateOnCallFrame', {
                        callFrameId: pausedEvent.params.callFrames[0].callFrameId,
                        expression: "BuiltinModule.exposeInternals()"
                    });
                    //console.log("evalResult", evalResult);
                } catch (error) {
                    console.error("unlock-internals failed", error);
                }
                try {
                    await dbg.sendCommand('Debugger.setBreakpointsActive', {active: false});
                } catch {
                    console.warn("Debugger.setBreakpointsActive {active: false} failed");
                }
                if (breakpointInfo && 'breakpointId' in breakpointInfo) {
                    try {
                        await dbg.sendCommand('Debugger.removeBreakpoint', {breakpointId: breakpointInfo.breakpointId});
                    } catch {
                        console.warn("Debugger.removeBreakpoint failed");
                    }
                }
                //await dbg.sendCommand('Debugger.resume');
                //await dbg.sendCommand('Debugger.disable');
                dbg.off('message', DebuggerMessageHandler);
                dbg.detach();
                ipcReplayBreakMap.delete(webContents);
                if (reopenDevTools)
                    webContents.openDevTools();
                console.log("unlock-internals done");
            }


            let readyToReturnResolve = null;
            const readyToReturn = new Promise
            ((resolve) => readyToReturnResolve = resolve);

            actuallyUnlockInternals(readyToReturnResolve)
                .catch(console.error);

            await readyToReturn;
            return {};
        } catch (error) {
            console.error(error);
            return {};
        }
    });
}