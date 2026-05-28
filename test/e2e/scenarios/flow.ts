/**
 * Self-contained test bodies for composite end-to-end flows.
 *
 * These are longer journeys that combine multiple SDK features: multi-step
 * elicitation, OAuth roundtrip, resumption, session management, proxy
 * forwarding. Each builds whatever in-test pieces it needs (mock AS, minimal
 * EventStore, secondary Clients, proxy McpServer delegating to an upstream
 * Client) rather than importing shared fixtures.
 */

import { expect, vi } from 'vitest';
import { z } from 'zod/v4';

import { Client } from '../../../src/client/index.js';
import { type OAuthClientProvider, UnauthorizedError } from '../../../src/client/auth.js';
import { StreamableHTTPClientTransport } from '../../../src/client/streamableHttp.js';
import { InMemoryEventStore } from '../../../src/examples/shared/inMemoryEventStore.js';
import { Server } from '../../../src/server/index.js';
import { McpServer } from '../../../src/server/mcp.js';
import { type OAuthTokens, type OAuthClientMetadata, type OAuthClientInformationMixed } from '../../../src/shared/auth.js';
import {
    type CallToolResult,
    ElicitationCompleteNotificationSchema,
    type ElicitRequest,
    type ElicitResult,
    ElicitRequestSchema,
    ElicitResultSchema,
    ErrorCode,
    type JSONRPCMessage,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    type Progress,
    ReadResourceRequestSchema,
    UrlElicitationRequiredError
} from '../../../src/types.js';

import { hostPerSession, hostResumable, wire } from '../helpers/index.js';
import type { TestArgs } from '../types.js';

export async function flowElicitationMultiStepForm({ transport }: TestArgs) {
    // Server: tool that issues three sequential elicitation/create requests
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('multi-step', { inputSchema: z.object({}) }, async (_args, extra) => {
            const step1 = await extra.sendRequest(
                {
                    method: 'elicitation/create',
                    params: {
                        mode: 'form',
                        message: 'What is your name?',
                        requestedSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
                    }
                },
                ElicitResultSchema
            );
            if (step1.action !== 'accept' || typeof step1.content?.name !== 'string') {
                return { content: [{ type: 'text', text: `aborted at step 1: ${step1.action}` }] };
            }
            const name = step1.content.name;

            const step2 = await extra.sendRequest(
                {
                    method: 'elicitation/create',
                    params: {
                        mode: 'form',
                        message: `Hello ${name}, what is your favorite color?`,
                        requestedSchema: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'] }
                    }
                },
                ElicitResultSchema
            );
            if (step2.action !== 'accept' || typeof step2.content?.color !== 'string') {
                return { content: [{ type: 'text', text: `aborted at step 2: ${step2.action}` }] };
            }
            const color = step2.content.color;

            const step3 = await extra.sendRequest(
                {
                    method: 'elicitation/create',
                    params: {
                        mode: 'form',
                        message: `${name}, you picked ${color}. Confirm?`,
                        requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] }
                    }
                },
                ElicitResultSchema
            );
            if (step3.action !== 'accept') {
                return { content: [{ type: 'text', text: `aborted at step 3: ${step3.action}` }] };
            }

            return { content: [{ type: 'text', text: `${name}'s favorite color is ${color}` }] };
        });
        return s;
    };

    // Client: registers handler for elicitation/create, queues responses
    const received: ElicitRequest[] = [];
    const queued: ElicitResult[] = [];
    const client = new Client({ name: 'c', version: '0' }, { capabilities: { elicitation: { form: {} } } });
    client.setRequestHandler(ElicitRequestSchema, async req => {
        received.push(req);
        const resp = queued.shift();
        if (!resp) throw new Error('no queued elicitation response');
        return resp;
    });

    await using _ = await wire(transport, makeServer, client);

    // Happy path: accept all three steps
    queued.push({ action: 'accept', content: { name: 'Ada' } });
    queued.push({ action: 'accept', content: { color: 'blue' } });
    queued.push({ action: 'accept', content: { confirm: true } });

    const ok = await client.callTool({ name: 'multi-step', arguments: {} });
    expect(ok.isError).toBeFalsy();
    expect(ok.content).toEqual([{ type: 'text', text: "Ada's favorite color is blue" }]);

    expect(received).toHaveLength(3);
    expect(received[0].params).toMatchObject({ mode: 'form', requestedSchema: { properties: { name: { type: 'string' } } } });
    expect(received[1].params.message).toContain('Ada');
    expect(received[1].params).toMatchObject({ mode: 'form', requestedSchema: { properties: { color: { type: 'string' } } } });
    expect(received[2].params.message).toContain('Ada');
    expect(received[2].params.message).toContain('blue');
    expect(received[2].params).toMatchObject({ mode: 'form', requestedSchema: { properties: { confirm: { type: 'boolean' } } } });

    // Decline at step 2
    queued.push({ action: 'accept', content: { name: 'Bob' } });
    queued.push({ action: 'decline' });
    const declined = await client.callTool({ name: 'multi-step', arguments: {} });
    expect(declined.isError).toBeFalsy();
    expect(declined.content).toEqual([{ type: 'text', text: 'aborted at step 2: decline' }]);
    expect(received).toHaveLength(5);

    // Cancel at step 1
    queued.push({ action: 'cancel' });
    queued.push({ action: 'accept', content: { color: 'red' } }); // sentinel: must not be consumed
    const cancelled = await client.callTool({ name: 'multi-step', arguments: {} });
    expect(cancelled.isError).toBeFalsy();
    expect(cancelled.content).toEqual([{ type: 'text', text: 'aborted at step 1: cancel' }]);
    expect(received).toHaveLength(6);
    expect(queued).toHaveLength(1); // sentinel still queued
}

