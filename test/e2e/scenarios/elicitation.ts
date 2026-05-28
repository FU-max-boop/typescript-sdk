/**
 * Self-contained test bodies for elicitation (form and URL modes).
 *
 * Each export is a {@link TestCase}: it builds its own server, client, wires
 * them with {@link wire}, and asserts. Elicitation is a server→client request
 * flow, so tests inline `client.setRequestHandler(ElicitRequestSchema, ...)` to
 * script the responses the server will receive.
 *
 * Function names mirror the requirement id in camelCase.
 */

import { expect } from 'vitest';
import { z } from 'zod/v4';

import { Client } from '../../../src/client/index.js';
import { Server } from '../../../src/server/index.js';
import { McpServer } from '../../../src/server/mcp.js';
import {
    CallToolRequestSchema,
    ElicitationCompleteNotificationSchema,
    type ElicitRequest,
    type ElicitRequestFormParams,
    ElicitRequestSchema,
    ElicitResultSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
    UrlElicitationRequiredError
} from '../../../src/types.js';

import { wire } from '../helpers/index.js';
import type { TestArgs } from '../types.js';

/** Client with form-mode elicitation support. */
const formClient = () => new Client({ name: 'c', version: '0' }, { capabilities: { elicitation: { form: {} } } });

/** Client with form-mode elicitation AND applyDefaults support. */
const formClientWithDefaults = () =>
    new Client({ name: 'c', version: '0' }, { capabilities: { elicitation: { form: { applyDefaults: true } } } });

/** Client with URL-mode elicitation support. */
const urlClient = () => new Client({ name: 'c', version: '0' }, { capabilities: { elicitation: { url: {} } } });

export async function elicitationFormBasic({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('ask-name', { inputSchema: z.object({}) }, async () => {
            const ans = await s.server.elicitInput({
                mode: 'form',
                message: 'What is your name?',
                requestedSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
            });
            const name = ans.action === 'accept' ? String(ans.content?.name) : '<declined>';
            return { content: [{ type: 'text', text: `Hello, ${name}` }] };
        });
        return s;
    };

    const received: Array<{ method: string; params: unknown }> = [];
    const client = formClient();
    client.setRequestHandler(ElicitRequestSchema, async req => {
        received.push({ method: req.method, params: req.params });
        return { action: 'accept', content: { name: 'Ada' } };
    });

    await using _ = await wire(transport, makeServer, client);

    const r = await client.callTool({ name: 'ask-name', arguments: {} });

    expect(received).toHaveLength(1);
    expect(received[0].method).toBe('elicitation/create');
    expect(received[0].params).toMatchObject({
        mode: 'form',
        message: 'What is your name?',
        requestedSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
    });

    expect(r.isError).toBeFalsy();
    expect(r.content).toEqual([{ type: 'text', text: 'Hello, Ada' }]);
}

export async function elicitationFormActionAccept({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('ask', { inputSchema: z.object({}) }, async () => {
            const ans = await s.server.elicitInput({
                mode: 'form',
                message: 'Enter name',
                requestedSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
            });
            return {
                content: [{ type: 'text', text: ans.action === 'accept' ? String(ans.content?.name) : 'none' }]
            };
        });
        return s;
    };

    const client = formClient();
    client.setRequestHandler(ElicitRequestSchema, async () => {
        return { action: 'accept', content: { name: 'Ada' } };
    });

    await using _ = await wire(transport, makeServer, client);

    const r = await client.callTool({ name: 'ask', arguments: {} });
    expect(r.content).toEqual([{ type: 'text', text: 'Ada' }]);
}

export async function elicitationFormActionCancel({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('ask', { inputSchema: z.object({}) }, async () => {
            const ans = await s.server.elicitInput({
                mode: 'form',
                message: 'Enter name',
                requestedSchema: { type: 'object', properties: { name: { type: 'string' } } }
            });
            return {
                content: [{ type: 'text', text: `action:${ans.action},hasContent:${'content' in ans && ans.content !== undefined}` }]
            };
        });
        return s;
    };

    const client = formClient();
    client.setRequestHandler(ElicitRequestSchema, async () => {
        return { action: 'cancel' };
    });

    await using _ = await wire(transport, makeServer, client);

    const r = await client.callTool({ name: 'ask', arguments: {} });
    expect(r.content).toEqual([{ type: 'text', text: 'action:cancel,hasContent:false' }]);
}

