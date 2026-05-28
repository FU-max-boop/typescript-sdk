/**
 * Protocol-layer tests: cancellation, errors, progress, timeouts, custom methods.
 *
 * Tests covering the request/response lifecycle independent of specific MCP
 * features like tools or resources. Most test both McpServer and raw Server
 * via the requirement's tier map.
 */

import { expect, vi } from 'vitest';
import { z } from 'zod/v4';

import { Client } from '../../../src/client/index.js';
import { InMemoryTransport } from '../../../src/inMemory.js';
import { Server } from '../../../src/server/index.js';
import { McpServer } from '../../../src/server/mcp.js';
import {
    type CallToolRequest,
    CallToolRequestSchema,
    ErrorCode,
    type JSONRPCMessage,
    type JSONRPCNotification,
    type JSONRPCRequest,
    ListRootsRequestSchema,
    ListRootsResultSchema,
    ListToolsRequestSchema,
    McpError,
    type Notification,
    NotificationSchema,
    PingRequestSchema,
    type Progress,
    PromptListChangedNotificationSchema,
    type RequestId,
    RequestSchema,
    ResultSchema,
    ToolListChangedNotificationSchema
} from '../../../src/types.js';

import { wire } from '../helpers/index.js';
import type { TestArgs } from '../types.js';

const newClient = () => new Client({ name: 'c', version: '0' });

/** Raw {@link Server} factory whose tools/list never resolves — for timeout / connection-closed tests. */
function neverRespondingServer(): Server {
    const s = new Server({ name: 's', version: '0' }, { capabilities: { tools: {} } });
    s.setRequestHandler(
        ListToolsRequestSchema,
        () =>
            new Promise(() => {
                /* never resolves */
            })
    );
    return s;
}

const isRequest = (m: JSONRPCMessage): m is JSONRPCRequest => 'method' in m && 'id' in m;
const isNotification = (m: JSONRPCMessage): m is JSONRPCNotification => 'method' in m && !('id' in m);

/**
 * Tap `client.transport.send` so every outbound JSON-RPC message is recorded.
 * Call after `wire()` so the transport is set.
 */
function tapOutbound(client: Client): JSONRPCMessage[] {
    const out: JSONRPCMessage[] = [];
    const tx = client.transport;
    if (!tx) throw new Error('tapOutbound: client not connected');
    const orig = tx.send.bind(tx);
    tx.send = async (m, opts) => {
        out.push(m);
        return orig(m, opts);
    };
    return out;
}

export async function protocolCancelAbortSignal({ transport }: TestArgs) {
    const stalled: Array<() => void> = [];
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool(
            'echo',
            { inputSchema: z.object({ text: z.string() }) },
            async ({ text }, extra) =>
                new Promise(resolve => {
                    const t = setTimeout(() => resolve({ content: [{ type: 'text', text }] }), 60_000);
                    t.unref();
                    stalled.push(() => {
                        clearTimeout(t);
                        resolve({ content: [{ type: 'text', text: 'late' }] });
                    });
                    extra.signal.addEventListener('abort', () => {
                        clearTimeout(t);
                    });
                })
        );
        return s;
    };
    const client = newClient();
    await using _ = await wire(transport, makeServer, client);

    const outbound: JSONRPCMessage[] = [];
    const originalSend = client.transport!.send.bind(client.transport!);
    client.transport!.send = async m => {
        outbound.push(m);
        return originalSend(m);
    };

    const controller = new AbortController();
    const call = client.callTool({ name: 'echo', arguments: { text: 'never' } }, undefined, {
        signal: controller.signal
    });
    call.catch(() => {});

    await vi.waitFor(() => outbound.some(m => 'method' in m && m.method === 'tools/call'));
    const callMsg = outbound.find(
        (m): m is Extract<JSONRPCMessage, { method: string; id: RequestId }> => 'method' in m && m.method === 'tools/call' && 'id' in m
    )!;

    controller.abort('user requested cancellation');

    await expect(call).rejects.toThrow(/user requested cancellation/);

    await vi.waitFor(() => outbound.some(m => 'method' in m && m.method === 'notifications/cancelled'));
    const cancelled = outbound.find(m => 'method' in m && m.method === 'notifications/cancelled') as {
        id?: RequestId;
        params?: { requestId?: RequestId; reason?: string };
    };

    expect(cancelled).not.toHaveProperty('id');
    expect(cancelled.params?.requestId).toBe(callMsg.id);
    expect(cancelled.params?.reason).toContain('user requested cancellation');
}

