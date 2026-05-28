/**
 * Self-contained test bodies for the lifecycle surface.
 *
 * Lifecycle tests cover the initialize handshake, version negotiation,
 * the `notifications/initialized` ordering rule, ping, and the metadata
 * accessors on both ends (`getServerVersion`/`getServerCapabilities` on the
 * client, `getClientVersion`/`getClientCapabilities` on the server). Each
 * export is a {@link TestCase}: it builds its own server (via a factory),
 * builds its own client, wires them with {@link wire}, and asserts. Function
 * names mirror the requirement id in camelCase.
 */

import { expect } from 'vitest';
import { z } from 'zod/v4';

import { Client } from '../../../src/client/index.js';
import { Server } from '../../../src/server/index.js';
import { McpServer } from '../../../src/server/mcp.js';
import {
    type ClientCapabilities,
    CreateMessageRequestSchema,
    ElicitRequestSchema,
    type Implementation,
    type InitializeRequest,
    InitializeRequestSchema,
    isJSONRPCRequest,
    isJSONRPCResultResponse,
    LATEST_PROTOCOL_VERSION,
    ListRootsRequestSchema,
    type ServerCapabilities,
    SUPPORTED_PROTOCOL_VERSIONS
} from '../../../src/types.js';

import { tapWire, wire } from '../helpers/index.js';
import type { TestArgs } from '../types.js';

const OLDER_SUPPORTED_VERSION = SUPPORTED_PROTOCOL_VERSIONS.find(v => v !== LATEST_PROTOCOL_VERSION)!;
const BOGUS_VERSION = '1999-01-01';

const DEFAULT_INSTRUCTIONS = 'This is the default server instruction set for lifecycle tests.';

function minimalClient() {
    return new Client({ name: 'minimal-client', version: '0.0.0' });
}

function minimalServer(): McpServer {
    return new McpServer({ name: 'minimal-server', version: '0.0.0' });
}

/**
 * Raw `Server` whose initialize handler echoes the inbound request to
 * `received` and replies with the given `protocolVersion`. Used by the
 * version-negotiation tests so both sides of the handshake are observable
 * via public API only.
 */
function recordingInitServer(replyVersion: string, received: InitializeRequest['params'][]): Server {
    const s = new Server({ name: 's', version: '0' }, { capabilities: {} });
    s.setRequestHandler(InitializeRequestSchema, async req => {
        received.push(req.params);
        return { protocolVersion: replyVersion, capabilities: {}, serverInfo: { name: 's', version: '0' } };
    });
    return s;
}

export async function lifecycleInitializeBasic({ transport }: TestArgs) {
    const SERVER_CAPS: ServerCapabilities = { tools: { listChanged: true }, logging: {} };

    const initReqs: InitializeRequest['params'][] = [];
    const makeServer = () => {
        const s = new Server({ name: 'lifecycle-server', version: '1.2.3' }, { capabilities: SERVER_CAPS });
        s.setRequestHandler(InitializeRequestSchema, async req => {
            initReqs.push(req.params);
            return {
                protocolVersion: req.params.protocolVersion,
                capabilities: SERVER_CAPS,
                serverInfo: { name: 'lifecycle-server', version: '1.2.3' }
            };
        });
        return s;
    };
    const client = new Client({ name: 'lifecycle-client', version: '0.0.0' }, { capabilities: { roots: {} } });

    await using _ = await wire(transport, makeServer, client);

    // Server saw an InitializeRequest with all spec-mandated fields populated.
    expect(initReqs).toHaveLength(1);
    expect(initReqs[0].protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    expect(initReqs[0].clientInfo).toEqual({ name: 'lifecycle-client', version: '0.0.0' });
    expect(initReqs[0].capabilities).toEqual({ roots: {} });

    // Client surfaces what the server returned.
    expect(client.getServerVersion()).toEqual({ name: 'lifecycle-server', version: '1.2.3' });
    expect(client.getServerCapabilities()).toEqual(SERVER_CAPS);
}

export async function lifecycleInitializeInstructions({ transport }: TestArgs) {
    const makeServer = () => new McpServer({ name: 's', version: '0' }, { instructions: DEFAULT_INSTRUCTIONS });
    const client = minimalClient();

    await using _ = await wire(transport, makeServer, client);

    expect(client.getInstructions()).toBe(DEFAULT_INSTRUCTIONS);
}

export async function lifecycleInitializedNotification({ transport }: TestArgs) {
    const order: string[] = [];
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' }, { capabilities: { tools: {} } });
        s.server.oninitialized = () => order.push('initialized');
        s.registerTool('marker', { inputSchema: z.object({}) }, () => {
            order.push('request');
            return { content: [{ type: 'text', text: 'ok' }] };
        });
        return s;
    };
    const client = minimalClient();

    await using _ = await wire(transport, makeServer, client);
    expect(order).toContain('initialized');

    await client.callTool({ name: 'marker', arguments: {} });

    // Wherever a request arrived, the immediately-preceding event in the
    // server-side order log is the initialized hook firing — i.e., the client
    // sent notifications/initialized before any other request.
    const reqIdx = order.indexOf('request');
    expect(reqIdx).toBeGreaterThan(0);
    expect(order[reqIdx - 1]).toBe('initialized');
}