export async function elicitationFormActionDecline({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('ask', { inputSchema: z.object({}) }, async () => {
            const ans = await s.server.elicitInput({
                mode: 'form',
                message: 'Enter name',
                requestedSchema: { type: 'object', properties: { name: { type: 'string' } } }
            });
            return {
                content: [{ type: 'text', text: `action:${ans.action},hasContent:${'content' in ans && ans.content !== undefined}` }]
            };
        });
        return s;
    };

    const client = formClient();
    client.setRequestHandler(ElicitRequestSchema, async () => {
        return { action: 'decline' };
    });

    await using _ = await wire(transport, makeServer, client);

    const r = await client.callTool({ name: 'ask', arguments: {} });
    expect(r.content).toEqual([{ type: 'text', text: 'action:decline,hasContent:false' }]);
}

export async function elicitationFormDefaults({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('ask', { inputSchema: z.object({}) }, async () => {
            const ans = await s.server.elicitInput({
                mode: 'form',
                message: 'Fill form',
                requestedSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', default: 'anon' },
                        age: { type: 'integer', default: 42 },
                        subscribe: { type: 'boolean', default: true }
                    }
                }
            });
            return { content: [], structuredContent: ans.action === 'accept' ? ans.content : undefined };
        });
        return s;
    };

    const client = formClientWithDefaults();
    client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept', content: { name: 'Ada' } }));

    await using _ = await wire(transport, makeServer, client);

    const r = await client.callTool({ name: 'ask', arguments: {} });
    expect(r.structuredContent).toEqual({ name: 'Ada', age: 42, subscribe: true });
}

export async function elicitationFormModeOmittedDefault({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new Server({ name: 's', version: '0' }, { capabilities: { tools: {} } });
        s.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{ name: 'ask', inputSchema: { type: 'object' } }] }));
        s.setRequestHandler(CallToolRequestSchema, async (_req, extra) => {
            try {
                const ans = await extra.sendRequest(
                    {
                        method: 'elicitation/create',
                        params: {
                            message: 'Enter name',
                            requestedSchema: { type: 'object', properties: { name: { type: 'string' } } }
                        }
                    },
                    ElicitResultSchema
                );
                return { content: [{ type: 'text', text: ans.action }] };
            } catch (e) {
                if (!(e instanceof McpError)) throw e;
                return { content: [{ type: 'text', text: `error:${e.code}` }] };
            }
        });
        return s;
    };

    const formReceived: ElicitRequest['params'][] = [];
    const formClientInstance = formClient();
    formClientInstance.setRequestHandler(ElicitRequestSchema, async req => {
        formReceived.push(req.params);
        return { action: 'accept', content: { name: 'Test' } };
    });

    await using _1 = await wire(transport, makeServer, formClientInstance);

    const formResult = await formClientInstance.callTool({ name: 'ask', arguments: {} });

    expect(formReceived).toHaveLength(1);
    expect(formReceived[0].mode).toBeUndefined();
    expect(formResult.content).toEqual([{ type: 'text', text: 'accept' }]);

    let urlHandlerInvoked = 0;
    const urlClientInstance = urlClient();
    urlClientInstance.setRequestHandler(ElicitRequestSchema, async () => {
        urlHandlerInvoked++;
        return { action: 'accept' };
    });

    await using _2 = await wire(transport, makeServer, urlClientInstance);

    const urlResult = await urlClientInstance.callTool({ name: 'ask', arguments: {} });
    expect(urlResult.content).toEqual([{ type: 'text', text: `error:${ErrorCode.InvalidParams}` }]);
    expect(urlHandlerInvoked).toBe(0);
}