export async function protocolCancelHandlerAbortPropagates({ transport }: TestArgs) {
    const aborts: Array<{ requestId: RequestId; reason: unknown }> = [];
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool(
            'cancellable',
            { inputSchema: z.object({}) },
            async (_a, extra) =>
                new Promise((resolve, reject) => {
                    extra.signal.addEventListener('abort', () => {
                        aborts.push({ requestId: extra.requestId, reason: extra.signal.reason });
                        reject(new Error(extra.signal.reason));
                    });
                })
        );
        return s;
    };
    const client = newClient();
    await using _ = await wire(transport, makeServer, client);

    const ac = new AbortController();
    const call = client.callTool({ name: 'cancellable', arguments: {} }, undefined, { signal: ac.signal });
    call.catch(() => {});

    await new Promise(resolve => setTimeout(resolve, 50));

    ac.abort(new Error('user cancelled'));

    await expect(call).rejects.toThrow('user cancelled');

    await vi.waitFor(() => expect(aborts.length).toBeGreaterThan(0));

    // Server-side signal.reason carries the cancellation reason text from the
    // notifications/cancelled the client sent (possibly wrapped).
    expect(String(aborts[0].reason)).toContain('user cancelled');
}

export async function protocolCancelInitializeNotCancellable(_: TestArgs) {
    // This test must tap outbound messages BEFORE connect() completes (to see the
    // initialize request and any cancelled notification). wire() awaits connect, so
    // it can't be used here. Tested on inMemory only — the behavior is in
    // shared/protocol.ts and is transport-agnostic.
    const [clientTx] = InMemoryTransport.createLinkedPair();
    // No server attached: initialize will hang, giving us a window to abort.

    const outbound: JSONRPCMessage[] = [];
    const origSend = clientTx.send.bind(clientTx);
    clientTx.send = async (m, opts) => {
        outbound.push(m);
        return origSend(m, opts);
    };

    const client = newClient();
    const ac = new AbortController();
    const connecting = client.connect(clientTx, { signal: ac.signal });
    connecting.catch(() => {});

    await vi.waitFor(() => expect(outbound.filter(isRequest).some(m => m.method === 'initialize')).toBe(true));
    const initReq = outbound.filter(isRequest).find(m => m.method === 'initialize');
    expect(initReq?.id).toBeDefined();

    ac.abort(new Error('user aborted connect'));
    await expect(connecting).rejects.toThrow();

    await new Promise(resolve => setTimeout(resolve, 50));

    const cancelledForInit = outbound
        .filter(isNotification)
        .filter(m => m.method === 'notifications/cancelled' && m.params?.requestId === initReq?.id);
    expect(cancelledForInit).toEqual([]);

    await client.close();
}

export async function protocolCancelLateResponseIgnored({ transport }: TestArgs) {
    const stalled: Array<() => void> = [];
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool(
            'echo',
            { inputSchema: z.object({ text: z.string() }) },
            async ({ text }) =>
                new Promise(resolve => {
                    const t = setTimeout(() => resolve({ content: [{ type: 'text', text }] }), 60_000);
                    t.unref();
                    stalled.push(() => {
                        clearTimeout(t);
                        resolve({ content: [{ type: 'text', text: 'late' }] });
                    });
                })
        );
        return s;
    };
    const client = newClient();
    await using _ = await wire(transport, makeServer, client);

    const outbound: JSONRPCMessage[] = [];
    const originalSend = client.transport!.send.bind(client.transport!);
    client.transport!.send = async m => {
        outbound.push(m);
        return originalSend(m);
    };

    const errors: Error[] = [];
    client.onerror = e => errors.push(e);

    const ac = new AbortController();
    const call = client.callTool({ name: 'echo', arguments: { text: 'late' } }, undefined, { signal: ac.signal });
    call.catch(() => {});

    await vi.waitFor(() => outbound.some(m => 'method' in m && m.method === 'tools/call'));
    const callReq = outbound.find(
        (m): m is Extract<JSONRPCMessage, { method: string; id: RequestId }> => 'method' in m && m.method === 'tools/call' && 'id' in m
    )!;
    const callId = callReq.id;

    ac.abort(new Error('user cancelled'));

    await vi.waitFor(() => outbound.some(m => 'method' in m && m.method === 'notifications/cancelled'));

    await expect(call).rejects.toThrow('user cancelled');

    const lateResponse: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: callId,
        result: { content: [{ type: 'text', text: 'late' }] }
    };
    client.transport!.onmessage?.(lateResponse);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(errors).toEqual([]);

    await expect(client.ping()).resolves.toBeDefined();
}

export async function protocolCancelUnknownIdIgnored({ transport }: TestArgs) {
    const errors: Error[] = [];
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.server.onerror = e => errors.push(e);
        s.registerTool('echo', { inputSchema: z.object({ text: z.string() }) }, ({ text }) => ({
            content: [{ type: 'text', text }]
        }));
        return s;
    };
    const client = newClient();
    await using _ = await wire(transport, makeServer, client);

    const result = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    expect(result.content).toEqual([{ type: 'text', text: 'hi' }]);

    await expect(
        client.notification({
            method: 'notifications/cancelled',
            params: { requestId: 99999, reason: 'unknown numeric id' }
        })
    ).resolves.toBeUndefined();

    await expect(
        client.notification({
            method: 'notifications/cancelled',
            params: { requestId: 'never-issued-abc', reason: 'unknown string id' }
        })
    ).resolves.toBeUndefined();

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(errors).toEqual([]);

    await expect(client.ping()).resolves.toBeDefined();
}