export async function lifecyclePing({ transport }: TestArgs) {
    const client = minimalClient();
    await using _ = await wire(transport, minimalServer, client);

    const tap = tapWire(client);
    const result = await client.ping();
    expect(result).toEqual({});

    const req = tap.sent.find(m => isJSONRPCRequest(m) && m.method === 'ping');
    expect(req).toBeDefined();
    if (!req || !isJSONRPCRequest(req)) throw new Error('expected ping request');

    const res = tap.received.find(m => isJSONRPCResultResponse(m) && m.id === req.id);
    if (!res || !isJSONRPCResultResponse(res)) throw new Error('expected ping result');
    expect(res.result).toEqual({});
}

export async function lifecycleVersionMatch({ transport }: TestArgs) {
    const initReqs: InitializeRequest['params'][] = [];
    const makeServer = () => recordingInitServer(LATEST_PROTOCOL_VERSION, initReqs);
    const client = minimalClient();

    await using _ = await wire(transport, makeServer, client);

    expect(initReqs).toHaveLength(1);
    expect(initReqs[0].protocolVersion).toBe(LATEST_PROTOCOL_VERSION);

    // Connect succeeded at the matched version: server state is populated.
    expect(client.getServerCapabilities()).toEqual({});
    expect(client.getServerVersion()).toEqual({ name: 's', version: '0' });
}

export async function lifecycleVersionDowngrade({ transport }: TestArgs) {
    const initReqs: InitializeRequest['params'][] = [];
    const makeServer = () => recordingInitServer(OLDER_SUPPORTED_VERSION, initReqs);
    const client = minimalClient();

    await using _ = await wire(transport, makeServer, client);

    // Client requested LATEST; server replied with an older supported version;
    // connect resolved (no throw) and server state is populated, so the client
    // accepted the downgrade. There is no transport-agnostic SDK getter for the
    // negotiated version (`client.transport.protocolVersion` is HTTP-only).
    expect(initReqs).toHaveLength(1);
    expect(initReqs[0].protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    expect(OLDER_SUPPORTED_VERSION).not.toBe(LATEST_PROTOCOL_VERSION);
    expect(client.getServerCapabilities()).toEqual({});
    expect(client.getServerVersion()).toEqual({ name: 's', version: '0' });
}

export async function lifecycleVersionRejectUnsupported({ transport }: TestArgs) {
    const initReqs: InitializeRequest['params'][] = [];
    const makeServer = () => recordingInitServer(BOGUS_VERSION, initReqs);
    const client = minimalClient();

    await expect(wire(transport, makeServer, client)).rejects.toThrow(/protocol version.*not supported|1999-01-01/i);

    expect(client.transport).toBeUndefined();
    expect(client.getServerCapabilities()).toBeUndefined();
    expect(client.getServerVersion()).toBeUndefined();
}

export async function lifecycleCapabilityClientNotDeclared({ transport }: TestArgs) {
    let observedCaps: ClientCapabilities | undefined;
    const makeServer = () => {
        const s = minimalServer();
        s.server.oninitialized = () => {
            observedCaps = s.server.getClientCapabilities();
        };
        return s;
    };
    const client = new Client({ name: 'no-caps-client', version: '0.0.0' }, { capabilities: {} });

    await using _ = await wire(transport, makeServer, client);

    // Client side: cannot send notifications / register handlers for undeclared caps.
    await expect(client.sendRootsListChanged()).rejects.toThrow(/roots.*list.?changed/i);
    expect(() =>
        client.setRequestHandler(CreateMessageRequestSchema, async () => ({
            role: 'assistant',
            content: { type: 'text', text: 'unreachable' },
            model: 'stub'
        }))
    ).toThrow(/sampling/i);
    expect(() => client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'cancel' }))).toThrow(/elicitation/i);
    expect(() => client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [] }))).toThrow(/roots/i);

    // Server side: it sees the empty client capabilities. (Server-side request
    // gating on these is opt-in via `enforceStrictCapabilities` and is covered
    // by the elicitation/sampling capability tests, not here.)
    expect(observedCaps).toEqual({});
}