export async function elicitationFormSchemaPrimitives({ transport }: TestArgs) {
    const requestedSchema: ElicitRequestFormParams['requestedSchema'] = {
        type: 'object',
        properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            age: { type: 'integer' },
            score: { type: 'number' },
            active: { type: 'boolean' }
        }
    };
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('ask', { inputSchema: z.object({}) }, async () => {
            const ans = await s.server.elicitInput({ mode: 'form', message: 'Fill form', requestedSchema });
            return { content: [], structuredContent: ans.action === 'accept' ? ans.content : undefined };
        });
        return s;
    };

    const expected = { name: 'Ada', email: 'ada@example.com', age: 30, score: 95.5, active: true };
    const received: ElicitRequest['params'][] = [];
    const client = formClient();
    client.setRequestHandler(ElicitRequestSchema, async req => {
        received.push(req.params);
        return { action: 'accept', content: expected };
    });

    await using _ = await wire(transport, makeServer, client);

    const r = await client.callTool({ name: 'ask', arguments: {} });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ mode: 'form', message: 'Fill form', requestedSchema });
    expect(r.structuredContent).toEqual(expected);
}

export async function elicitationFormSchemaEnumVariants({ transport }: TestArgs) {
    const requestedSchema: ElicitRequestFormParams['requestedSchema'] = {
        type: 'object',
        properties: {
            bare: { type: 'string', enum: ['Red', 'Green', 'Blue'] },
            titled: {
                type: 'string',
                oneOf: [
                    { const: '#FF0000', title: 'Red' },
                    { const: '#00FF00', title: 'Green' }
                ]
            },
            multi: {
                type: 'array',
                items: {
                    anyOf: [
                        { const: '#FF0000', title: 'Red' },
                        { const: '#0000FF', title: 'Blue' }
                    ]
                }
            }
        }
    };
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('ask', { inputSchema: z.object({}) }, async () => {
            const ans = await s.server.elicitInput({ mode: 'form', message: 'Pick colors', requestedSchema });
            return { content: [], structuredContent: ans.action === 'accept' ? ans.content : undefined };
        });
        return s;
    };

    const expected = { bare: 'Red', titled: '#00FF00', multi: ['#FF0000', '#0000FF'] };
    const received: ElicitRequest['params'][] = [];
    const client = formClient();
    client.setRequestHandler(ElicitRequestSchema, async req => {
        received.push(req.params);
        return { action: 'accept', content: expected };
    });

    await using _ = await wire(transport, makeServer, client);

    const r = await client.callTool({ name: 'ask', arguments: {} });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ mode: 'form', message: 'Pick colors', requestedSchema });
    expect(r.structuredContent).toEqual(expected);
}

export async function elicitationUrlBasic({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('auth', { inputSchema: z.object({}) }, async () => {
            const ans = await s.server.elicitInput({
                mode: 'url',
                message: 'Please sign in',
                elicitationId: 'url-1',
                url: 'https://example.com/auth?state=test'
            });
            return { content: [{ type: 'text', text: ans.action }] };
        });
        return s;
    };

    const received: ElicitRequest['params'][] = [];
    const client = urlClient();
    client.setRequestHandler(ElicitRequestSchema, async req => {
        received.push(req.params);
        return { action: 'accept' };
    });

    await using _ = await wire(transport, makeServer, client);

    const r = await client.callTool({ name: 'auth', arguments: {} });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
        mode: 'url',
        message: 'Please sign in',
        elicitationId: 'url-1',
        url: 'https://example.com/auth?state=test'
    });
    expect(r.content).toEqual([{ type: 'text', text: 'accept' }]);
}

export async function elicitationUrlActionAcceptNoContent({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('auth', { inputSchema: z.object({}) }, async () => {
            const ans = await s.server.elicitInput({
                mode: 'url',
                message: 'Please sign in',
                elicitationId: 'url-2',
                url: 'https://example.com/auth'
            });
            return {
                content: [{ type: 'text', text: `action:${ans.action},hasContent:${'content' in ans && ans.content !== undefined}` }]
            };
        });
        return s;
    };

    const client = urlClient();
    client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept' }));

    await using _ = await wire(transport, makeServer, client);

    const r = await client.callTool({ name: 'auth', arguments: {} });
    expect(r.content).toEqual([{ type: 'text', text: 'action:accept,hasContent:false' }]);
}