export async function protocolErrorConnectionClosed({ transport }: TestArgs) {
    const client = newClient();
    await using _ = await wire(transport, neverRespondingServer, client);

    const onclose = vi.fn();
    client.onclose = onclose;

    const inFlight = [client.listTools(), client.listTools(), client.listTools()];
    for (const p of inFlight) p.catch(() => {});

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(onclose).not.toHaveBeenCalled();

    await client.close();

    for (const p of inFlight) {
        await expect(p).rejects.toBeInstanceOf(McpError);
        await expect(p).rejects.toMatchObject({ code: ErrorCode.ConnectionClosed });
    }
    // onclose fires at least once (transport peers may echo a close back, so don't pin the count).
    await vi.waitFor(() => expect(onclose).toHaveBeenCalled());
}

export async function protocolErrorInternalError({ transport }: TestArgs) {
    // Uses raw Server so the throw reaches the protocol layer; McpServer.registerTool
    // catches handler exceptions and wraps as {isError:true} (covered in tools.ts).
    const makeServer = () => {
        const s = new Server({ name: 's', version: '0' }, { capabilities: { tools: {} } });
        s.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
        s.setRequestHandler(CallToolRequestSchema, () => {
            throw new Error('handler exploded');
        });
        return s;
    };
    const client = newClient();
    await using _ = await wire(transport, makeServer, client);

    const call = client.callTool({ name: 'any', arguments: {} });

    await expect(call).rejects.toBeInstanceOf(McpError);
    await expect(call).rejects.toMatchObject({ code: ErrorCode.InternalError });
    await expect(call).rejects.toThrow(/handler exploded/);
    expect(ErrorCode.InternalError).toBe(-32603);
}

export async function protocolErrorInvalidParams({ transport }: TestArgs) {
    // Raw Server: setRequestHandler parses the inbound request against
    // CallToolRequestSchema; missing the required `name` field should yield
    // -32602 InvalidParams at the protocol layer (not McpServer's tool-arg validation).
    const makeServer = () => {
        const s = new Server({ name: 's', version: '0' }, { capabilities: { tools: {} } });
        s.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
        s.setRequestHandler(CallToolRequestSchema, () => ({ content: [] }));
        return s;
    };
    const client = newClient();
    // strictValidation off so the malformed request reaches the server instead of being rejected by the wire sniffer.
    await using _ = await wire(transport, makeServer, client, { strictValidation: false });

    const outbound = tapOutbound(client);

    // Send tools/call without the required `name` field.
    const call = client.request({ method: 'tools/call', params: { arguments: {} } }, z.object({}).passthrough());

    await expect(call).rejects.toBeInstanceOf(McpError);

    // The malformed request did reach the wire (failure is server-side, not client-side validation).
    const sent = outbound.filter(isRequest).find(m => m.method === 'tools/call');
    expect(sent?.params).toEqual({ arguments: {} });

    expect(ErrorCode.InvalidParams).toBe(-32602);
    await expect(call).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
}

export async function protocolErrorMethodNotFound({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        return s;
    };
    const client = newClient();
    await using _ = await wire(transport, makeServer, client, { allowCustomMethods: true });

    const outbound: JSONRPCMessage[] = [];
    const originalSend = client.transport!.send.bind(client.transport!);
    client.transport!.send = async m => {
        outbound.push(m);
        return originalSend(m);
    };

    const call = client.request({ method: 'no/such/method' }, z.object({}));

    await expect(call).rejects.toBeInstanceOf(McpError);

    const err = await call.catch(e => e as McpError);
    expect(err.code).toBe(ErrorCode.MethodNotFound);
    expect(err.code).toBe(-32601);

    const sent = outbound.filter(m => 'method' in m && m.method === 'no/such/method' && 'id' in m);
    expect(sent).toHaveLength(1);
}