export async function flowElicitationUrlAtSessionInit(_args: TestArgs) {
    // Not wire(): a transport.send tap must be installed before connect to prove no client request precedes the unsolicited elicitation.
    // Server: issues URL-mode elicitation immediately after onsessioninitialized
    const makeServer = () => {
        const s = new Server({ name: 's', version: '0' }, { capabilities: { tools: {} } });
        s.oninitialized = () => {
            setTimeout(() => {
                void s
                    .elicitInput({
                        mode: 'url',
                        message: 'Authorize the session',
                        url: 'https://example.com/auth',
                        elicitationId: 'session-init-elicit'
                    })
                    .catch(() => {});
            }, 0);
        };
        s.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
        return s;
    };

    const received: ElicitRequest[] = [];
    const client = new Client({ name: 'c', version: '0' }, { capabilities: { elicitation: { url: {} } } });
    client.setRequestHandler(ElicitRequestSchema, async req => {
        received.push(req);
        return { action: 'accept' };
    });

    const handle = hostPerSession(makeServer);
    const url = new URL('http://in-process/mcp');
    const customFetch = (u: URL | string, init?: RequestInit) => handle.handleRequest(new Request(u, init));
    const transport = new StreamableHTTPClientTransport(url, { fetch: customFetch });

    // Tap wire before connecting
    const sent: Array<{ method?: string }> = [];
    const origSend = transport.send.bind(transport);
    transport.send = async (m, opts) => {
        sent.push(m as { method?: string });
        return origSend(m, opts);
    };

    await client.connect(transport);

    try {
        // Wait for the unsolicited server→client elicitation/create
        await vi.waitFor(() => expect(received.length).toBeGreaterThanOrEqual(1));

        expect(received).toHaveLength(1);
        expect(received[0].method).toBe('elicitation/create');
        const params = received[0].params;
        if (params.mode !== 'url') throw new Error('expected url mode');
        expect(params.elicitationId).toBe('session-init-elicit');
        expect(() => new URL(params.url)).not.toThrow();

        // Client has only sent initialize so far (no post-init requests)
        const requests = sent.filter(m => 'method' in m && 'id' in m);
        expect(requests.map(r => r.method)).toEqual(['initialize']);

        // Session survived
        await expect(client.ping()).resolves.toBeDefined();
    } finally {
        await Promise.all([client.close(), handle.close()]);
    }
}