export async function elicitationUrlCompleteNotification({ transport }: TestArgs) {
    const notifications: Array<{ method: string; params: unknown }> = [];

    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('auth', { inputSchema: z.object({}) }, async () => {
            throw new UrlElicitationRequiredError([
                {
                    mode: 'url',
                    message: 'Sign in required',
                    elicitationId: 'complete-1',
                    url: 'https://example.com/auth'
                }
            ]);
        });
        s.registerTool('complete', { inputSchema: z.object({ elicitationId: z.string() }) }, async ({ elicitationId }, extra) => {
            const notify = s.server.createElicitationCompletionNotifier(elicitationId, { relatedRequestId: extra.requestId });
            await notify();
            return { content: [{ type: 'text', text: 'notified' }] };
        });
        return s;
    };

    const client = urlClient();
    client.setNotificationHandler(ElicitationCompleteNotificationSchema, n => {
        notifications.push({ method: n.method, params: n.params });
    });

    await using _ = await wire(transport, makeServer, client);

    const err = await client.callTool({ name: 'auth', arguments: {} }).catch(e => e);
    if (!(err instanceof UrlElicitationRequiredError)) throw new Error(`expected UrlElicitationRequiredError, got ${err}`);
    const elicitationId = err.elicitations[0].elicitationId;

    await client.callTool({ name: 'complete', arguments: { elicitationId } });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toEqual({
        method: 'notifications/elicitation/complete',
        params: { elicitationId: 'complete-1' }
    });
}

export async function elicitationUrlCompleteUnknownIgnored({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('auth', { inputSchema: z.object({}) }, () => {
            throw new UrlElicitationRequiredError([
                { mode: 'url', message: 'Sign in required', elicitationId: 'seen-1', url: 'https://example.com/auth' }
            ]);
        });
        // Raw send: the server-side capability gate cannot pass on stateless (client capabilities never learned),
        // and the behavior under test is the client's handling of the notification.
        s.registerTool('complete', { inputSchema: z.object({ elicitationId: z.string() }) }, async ({ elicitationId }, extra) => {
            await s.server.transport!.send(
                { jsonrpc: '2.0', method: 'notifications/elicitation/complete', params: { elicitationId } },
                { relatedRequestId: extra.requestId }
            );
            return { content: [{ type: 'text', text: 'sent' }] };
        });
        s.registerTool('noop', { inputSchema: z.object({}) }, () => ({ content: [] }));
        return s;
    };

    const notifications: Array<{ method: string; params: unknown }> = [];
    const errors: Error[] = [];
    const client = urlClient();
    client.onerror = e => errors.push(e);
    client.setNotificationHandler(ElicitationCompleteNotificationSchema, n => {
        notifications.push({ method: n.method, params: n.params });
    });

    await using _ = await wire(transport, makeServer, client);

    const err = await client.callTool({ name: 'auth', arguments: {} }).catch(e => e);
    if (!(err instanceof UrlElicitationRequiredError)) throw new Error(`expected UrlElicitationRequiredError, got ${err}`);
    const seenId = err.elicitations[0].elicitationId;

    await client.callTool({ name: 'complete', arguments: { elicitationId: seenId } });
    // Already-completed id, then an id the client never saw: both must be ignored without error.
    await client.callTool({ name: 'complete', arguments: { elicitationId: seenId } });
    await client.callTool({ name: 'complete', arguments: { elicitationId: 'never-issued' } });

    expect(notifications).toEqual([
        { method: 'notifications/elicitation/complete', params: { elicitationId: 'seen-1' } },
        { method: 'notifications/elicitation/complete', params: { elicitationId: 'seen-1' } },
        { method: 'notifications/elicitation/complete', params: { elicitationId: 'never-issued' } }
    ]);
    expect(errors).toEqual([]);

    const after = await client.callTool({ name: 'noop', arguments: {} });
    expect(after.isError).toBeFalsy();
    expect(after.content).toEqual([]);
}