export async function protocolErrorReconnectNoStaleTimers(_: TestArgs) {
    // Manages its own connection lifecycle (close + reconnect of the same Client),
    // so it wires inMemory pairs directly instead of using wire(). Transport-agnostic
    // behavior — lives in shared/protocol.ts.
    const serverA = neverRespondingServer();
    const [clientTxA, serverTxA] = InMemoryTransport.createLinkedPair();

    const client = newClient();
    const clientErrors: Error[] = [];
    client.onerror = e => clientErrors.push(e);

    await serverA.connect(serverTxA);
    await client.connect(clientTxA);

    // Park a request with a timeout long enough that we can drop the connection
    // first: its timer is armed in Protocol._timeoutInfo and must be cleared by
    // _onclose(), not left to fire after reconnect.
    const sentOnA: JSONRPCMessage[] = [];
    const origSendA = clientTxA.send.bind(clientTxA);
    clientTxA.send = async (m, opts) => {
        sentOnA.push(m);
        return origSendA(m, opts);
    };
    const inFlight = client.listTools(undefined, { timeout: 400 });
    inFlight.catch(() => {});

    await vi.waitFor(() => expect(sentOnA.filter(isRequest).some(m => m.method === 'tools/list')).toBe(true));

    // Connection drops before the 400 ms timeout fires; the in-flight request is
    // rejected by close (how it rejects is protocol:error:connection-closed's concern).
    await clientTxA.close();
    await serverA.close();

    // Reconnect the SAME Client instance to a fresh, healthy server. Tap the new
    // transport before connect so any spurious message would be captured.
    const serverB = new Server({ name: 's-b', version: '0' }, { capabilities: {} });
    const [clientTxB, serverTxB] = InMemoryTransport.createLinkedPair();
    const sentOnB: JSONRPCMessage[] = [];
    const origSendB = clientTxB.send.bind(clientTxB);
    clientTxB.send = async (m, opts) => {
        sentOnB.push(m);
        return origSendB(m, opts);
    };
    await serverB.connect(serverTxB);
    await client.connect(clientTxB);

    // Let the original 400 ms window elapse well past its deadline. A stale timer
    // surviving _onclose() would now fire and push notifications/cancelled (for a
    // request id server B never saw) onto the new transport.
    await new Promise(resolve => setTimeout(resolve, 550));

    expect(sentOnB.filter(isNotification).filter(m => m.method === 'notifications/cancelled')).toEqual([]);
    expect(clientErrors).toEqual([]);

    // The reconnected session is healthy.
    await expect(client.ping()).resolves.toBeDefined();
    expect(sentOnB.filter(isRequest).some(m => m.method === 'ping')).toBe(true);

    await client.close();
    await serverB.close();
}

export async function protocolProgressCallback({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('progress', { inputSchema: z.object({ steps: z.number().int().positive() }) }, async ({ steps }, extra) => {
            const token = extra._meta?.progressToken;
            if (token !== undefined) {
                for (let i = 1; i <= steps; i++) {
                    await extra.sendNotification({
                        method: 'notifications/progress',
                        params: {
                            progressToken: token,
                            progress: i,
                            total: steps,
                            message: `step ${i}/${steps}`
                        }
                    });
                }
            }
            return { content: [{ type: 'text', text: `done after ${steps} steps` }] };
        });
        return s;
    };
    const client = newClient();
    await using _ = await wire(transport, makeServer, client);

    const updates: Progress[] = [];

    await client.callTool({ name: 'progress', arguments: { steps: 2 } }, undefined, {
        onprogress: p => updates.push(p)
    });

    expect(updates).toHaveLength(2);

    expect(updates[0]).toMatchObject({ progress: 1, total: 2, message: 'step 1/2' });
    expect(updates[1]).toMatchObject({ progress: 2, total: 2, message: 'step 2/2' });

    expect(updates[0]).not.toHaveProperty('progressToken');
}

export async function protocolProgressTokenInjected({ transport }: TestArgs) {
    const received: CallToolRequest['params'][] = [];
    const makeServer = () => {
        const s = new Server({ name: 's', version: '0' }, { capabilities: { tools: {} } });
        s.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
        s.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
            received.push(req.params);
            const token = req.params._meta?.progressToken;
            if (token !== undefined) {
                await extra.sendNotification({
                    method: 'notifications/progress',
                    params: { progressToken: token, progress: 1, total: 1 }
                });
            }
            return { content: [{ type: 'text', text: 'ok' }] };
        });
        return s;
    };
    const client = newClient();
    await using _ = await wire(transport, makeServer, client);

    const traceKey = 'example.com/trace-id';
    const traceId = 'trace-abc-123';
    const progressEvents: Progress[] = [];

    const result = await client.callTool({ name: 'any', arguments: {}, _meta: { [traceKey]: traceId } }, undefined, {
        onprogress: p => progressEvents.push(p)
    });

    expect(result.isError).toBeFalsy();
    expect(progressEvents).toEqual([expect.objectContaining({ progress: 1, total: 1 })]);

    expect(received).toHaveLength(1);
    const meta = received[0]._meta;
    expect(meta?.progressToken).toBeDefined();
    expect(['number', 'string']).toContain(typeof meta?.progressToken);
    // Existing _meta fields are preserved alongside the injected token.
    expect(meta?.[traceKey]).toBe(traceId);
}