export async function flowElicitationUrlRequiredThenRetry({ transport }: TestArgs) {
    // Server: tool that throws UrlElicitationRequiredError until elicitation is completed
    const completed = new Set<string>();
    let server!: McpServer;
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('url-gated', { inputSchema: z.object({}) }, () => {
            const elicitationId = 'url-elicit-1';
            if (!completed.has(elicitationId)) {
                throw new UrlElicitationRequiredError([
                    {
                        mode: 'url',
                        message: 'Please sign in',
                        elicitationId,
                        url: 'https://example.com/auth'
                    }
                ]);
            }
            return { content: [{ type: 'text', text: 'authenticated' }] };
        });
        server = s;
        return s;
    };

    const client = new Client({ name: 'c', version: '0' }, { capabilities: { elicitation: { url: {} } } });
    const completionsSeen: string[] = [];
    client.setNotificationHandler(ElicitationCompleteNotificationSchema, async n => {
        completionsSeen.push(n.params.elicitationId);
    });
    await using _ = await wire(transport, makeServer, client);

    // Step 1: first call rejects with UrlElicitationRequiredError
    const err = await client.callTool({ name: 'url-gated', arguments: {} }).catch(e => e);
    expect(err).toBeInstanceOf(UrlElicitationRequiredError);
    const required = err as UrlElicitationRequiredError;
    expect(required.code).toBe(ErrorCode.UrlElicitationRequired);
    expect(required.elicitations).toHaveLength(1);
    const elicitation = required.elicitations[0];
    expect(elicitation.mode).toBe('url');
    expect(typeof elicitation.elicitationId).toBe('string');
    expect(elicitation.url).toMatch(/^https?:\/\//);

    // Step 2: user "opens" the URL (out-of-band, simulated by marking complete)
    completed.add(elicitation.elicitationId);

    // Step 3: server emits notifications/elicitation/complete and the client receives it for that exact elicitation
    await server.server.createElicitationCompletionNotifier(elicitation.elicitationId)();
    await vi.waitFor(() => expect(completionsSeen).toEqual([elicitation.elicitationId]));

    // Step 4: retry succeeds
    const result = await client.callTool({ name: 'url-gated', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: 'text', text: 'authenticated' }]);
}