export async function elicitationUrlRequiredError({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('auth-required', { inputSchema: z.object({}) }, () => {
            throw new UrlElicitationRequiredError([
                {
                    mode: 'url',
                    message: 'Please authenticate',
                    elicitationId: 'err-1',
                    url: 'https://example.com/oauth'
                }
            ]);
        });
        return s;
    };

    const client = urlClient();
    await using _ = await wire(transport, makeServer, client);

    const err = await client.callTool({ name: 'auth-required', arguments: {} }).catch(e => e);
    if (!(err instanceof UrlElicitationRequiredError)) throw new Error(`expected UrlElicitationRequiredError, got ${err}`);
    expect(err.code).toBe(ErrorCode.UrlElicitationRequired);
    expect(err.elicitations).toHaveLength(1);
    expect(err.elicitations[0]).toMatchObject({
        mode: 'url',
        message: 'Please authenticate',
        elicitationId: 'err-1',
        url: 'https://example.com/oauth'
    });
}

export async function elicitationCapabilityEmptyIsForm({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('ask', { inputSchema: z.object({}) }, async () => {
            const ans = await s.server.elicitInput({
                mode: 'form',
                message: 'Name?',
                requestedSchema: { type: 'object', properties: { name: { type: 'string' } } }
            });
            return { content: [{ type: 'text', text: ans.action }] };
        });
        return s;
    };

    const client = new Client({ name: 'c', version: '0' }, { capabilities: { elicitation: {} } });
    client.setRequestHandler(ElicitRequestSchema, async () => {
        return { action: 'accept', content: { name: 'Test' } };
    });

    await using _ = await wire(transport, makeServer, client);

    const r = await client.callTool({ name: 'ask', arguments: {} });
    expect(r.content).toEqual([{ type: 'text', text: 'accept' }]);
}

export async function elicitationCapabilityModeMismatch({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new Server({ name: 's', version: '0' }, { capabilities: { tools: {} } });
        s.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [{ name: 'auth', inputSchema: { type: 'object' } }] }));
        s.setRequestHandler(CallToolRequestSchema, async (_req, extra) => {
            try {
                await extra.sendRequest(
                    {
                        method: 'elicitation/create',
                        params: { mode: 'url', message: 'Sign in', elicitationId: 'mismatch-1', url: 'https://example.com/auth' }
                    },
                    ElicitResultSchema
                );
                return { content: [{ type: 'text', text: 'should-not-reach' }] };
            } catch (e) {
                if (!(e instanceof McpError)) throw e;
                return { content: [{ type: 'text', text: `error:${e.code}` }] };
            }
        });
        return s;
    };

    let handlerInvoked = 0;
    const client = formClient();
    client.setRequestHandler(ElicitRequestSchema, async () => {
        handlerInvoked++;
        return { action: 'accept', content: {} };
    });

    await using _ = await wire(transport, makeServer, client);

    const r = await client.callTool({ name: 'auth', arguments: {} });
    expect(r.content).toEqual([{ type: 'text', text: `error:${ErrorCode.InvalidParams}` }]);
    expect(handlerInvoked).toBe(0);
}

export async function elicitationCapabilityServerRespectsMode({ transport }: TestArgs) {
    let reachedClient = 0;
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('auth', { inputSchema: z.object({}) }, async () => {
            try {
                await s.server.elicitInput({
                    mode: 'url',
                    message: 'Sign in',
                    elicitationId: 'gate-1',
                    url: 'https://example.com/auth'
                });
                return { isError: true, content: [{ type: 'text', text: 'SDK let it through' }] };
            } catch (e) {
                return { content: [{ type: 'text', text: `refused:${e instanceof Error ? e.message : e}` }] };
            }
        });
        return s;
    };

    const client = formClient();
    client.setRequestHandler(ElicitRequestSchema, async () => {
        reachedClient++;
        return { action: 'accept' };
    });

    await using _ = await wire(transport, makeServer, client);

    const r = await client.callTool({ name: 'auth', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(r.content).toEqual([{ type: 'text', text: expect.stringMatching(/^refused:.*url elicitation/i) }]);
    expect(reachedClient).toBe(0);
}