export async function protocolProgressTokenUnique({ transport }: TestArgs) {
    const tokens: Array<string | number> = [];
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('probe', { inputSchema: z.object({}) }, async (_a, extra) => {
            const token = extra._meta?.progressToken;
            if (token !== undefined) {
                tokens.push(token);
                await extra.sendNotification({
                    method: 'notifications/progress',
                    params: { progressToken: token, progress: 1, total: 1 }
                });
            }
            return { content: [] };
        });
        return s;
    };
    const client = newClient();
    await using _ = await wire(transport, makeServer, client);

    const a = client.callTool({ name: 'probe', arguments: {} }, undefined, { onprogress: () => {} });
    const b = client.callTool({ name: 'probe', arguments: {} }, undefined, { onprogress: () => {} });

    await Promise.all([a, b]);

    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
}

export async function protocolTimeoutBasic({ transport }: TestArgs) {
    vi.useFakeTimers();
    try {
        const client = newClient();
        await using _ = await wire(transport, neverRespondingServer, client);

        const outbound = tapOutbound(client);

        let outcome: { kind: 'resolved' | 'rejected'; value: unknown } | undefined;
        const pending = client.listTools(undefined, { timeout: 100 });
        void pending.then(
            v => (outcome = { kind: 'resolved', value: v }),
            (e: unknown) => (outcome = { kind: 'rejected', value: e })
        );

        await vi.advanceTimersByTimeAsync(0);
        expect(outbound.filter(isRequest).some(m => m.method === 'tools/list')).toBe(true);
        expect(outcome).toBeUndefined();

        await vi.advanceTimersByTimeAsync(99);
        expect(outcome).toBeUndefined();

        await vi.advanceTimersByTimeAsync(2);
        expect(outcome?.kind).toBe('rejected');
        expect(outcome?.value).toBeInstanceOf(McpError);
        expect(outcome?.value).toMatchObject({ code: ErrorCode.RequestTimeout });
    } finally {
        vi.useRealTimers();
    }
}

export async function protocolTimeoutMaxTotal({ transport }: TestArgs) {
    vi.useFakeTimers();
    try {
        const makeServer = () => {
            const s = new McpServer({ name: 's', version: '0' });
            s.registerTool(
                'slow-progress',
                { inputSchema: z.object({ delayMs: z.number(), steps: z.number() }) },
                async ({ delayMs, steps }, extra) => {
                    const token = extra._meta?.progressToken;
                    if (token !== undefined) {
                        for (let i = 1; i <= steps; i++) {
                            await new Promise(resolve => setTimeout(resolve, delayMs));
                            await extra.sendNotification({
                                method: 'notifications/progress',
                                params: { progressToken: token, progress: i, total: steps }
                            });
                        }
                    }
                    return { content: [] };
                }
            );
            return s;
        };
        const client = newClient();
        await using _ = await wire(transport, makeServer, client);

        const perChunk = 500;
        const maxTotal = 1000;
        const delayMs = 200;

        const ticks: number[] = [];

        const call = client.callTool({ name: 'slow-progress', arguments: { delayMs, steps: 100 } }, undefined, {
            timeout: perChunk,
            resetTimeoutOnProgress: true,
            maxTotalTimeout: maxTotal,
            onprogress: p => ticks.push(p.progress)
        });
        call.catch(() => {});

        for (let elapsed = 0; elapsed < maxTotal + perChunk; elapsed += delayMs) {
            await vi.advanceTimersByTimeAsync(delayMs);
        }

        await expect(call).rejects.toBeInstanceOf(McpError);
        const err = await call.catch(e => e as McpError);
        expect(err.code).toBe(ErrorCode.RequestTimeout);

        expect(ticks.length).toBeGreaterThanOrEqual(3);
    } finally {
        vi.useRealTimers();
    }
}

export async function protocolTimeoutResetOnProgress({ transport }: TestArgs) {
    vi.useFakeTimers();
    try {
        const makeServer = () => {
            const s = new McpServer({ name: 's', version: '0' });
            s.registerTool(
                'slow-progress',
                { inputSchema: z.object({ steps: z.number(), delayMs: z.number() }) },
                async ({ steps, delayMs }, extra) => {
                    const token = extra._meta?.progressToken;
                    if (token !== undefined) {
                        for (let i = 1; i <= steps; i++) {
                            await new Promise(resolve => setTimeout(resolve, delayMs));
                            await extra.sendNotification({
                                method: 'notifications/progress',
                                params: { progressToken: token, progress: i, total: steps }
                            });
                        }
                    }
                    return { content: [{ type: 'text', text: `done after ${steps} steps` }] };
                }
            );
            return s;
        };
        const client = newClient();
        await using _ = await wire(transport, makeServer, client);

        const timeout = 200;
        const steps = 3;
        const delayMs = 150;

        const received: number[] = [];
        let settled: 'resolved' | 'rejected' | undefined;

        const call = client
            .callTool({ name: 'slow-progress', arguments: { steps, delayMs } }, undefined, {
                timeout,
                resetTimeoutOnProgress: true,
                onprogress: p => {
                    received.push(p.progress);
                }
            })
            .then(
                r => ((settled = 'resolved'), r),
                e => ((settled = 'rejected'), Promise.reject(e))
            );

        for (let i = 1; i <= steps; i++) {
            await vi.advanceTimersByTimeAsync(delayMs);
            await vi.waitFor(() => expect(received.length).toBeGreaterThanOrEqual(i));
            if (i < steps) expect(settled).toBeUndefined();
        }

        const result = await call;

        expect(settled).toBe('resolved');
        expect(received).toEqual([1, 2, 3]);
        expect(result.isError).toBeFalsy();
        expect(result.content).toEqual([{ type: 'text', text: `done after ${steps} steps` }]);
    } finally {
        vi.useRealTimers();
    }
}