export async function flowMultiClientStatefulIsolation(_args: TestArgs) {
    // Not wire(): three clients share one host and the test reads each transport's sessionId; wire() binds a single client to its own host.
    // Server: per-session McpServer with progress tool
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('progress', { inputSchema: z.object({ steps: z.number().int().positive() }) }, async ({ steps }, extra) => {
            const token = extra._meta?.progressToken;
            if (token !== undefined) {
                for (let i = 1; i <= steps; i++) {
                    await extra.sendNotification({
                        method: 'notifications/progress',
                        params: { progressToken: token, progress: i, total: steps, message: `step ${i}/${steps}` }
                    });
                }
            }
            return { content: [{ type: 'text', text: `done after ${steps} steps` }] };
        });
        return s;
    };

    // Three clients connect to the same per-session host
    const clientA = new Client({ name: 'a', version: '0' });
    const clientB = new Client({ name: 'b', version: '0' });
    const clientC = new Client({ name: 'c', version: '0' });

    const handle = hostPerSession(makeServer);
    const url = new URL('http://in-process/mcp');
    const customFetch = (u: URL | string, init?: RequestInit) => handle.handleRequest(new Request(u, init));

    await clientA.connect(new StreamableHTTPClientTransport(url, { fetch: customFetch }));
    await clientB.connect(new StreamableHTTPClientTransport(url, { fetch: customFetch }));
    await clientC.connect(new StreamableHTTPClientTransport(url, { fetch: customFetch }));

    try {
        const clients = [clientA, clientB, clientC] as const;
        const sessionIds = clients.map(c => (c.transport as StreamableHTTPClientTransport).sessionId);

        for (const id of sessionIds) {
            expect(id).toEqual(expect.any(String));
        }
        expect(new Set(sessionIds).size).toBe(3);

        // Concurrent progress calls with distinct step counts
        const STEPS = [2, 3, 4] as const;
        const errors: Error[][] = [[], [], []];
        clients.forEach((cl, i) => {
            cl.onerror = e => errors[i].push(e);
        });

        const runs = await Promise.all(
            clients.map(async (cl, i) => {
                const received: Progress[] = [];
                const result = await cl.callTool({ name: 'progress', arguments: { steps: STEPS[i] } }, undefined, {
                    onprogress: p => received.push({ progress: p.progress, total: p.total, message: p.message })
                });
                return { received, result };
            })
        );

        for (let i = 0; i < 3; i++) {
            const steps = STEPS[i];
            const { received, result } = runs[i];
            expect(received).toEqual(
                Array.from({ length: steps }, (_, k) => ({
                    progress: k + 1,
                    total: steps,
                    message: `step ${k + 1}/${steps}`
                }))
            );
            expect(result.content).toEqual([{ type: 'text', text: `done after ${steps} steps` }]);
        }

        for (const errs of errors) {
            expect(errs).toEqual([]);
        }
    } finally {
        await Promise.all([clientA.close(), clientB.close(), clientC.close(), handle.close()]);
    }
}