export async function lifecycleCapabilityServerNotAdvertised({ transport }: TestArgs) {
    const makeServer = () => new McpServer({ name: 's', version: '0' }, { capabilities: {} });
    const client = new Client({ name: 'c', version: '0' }, { enforceStrictCapabilities: true });

    await using _ = await wire(transport, makeServer, client);

    const caps = client.getServerCapabilities();
    expect(caps).toEqual({});

    const calls: Array<[string, () => Promise<unknown>]> = [
        ['tools', () => client.listTools()],
        ['resources', () => client.listResources()],
        ['resources', () => client.listResourceTemplates()],
        ['prompts', () => client.listPrompts()],
        ['logging', () => client.setLoggingLevel('debug')],
        ['completions', () => client.complete({ ref: { type: 'ref/prompt', name: 'x' }, argument: { name: 'a', value: '' } })]
    ];
    for (const [cap, call] of calls) {
        await expect(call(), `${cap} should be gated`).rejects.toThrow(new RegExp(cap, 'i'));
    }
}

export async function lifecycleCapabilityExperimentalPassthrough({ transport }: TestArgs) {
    const SERVER_EXPERIMENTAL = {
        'x-vendor/streaming': { version: 2, modes: ['delta', 'full'] },
        'org.example.preview': { nested: { limit: 42 }, enabled: true }
    };
    const CLIENT_EXPERIMENTAL = {
        'x-vendor/telemetry': { level: 'debug', sinks: ['stdout'] }
    };

    let observedClientCaps: ClientCapabilities | undefined;
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' }, { capabilities: { experimental: SERVER_EXPERIMENTAL } });
        s.server.oninitialized = () => {
            observedClientCaps = s.server.getClientCapabilities();
        };
        return s;
    };

    const client = new Client(
        { name: 'c', version: '0' },
        { capabilities: { roots: { listChanged: true }, experimental: CLIENT_EXPERIMENTAL } }
    );

    await using _ = await wire(transport, makeServer, client);

    // Server → client direction.
    const serverCaps = client.getServerCapabilities();
    expect(serverCaps?.experimental).toEqual(SERVER_EXPERIMENTAL);
    expect(serverCaps?.experimental?.['x-vendor/streaming']).toEqual({ version: 2, modes: ['delta', 'full'] });
    expect(serverCaps?.experimental?.['x-vendor/undeclared']).toBeUndefined();

    // Client → server direction (symmetric).
    expect(observedClientCaps?.experimental).toEqual(CLIENT_EXPERIMENTAL);
    expect(observedClientCaps?.experimental?.['x-vendor/undeclared']).toBeUndefined();
}

export async function lifecycleInitializeServerInfoExtended({ transport }: TestArgs) {
    const extendedServerInfo: Implementation = {
        name: 'everything-extended',
        version: '1.2.3',
        title: 'Everything Server (Extended)',
        websiteUrl: 'https://example.com/everything',
        description: 'Reference everything-server with all optional Implementation fields populated.',
        icons: [
            { src: 'https://example.com/icon-48.png', mimeType: 'image/png', sizes: ['48x48'] },
            { src: 'https://example.com/icon.svg', mimeType: 'image/svg+xml', sizes: ['any'] }
        ]
    };

    const makeServer = () => new McpServer(extendedServerInfo);
    const client = minimalClient();

    await using _ = await wire(transport, makeServer, client);

    expect(client.getServerVersion()).toEqual(extendedServerInfo);
}

export async function lifecycleServerGetClientVersion({ transport }: TestArgs) {
    let observed: { before: Implementation | undefined; after: Implementation | undefined } | undefined;
    const makeServer = () => {
        const s = minimalServer();
        const before = s.server.getClientVersion();
        s.server.oninitialized = () => {
            observed = { before, after: s.server.getClientVersion() };
        };
        return s;
    };
    const client = minimalClient();

    await using _ = await wire(transport, makeServer, client);

    expect(observed?.before).toBeUndefined();
    expect(observed?.after).toEqual({ name: 'minimal-client', version: '0.0.0' });
}

export async function serverGetClientCapabilities({ transport }: TestArgs) {
    const DECLARED = {
        roots: { listChanged: true },
        sampling: {},
        experimental: { 'e2e-cap-marker': {} }
    };

    let observed:
        | { before: ClientCapabilities | undefined; after: ClientCapabilities | undefined; second: ClientCapabilities | undefined }
        | undefined;
    const makeServer = () => {
        const s = minimalServer();
        const before = s.server.getClientCapabilities();
        s.server.oninitialized = () => {
            const after = s.server.getClientCapabilities();
            observed = { before, after, second: s.server.getClientCapabilities() };
        };
        return s;
    };
    const client = new Client({ name: 'caps-probe-client', version: '0.0.0' }, { capabilities: DECLARED });

    await using _ = await wire(transport, makeServer, client);

    expect(observed?.before).toBeUndefined();
    expect(observed?.after).toEqual(DECLARED);
    expect(observed?.after?.elicitation).toBeUndefined();
    // Stable reference across calls.
    expect(observed?.second).toBe(observed?.after);
}