export async function protocolTimeoutSendsCancellation({ transport }: TestArgs) {
    vi.useFakeTimers();
    try {
        const client = newClient();
        await using _ = await wire(transport, neverRespondingServer, client);

        const outbound = tapOutbound(client);

        const pending = client.listTools(undefined, { timeout: 100 });
        // Snapshot at rejection time so the cancellation-before-reject ordering is actually observed.
        let sentAtRejection: JSONRPCMessage[] | undefined;
        pending.catch(() => {
            sentAtRejection = [...outbound];
        });

        await vi.advanceTimersByTimeAsync(100);

        await expect(pending).rejects.toBeInstanceOf(McpError);
        await expect(pending).rejects.toMatchObject({ code: ErrorCode.RequestTimeout });

        expect(sentAtRejection).toBeDefined();
        const listReq = sentAtRejection!.filter(isRequest).find(m => m.method === 'tools/list');
        expect(listReq).toBeDefined();

        const cancelled = sentAtRejection!.filter(isNotification).find(m => m.method === 'notifications/cancelled');
        expect(cancelled, 'notifications/cancelled must be handed to transport.send() before the request promise rejects').toBeDefined();
        expect(cancelled?.params?.requestId).toBe(listReq?.id);
        expect(String(cancelled?.params?.reason)).toMatch(/timed? ?out/i);
        expect(sentAtRejection!.indexOf(cancelled!)).toBeGreaterThan(sentAtRejection!.indexOf(listReq!));
    } finally {
        vi.useRealTimers();
    }
}

export async function mcpserverOnerrorReachThrough({ transport }: TestArgs) {
    const errors: Error[] = [];
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.server.onerror = e => errors.push(e);
        return s;
    };
    const client = newClient();
    await using _ = await wire(transport, makeServer, client, { strictValidation: false });

    const baseA = errors.length;
    const stray: JSONRPCMessage = { jsonrpc: '2.0', id: 99999, result: {} };
    await client.transport?.send(stray);

    await vi.waitFor(() => errors.length > baseA);

    const hitA = errors.slice(baseA).find(e => /unknown message ID/i.test(e.message));
    expect(
        hitA,
        `expected an "unknown message ID" onerror; got: ${errors
            .slice(baseA)
            .map(e => e.message)
            .join(' | ')}`
    ).toBeDefined();
    expect(hitA!.message).toContain('99999');

    const baseB = errors.length;
    const badProgress = {
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { progressToken: 'onerror-reach-through', progress: 'not-a-number' }
    } as unknown as JSONRPCMessage;
    await client.transport?.send(badProgress);

    await vi.waitFor(() => errors.length > baseB);

    const hitB = errors.slice(baseB).find(e => /uncaught error in notification handler/i.test(e.message));
    expect(
        hitB,
        `expected an "Uncaught error in notification handler" onerror; got: ${errors
            .slice(baseB)
            .map(e => e.message)
            .join(' | ')}`
    ).toBeDefined();

    await expect(client.ping()).resolves.toBeDefined();
}

export async function protocolCustomMethodNotification({ transport }: TestArgs) {
    const HEARTBEAT_METHOD = 'myorg/heartbeat';

    const CustomNotificationSchema = NotificationSchema.extend({
        method: z.literal(HEARTBEAT_METHOD),
        params: z.object({ seq: z.number(), tag: z.string() })
    });
    type CustomNotification = z.infer<typeof CustomNotificationSchema>;

    let server!: Server;
    const makeServer = () => (server = new Server({ name: 's', version: '0' }, { capabilities: {} }));

    const received: CustomNotification[] = [];
    const clientErrors: Error[] = [];
    const client = newClient();
    client.onerror = e => clientErrors.push(e);

    await using _ = await wire(transport, makeServer, client, { allowCustomMethods: true });

    client.setNotificationHandler(CustomNotificationSchema, n => {
        received.push(n);
    });

    await server.notification({
        method: HEARTBEAT_METHOD,
        params: { seq: 7, tag: 'custom', extra: 'stripped-by-zod' }
    });

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].method).toBe(HEARTBEAT_METHOD);
    // Handler receives the Zod-parsed params (extra fields stripped).
    expect(received[0].params).toEqual({ seq: 7, tag: 'custom' });
    expect(received[0].params).not.toHaveProperty('extra');
    expect(clientErrors).toEqual([]);
}