export async function flowOauthAuthorizationCodeRoundtrip(_args: TestArgs) {
    // Not wire(): needs an authProvider-equipped client transport plus 401/PRM/AS fetch routing in front of the host, which wire() does not expose.
    const ACCESS_TOKEN = 'roundtrip-access-token';
    const AUTH_CODE = 'granted-authorization-code';
    const AS_ORIGIN = 'https://as.example.com';
    const PRM_PATH = '/.well-known/oauth-protected-resource';

    // Mock Authorization Server: metadata discovery, dynamic client registration, code exchange.
    const registerRequests: Array<Record<string, unknown>> = [];
    const tokenRequests: URLSearchParams[] = [];
    const mockASFetch = async (url: URL | string, init?: RequestInit): Promise<Response> => {
        const req = new Request(url, init);
        const u = new URL(req.url);
        if (u.pathname === '/.well-known/oauth-authorization-server') {
            return new Response(
                JSON.stringify({
                    issuer: AS_ORIGIN,
                    authorization_endpoint: `${AS_ORIGIN}/authorize`,
                    token_endpoint: `${AS_ORIGIN}/token`,
                    registration_endpoint: `${AS_ORIGIN}/register`,
                    grant_types_supported: ['authorization_code'],
                    response_types_supported: ['code'],
                    code_challenge_methods_supported: ['S256']
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
        }
        if (u.pathname === '/register' && req.method === 'POST') {
            const body: Record<string, unknown> = await req.json();
            registerRequests.push(body);
            // RFC 7591: the registration response echoes the submitted metadata plus the issued client_id.
            return new Response(JSON.stringify({ ...body, client_id: 'mock-client-id' }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        if (u.pathname === '/token' && req.method === 'POST') {
            tokenRequests.push(new URLSearchParams(await req.text()));
            return new Response(JSON.stringify({ access_token: ACCESS_TOKEN, token_type: 'Bearer', expires_in: 3600 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        return new Response('Not Found', { status: 404 });
    };

    // Mock OAuthClientProvider
    const redirectedTo: string[] = [];
    const saved: { tokens?: OAuthTokens; clientInfo?: OAuthClientInformationMixed; codeVerifier?: string } = {};
    const provider: OAuthClientProvider = {
        get redirectUrl() {
            return 'http://localhost/callback';
        },
        get clientMetadata(): OAuthClientMetadata {
            return {
                client_name: 'test-client',
                client_uri: 'http://localhost',
                redirect_uris: ['http://localhost/callback']
            };
        },
        clientInformation: () => saved.clientInfo,
        saveClientInformation: async ci => {
            saved.clientInfo = ci;
        },
        tokens: () => saved.tokens,
        saveTokens: async t => {
            saved.tokens = t;
        },
        codeVerifier: () => {
            if (!saved.codeVerifier) throw new Error('No code verifier saved');
            return saved.codeVerifier;
        },
        saveCodeVerifier: async v => {
            saved.codeVerifier = v;
        },
        redirectToAuthorization: async url => {
            redirectedTo.push(url.toString());
        }
    };

    // Server with bearer auth
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('echo', { inputSchema: z.object({ text: z.string() }) }, ({ text }) => ({
            content: [{ type: 'text', text }]
        }));
        return s;
    };

    // Protected host: serves RFC 9728 resource metadata, otherwise requires the issued bearer token.
    const handle = hostPerSession(makeServer);
    const url = new URL('http://in-process/mcp');
    const serverFetch = async (u: URL | string, init?: RequestInit): Promise<Response> => {
        const req = new Request(u, init);
        const requestUrl = new URL(req.url);
        if (requestUrl.pathname.startsWith(PRM_PATH)) {
            return new Response(JSON.stringify({ resource: url.toString(), authorization_servers: [AS_ORIGIN] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        const auth = req.headers.get('authorization');
        if (auth !== `Bearer ${ACCESS_TOKEN}`) {
            return new Response(null, {
                status: 401,
                headers: { 'WWW-Authenticate': `Bearer resource_metadata="http://in-process${PRM_PATH}/mcp"` }
            });
        }
        return handle.handleRequest(req);
    };

    const combinedFetch = async (u: URL | string, init?: RequestInit): Promise<Response> => {
        const requestUrl = typeof u === 'string' ? new URL(u) : u;
        if (requestUrl.hostname === 'as.example.com') return mockASFetch(requestUrl, init);
        return serverFetch(requestUrl, init);
    };

    const client = new Client({ name: 'c', version: '0' });

    try {
        // Step 1: first connect fails with 401 → discovery + DCR + redirect to the authorization endpoint
        const transport1 = new StreamableHTTPClientTransport(url, { authProvider: provider, fetch: combinedFetch });
        await expect(client.connect(transport1)).rejects.toBeInstanceOf(UnauthorizedError);

        expect(redirectedTo).toHaveLength(1);
        const authorizeUrl = new URL(redirectedTo[0]);
        expect(authorizeUrl.origin).toBe(AS_ORIGIN);
        expect(authorizeUrl.pathname).toBe('/authorize');
        expect(authorizeUrl.searchParams.get('client_id')).toBe('mock-client-id');
        expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy();
        expect(registerRequests).toHaveLength(1);
        expect(saved.tokens).toBeUndefined();

        const codeVerifier = saved.codeVerifier;
        if (!codeVerifier) throw new Error('No code verifier saved during the redirect step');

        // Step 2: user completes redirect, finishAuth exchanges the code for tokens
        await transport1.finishAuth(AUTH_CODE);

        expect(tokenRequests).toHaveLength(1);
        expect(tokenRequests[0].get('grant_type')).toBe('authorization_code');
        expect(tokenRequests[0].get('code')).toBe(AUTH_CODE);
        expect(tokenRequests[0].get('code_verifier')).toBe(codeVerifier);
        expect(tokenRequests[0].get('redirect_uri')).toBe('http://localhost/callback');
        expect(saved.tokens?.access_token).toBe(ACCESS_TOKEN);

        // Step 3: second connect with fresh transport succeeds and tools/list works
        const transport2 = new StreamableHTTPClientTransport(url, { authProvider: provider, fetch: combinedFetch });
        await client.connect(transport2);

        const { tools } = await client.listTools();
        expect(tools.some(t => t.name === 'echo')).toBe(true);
    } finally {
        await Promise.all([client.close(), handle.close()]);
    }
}

export async function flowResumeToolCallResumptionToken(_args: TestArgs) {
    // Not wire(): needs an EventStore-backed host and a severable fetch to simulate a mid-stream disconnect, which wire() does not expose.
    const STEPS = 4;
    const ANCHOR_AT = 2;

    // Server with gated-progress tool
    const released = new Set<number>();
    let toolRuns = 0;
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('gated-progress', { inputSchema: z.object({ steps: z.number().int().positive() }) }, async ({ steps }, extra) => {
            toolRuns++;
            const token = extra._meta?.progressToken;
            if (token !== undefined) {
                for (let i = 1; i <= steps; i++) {
                    // Wait until this step is released
                    while (!released.has(i)) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                    await extra.sendNotification({
                        method: 'notifications/progress',
                        params: { progressToken: token, progress: i, total: steps }
                    });
                }
            }
            return { content: [{ type: 'text', text: `done after ${steps} steps` }] };
        });
        return s;
    };

    const eventStore = new InMemoryEventStore();
    // Tap stored events so the test can tell when the server has persisted the final result while the client is disconnected
    const storedMessages: JSONRPCMessage[] = [];
    const origStoreEvent = eventStore.storeEvent.bind(eventStore);
    eventStore.storeEvent = async (streamId, message) => {
        storedMessages.push(message);
        return origStoreEvent(streamId, message);
    };

    const handle = hostResumable(makeServer, { eventStore });
    const url = new URL('http://in-process/mcp');

    // Wrap the tools/call POST stream so it can be severed client-side while the server keeps streaming into the EventStore
    let killToolCallStream: () => void = () => {};
    const customFetch = async (u: URL | string, init?: RequestInit): Promise<Response> => {
        const response = await handle.handleRequest(new Request(u, init));
        const isToolCallPost = typeof init?.body === 'string' && init.body.includes('"tools/call"');
        if (!isToolCallPost || !response.body) return response;
        const upstream = response.body.getReader();
        let killed = false;
        const severable = new ReadableStream<Uint8Array>({
            start: controller => {
                killToolCallStream = () => {
                    killed = true;
                    controller.error(new Error('simulated mid-stream disconnect'));
                };
                void (async () => {
                    while (true) {
                        const { value, done } = await upstream.read();
                        if (done) break;
                        if (!killed && value) controller.enqueue(value);
                    }
                    if (!killed) controller.close();
                })();
            }
        });
        return new Response(severable, { status: response.status, headers: response.headers });
    };

    const client = new Client({ name: 'c', version: '0' });
    // maxRetries: 0 disables auto-reconnect, so redelivery can only come from the explicit resumptionToken re-issue below
    const transport = new StreamableHTTPClientTransport(url, {
        fetch: customFetch,
        reconnectionOptions: { initialReconnectionDelay: 10, maxReconnectionDelay: 10, reconnectionDelayGrowFactor: 1, maxRetries: 0 }
    });
    await client.connect(transport);

    try {
        const tokens: string[] = [];
        const seen: number[] = [];

        const firstCall = client.callTool({ name: 'gated-progress', arguments: { steps: STEPS } }, undefined, {
            onprogress: (p: Progress) => seen.push(p.progress),
            onresumptiontoken: id => tokens.push(id)
        });
        const firstCallSettled = vi.fn();
        firstCall.then(firstCallSettled, firstCallSettled);

        // Wait for priming token
        await vi.waitFor(() => expect(tokens.length).toBeGreaterThanOrEqual(1));
        const primingToken = tokens[0];

        // Release steps up to anchor
        let anchor = '';
        for (let i = 1; i <= ANCHOR_AT; i++) {
            const before = tokens.length;
            released.add(i);
            await vi.waitFor(() => expect(seen.includes(i) && tokens.length > before).toBe(true));
            anchor = tokens[tokens.length - 1];
        }
        expect(anchor).toBeTruthy();
        expect(anchor).not.toBe(primingToken);
        expect(seen).toEqual([1, 2]);
        expect(new Set(tokens).size).toBe(tokens.length); // all distinct

        // Mid-stream disconnect after the anchor: the client stops receiving, the server keeps executing
        killToolCallStream();
        for (let i = ANCHOR_AT + 1; i <= STEPS; i++) {
            released.add(i);
        }
        await vi.waitFor(() => expect(storedMessages.some(m => 'result' in m)).toBe(true));
        expect(firstCallSettled).not.toHaveBeenCalled();
        expect(seen).toEqual([1, 2]);

        // Re-issue with the anchor as resumptionToken: only steps 3..4 and the final result are redelivered
        const resumeSeen: number[] = [];
        const resumeResult = (await client.callTool({ name: 'gated-progress', arguments: { steps: STEPS } }, undefined, {
            resumptionToken: anchor,
            onprogress: (p: Progress) => resumeSeen.push(p.progress)
        })) as CallToolResult;

        expect(resumeResult.content).toEqual([{ type: 'text', text: `done after ${STEPS} steps` }]);
        // Replayed progress carries the original call's progressToken, so it lands on the still-pending first call's handler
        expect([...seen.slice(ANCHOR_AT), ...resumeSeen]).toEqual([3, 4]);
        expect(toolRuns).toBe(1);
        expect(firstCallSettled).not.toHaveBeenCalled();
    } finally {
        await Promise.all([client.close(), handle.close()]);
    }
}

export async function flowSessionTerminateThenReconnect(_args: TestArgs) {
    // Not wire(): drives StreamableHTTPClientTransport directly for sessionId/terminateSession() and connects a second transport to the same host.
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('echo', { inputSchema: z.object({ text: z.string() }) }, ({ text }) => ({
            content: [{ type: 'text', text }]
        }));
        return s;
    };

    const handle = hostPerSession(makeServer);
    const url = new URL('http://in-process/mcp');
    const customFetch = (u: URL | string, init?: RequestInit) => handle.handleRequest(new Request(u, init));

    const client1 = new Client({ name: 'c', version: '0' });
    const transport1 = new StreamableHTTPClientTransport(url, { fetch: customFetch });
    await client1.connect(transport1);

    try {
        const originalSessionId = transport1.sessionId;
        expect(originalSessionId).toEqual(expect.any(String));

        // Terminate session
        await transport1.terminateSession();
        expect(transport1.sessionId).toBeUndefined();

        // Close first client
        await client1.close();

        // Fresh client and transport obtain new session
        const client2 = new Client({ name: 'c', version: '0' });
        const transport2 = new StreamableHTTPClientTransport(url, { fetch: customFetch });
        await client2.connect(transport2);

        const newSessionId = transport2.sessionId;
        expect(newSessionId).toEqual(expect.any(String));
        expect(newSessionId).not.toBe(originalSessionId);

        // Operations succeed on new session
        const result = await client2.callTool({ name: 'echo', arguments: { text: 'after-reconnect' } });
        expect(result.isError).toBeFalsy();
        expect(result.content).toEqual([{ type: 'text', text: 'after-reconnect' }]);

        await client2.close();
    } finally {
        await handle.close();
    }
}

export async function flowToolResultResourceLinkFollow({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('resource-link', { inputSchema: z.object({}) }, () => ({
            content: [
                {
                    type: 'resource_link',
                    uri: 'file:///linked.txt',
                    name: 'linked.txt',
                    mimeType: 'text/plain'
                }
            ]
        }));
        s.registerResource('linked.txt', 'file:///linked.txt', { mimeType: 'text/plain' }, async () => ({
            contents: [{ uri: 'file:///linked.txt', mimeType: 'text/plain', text: 'linked resource contents' }]
        }));
        return s;
    };

    const client = new Client({ name: 'c', version: '0' });
    await using _ = await wire(transport, makeServer, client);

    // Call tool and get resource_link
    const toolResult = (await client.callTool({ name: 'resource-link', arguments: {} })) as CallToolResult;
    expect(toolResult.isError).toBeFalsy();

    const link = toolResult.content.find(c => c.type === 'resource_link');
    expect(link).toBeDefined();
    if (link?.type !== 'resource_link') throw new Error('unreachable');
    expect(link.uri).toBe('file:///linked.txt');

    // Follow the link with resources/read
    const readResult = await client.readResource({ uri: link.uri });
    expect(readResult.contents).toHaveLength(1);
    const [entry] = readResult.contents;
    expect(entry.uri).toBe(link.uri);
    expect(entry.mimeType).toBe('text/plain');
    if (entry.mimeType?.startsWith('text/')) {
        expect('text' in entry ? entry.text : '').toBe('linked resource contents');
    }
}

export async function flowProxyForwardToolsResources({ transport }: TestArgs) {
    // Upstream server with tools and resources
    const upstreamServer = new McpServer({ name: 'upstream', version: '0' });
    upstreamServer.registerTool('echo', { description: 'Echoes text', inputSchema: z.object({ text: z.string() }) }, ({ text }) => ({
        content: [{ type: 'text', text }]
    }));
    upstreamServer.registerTool(
        'annotated',
        {
            description: 'Annotated tool',
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true, idempotentHint: true },
            _meta: { 'example.com/fixture': true }
        },
        () => ({ content: [] })
    );
    upstreamServer.registerResource(
        'annotated',
        'file:///annotated.md',
        {
            mimeType: 'text/markdown',
            _meta: { 'example.com/fixture': true }
        },
        async () => ({
            contents: [{ uri: 'file:///annotated.md', mimeType: 'text/markdown', text: '# Annotated' }]
        })
    );

    // Proxy: low-level Server downstream + Client upstream
    const upstreamClient = new Client({ name: 'proxy-upstream', version: '0' });
    const proxyServer = new Server({ name: 'proxy', version: '0' }, { capabilities: { tools: {}, resources: {} } });

    proxyServer.setRequestHandler(ListToolsRequestSchema, async req => {
        const result = await upstreamClient.listTools(req.params);
        return { tools: result.tools, nextCursor: result.nextCursor };
    });
    proxyServer.setRequestHandler(ListResourcesRequestSchema, async req => {
        const result = await upstreamClient.listResources(req.params);
        return { resources: result.resources, nextCursor: result.nextCursor };
    });
    proxyServer.setRequestHandler(ReadResourceRequestSchema, async req => {
        return upstreamClient.readResource(req.params);
    });

    // Wire: downstream client → proxy server → upstream client → upstream server
    const downstreamClient = new Client({ name: 'downstream', version: '0' });

    await using _upstreamW = await wire(transport, () => upstreamServer, upstreamClient);
    await using _proxyW = await wire(transport, () => proxyServer, downstreamClient);

    // Downstream sees upstream tools
    const { tools } = await downstreamClient.listTools();
    const echo = tools.find(t => t.name === 'echo');
    expect(echo).toBeDefined();
    expect(echo!.description).toBe('Echoes text');
    expect(echo!.inputSchema.properties).toMatchObject({ text: { type: 'string' } });

    const annotatedTool = tools.find(t => t.name === 'annotated');
    expect(annotatedTool).toBeDefined();
    expect(annotatedTool!.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(annotatedTool!._meta).toEqual({ 'example.com/fixture': true });

    // Downstream sees upstream resources
    const { resources } = await downstreamClient.listResources();
    const annotatedRes = resources.find(r => r.uri === 'file:///annotated.md');
    expect(annotatedRes).toBeDefined();
    expect(annotatedRes!.name).toBe('annotated');
    expect(annotatedRes!._meta).toEqual({ 'example.com/fixture': true });
}