export async function protocolErrorDataRoundtrip({ transport }: TestArgs) {
    // Raw Server so the McpError reaches the protocol layer's error envelope.
    const data = { detail: 'x', nested: { n: 1 } };
    const makeServer = () => {
        const s = new Server({ name: 's', version: '0' }, { capabilities: { tools: {} } });
        s.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
        s.setRequestHandler(CallToolRequestSchema, () => {
            throw new McpError(ErrorCode.InternalError, 'boom', data);
        });
        return s;
    };
    const client = newClient();
    await using _ = await wire(transport, makeServer, client);

    const call = client.callTool({ name: 'any', arguments: {} });

    await expect(call).rejects.toBeInstanceOf(McpError);
    await expect(call).rejects.toThrow(/boom/);
    await expect(call).rejects.toMatchObject({ code: ErrorCode.InternalError, data });
}

export async function protocolFallbackNotificationHandler({ transport }: TestArgs) {
    const NEVER_REGISTERED = 'notifications/_e2e/never-registered';

    // Notifications are emitted from inside the tools/call handler so they cross the real wire on every transport, including stateless hosting.
    const makeServer = () => {
        const s = new Server(
            { name: 's', version: '0' },
            { capabilities: { tools: { listChanged: true }, prompts: { listChanged: true } } }
        );
        s.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
        s.setRequestHandler(CallToolRequestSchema, async (_req, extra) => {
            await extra.sendNotification({ method: NEVER_REGISTERED });
            await extra.sendNotification({ method: 'notifications/prompts/list_changed' });
            await extra.sendNotification({ method: 'notifications/tools/list_changed' });
            return { content: [] };
        });
        return s;
    };
    const client = newClient();

    const fallback: Notification[] = [];
    const specific: Notification[] = [];

    await using _ = await wire(transport, makeServer, client, { allowCustomMethods: true });

    client.setNotificationHandler(ToolListChangedNotificationSchema, async n => {
        specific.push(n);
    });
    client.setNotificationHandler(PromptListChangedNotificationSchema, async n => {
        specific.push(n);
    });

    client.fallbackNotificationHandler = async n => {
        fallback.push(n);
    };

    client.removeNotificationHandler('notifications/prompts/list_changed');

    await client.callTool({ name: 'emit-notifications', arguments: {} });

    await vi.waitFor(() =>
        expect(
            fallback.some(n => n.method === NEVER_REGISTERED) &&
                fallback.some(n => n.method === 'notifications/prompts/list_changed') &&
                specific.some(n => n.method === 'notifications/tools/list_changed')
        ).toBe(true)
    );

    expect(fallback.filter(n => n.method === NEVER_REGISTERED)).toHaveLength(1);
    expect(specific.filter(n => n.method === NEVER_REGISTERED)).toHaveLength(0);

    expect(fallback.filter(n => n.method === 'notifications/prompts/list_changed')).toHaveLength(1);
    expect(specific.filter(n => n.method === 'notifications/prompts/list_changed')).toHaveLength(0);

    expect(specific.filter(n => n.method === 'notifications/tools/list_changed')).toHaveLength(1);
    expect(fallback.filter(n => n.method === 'notifications/tools/list_changed')).toHaveLength(0);
}

export async function protocolHandlerReRegisterReplaces({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('list-roots', { inputSchema: z.object({}) }, async (_a, extra) => {
            const result = await extra.sendRequest({ method: 'roots/list' }, ListRootsResultSchema);
            return { structuredContent: { ok: true, result }, content: [] };
        });
        return s;
    };
    const client = new Client({ name: 'c', version: '0' }, { capabilities: { roots: { listChanged: true } } });
    await using _ = await wire(transport, makeServer, client);

    let firstCalls = 0;
    let secondCalls = 0;

    client.setRequestHandler(ListRootsRequestSchema, async () => {
        firstCalls++;
        return { roots: [{ uri: 'file:///first', name: 'first' }] };
    });

    expect(() =>
        client.setRequestHandler(ListRootsRequestSchema, async () => {
            secondCalls++;
            return { roots: [{ uri: 'file:///second', name: 'second' }] };
        })
    ).not.toThrow();

    const result = await client.callTool({ name: 'list-roots', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
        ok: true,
        result: { roots: [{ uri: 'file:///second', name: 'second' }] }
    });

    expect(secondCalls).toBe(1);
    expect(firstCalls).toBe(0);
}

const X_ECHO_METHOD = 'x-e2e/echo';
const XEchoRequestSchema = RequestSchema.extend({
    method: z.literal(X_ECHO_METHOD),
    params: z.object({ value: z.string() })
});
const XEchoResultSchema = ResultSchema.extend({ echoed: z.string() });

function customEchoServer(): Server {
    const s = new Server({ name: 's', version: '0' }, { capabilities: {} });
    s.setRequestHandler(XEchoRequestSchema, req => ({ echoed: req.params.value }));
    return s;
}

export async function protocolCustomMethodRequest({ transport }: TestArgs) {
    const client = newClient();
    await using _ = await wire(transport, customEchoServer, client, { allowCustomMethods: true });

    const result = await client.request({ method: X_ECHO_METHOD, params: { value: 'hi' } }, XEchoResultSchema);

    expect(result).toEqual({ echoed: 'hi' });
}

export async function protocolCustomMethodRoundtrip({ transport }: TestArgs) {
    const client = newClient();
    const clientErrors: Error[] = [];
    client.onerror = e => clientErrors.push(e);
    await using _ = await wire(transport, customEchoServer, client, { allowCustomMethods: true });

    // Custom method dispatches to the user handler — not -32601 MethodNotFound.
    const result = await client.request({ method: X_ECHO_METHOD, params: { value: 'round' } }, XEchoResultSchema);
    expect(result).toEqual({ echoed: 'round' });
    expect(clientErrors).toEqual([]);

    // A truly-unknown method still surfaces as MethodNotFound, proving the
    // custom registration is what made the previous call succeed.
    await expect(client.request({ method: 'x-e2e/never-registered', params: {} }, ResultSchema)).rejects.toMatchObject({
        code: ErrorCode.MethodNotFound
    });
}

export async function protocolCustomNotificationRoundtrip({ transport }: TestArgs) {
    const X_EVENT_METHOD = 'x-e2e/event';
    const XEventNotificationSchema = NotificationSchema.extend({
        method: z.literal(X_EVENT_METHOD),
        params: z.object({ kind: z.string(), id: z.number() })
    });
    type XEvent = z.infer<typeof XEventNotificationSchema>;

    const received: XEvent[] = [];
    const serverErrors: Error[] = [];
    const makeServer = () => {
        const s = new Server({ name: 's', version: '0' }, { capabilities: {} });
        s.onerror = e => serverErrors.push(e);
        s.setNotificationHandler(XEventNotificationSchema, n => {
            received.push(n);
        });
        return s;
    };

    const client = newClient();
    await using _ = await wire(transport, makeServer, client, { allowCustomMethods: true });

    await client.notification({ method: X_EVENT_METHOD, params: { kind: 'k', id: 42, extra: 'stripped-by-zod' } });

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].method).toBe(X_EVENT_METHOD);
    // Handler receives the Zod-parsed params (extra fields stripped), not raw passthrough.
    expect(received[0].params).toEqual({ kind: 'k', id: 42 });
    expect(received[0].params).not.toHaveProperty('extra');
    expect(serverErrors).toEqual([]);
}

export async function protocolRequestHandlerOverrideBuiltin({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new Server({ name: 's', version: '0' }, { capabilities: {} });
        // Ping has a built-in handler; this should replace it without throwing.
        s.setRequestHandler(PingRequestSchema, () => ({ _meta: { 'e2e/overridden': true } }));
        return s;
    };

    const client = newClient();
    await using _ = await wire(transport, makeServer, client);

    expect(() =>
        new Server({ name: 's', version: '0' }, { capabilities: {} }).setRequestHandler(PingRequestSchema, () => ({}))
    ).not.toThrow();

    const result = await client.ping();
    expect(result).toEqual({ _meta: { 'e2e/overridden': true } });
}

export async function mcpserverOnerrorReachThroughRaw({ transport }: TestArgs) {
    const errors: Error[] = [];
    const makeServer = () => {
        const s = new Server({ name: 's', version: '0' }, { capabilities: {} });
        s.onerror = e => errors.push(e);
        return s;
    };
    const client = newClient();
    await using _ = await wire(transport, makeServer, client);

    const baseA = errors.length;
    const stray: JSONRPCMessage = { jsonrpc: '2.0', id: 99999, result: {} };
    await client.transport?.send(stray);

    await vi.waitFor(() => errors.length > baseA);

    const hitA = errors.slice(baseA).find(e => /unknown message ID/i.test(e.message));
    expect(
        hitA,
        `expected an "unknown message ID" onerror; got: ${errors
            .slice(baseA)
            .map(e => e.message)
            .join(' | ')}`
    ).toBeDefined();
    expect(hitA!.message).toContain('99999');

    await expect(client.ping()).resolves.toBeDefined();
}
