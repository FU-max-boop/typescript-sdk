/**
 * Self-contained test bodies for the roots surface.
 *
 * Roots are a client capability: the client exposes filesystem roots to the
 * server. The server can request them via `roots/list`, and the client notifies
 * the server when roots change via `notifications/roots/list_changed`.
 */

import { expect, vi } from 'vitest';

import { z } from 'zod/v4';

import { Client } from '../../../src/client/index.js';
import { McpServer } from '../../../src/server/mcp.js';
import { type ListRootsResult, ListRootsRequestSchema, RootsListChangedNotificationSchema } from '../../../src/types.js';

import { wire } from '../helpers/index.js';
import type { TestArgs } from '../types.js';

export async function rootsListBasic({ transport }: TestArgs) {
    const received: Array<{ method: string }> = [];
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        // Drive the server→client call via the typed Server.listRoots() helper —
        // this is the user-facing API and exercises the capability check.
        s.registerTool('list-roots', { inputSchema: z.object({}) }, async () => {
            const result = await s.server.listRoots();
            return { structuredContent: { ok: true, result }, content: [] };
        });
        return s;
    };

    const client = new Client({ name: 'c', version: '0' }, { capabilities: { roots: { listChanged: true } } });
    client.setRequestHandler(ListRootsRequestSchema, async req => {
        received.push({ method: req.method });
        return {
            roots: [{ uri: 'file:///home/user/projects/myproject', name: 'My Project' }, { uri: 'file:///home/user/repos/backend' }]
        };
    });

    await using _ = await wire(transport, makeServer, client);

    const result = await client.callTool({ name: 'list-roots', arguments: {} });

    expect(received).toHaveLength(1);
    expect(received[0].method).toBe('roots/list');

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
        ok: true,
        result: {
            roots: [{ uri: 'file:///home/user/projects/myproject', name: 'My Project' }, { uri: 'file:///home/user/repos/backend' }]
        }
    });
}

export async function rootsListChanged({ transport }: TestArgs) {
    const refetched: ListRootsResult[] = [];
    let server!: McpServer;
    const makeServer = () => {
        server = new McpServer({ name: 's', version: '0' });
        server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
            refetched.push(await server.server.listRoots());
        });
        return server;
    };

    let roots = [{ uri: 'file:///home/user/projects/a', name: 'A' }];
    const client = new Client({ name: 'c', version: '0' }, { capabilities: { roots: { listChanged: true } } });
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots }));

    await using _ = await wire(transport, makeServer, client);

    // Change roots, signal the server, and observe the server's re-request
    // returning the *new* roots.
    roots = [
        { uri: 'file:///home/user/projects/a', name: 'A' },
        { uri: 'file:///home/user/projects/b', name: 'B' }
    ];
    await client.sendRootsListChanged();
    await vi.waitFor(() => expect(refetched).toHaveLength(1));
    expect(refetched[0].roots).toEqual(roots);

    roots = [{ uri: 'file:///home/user/projects/b', name: 'B' }];
    await client.sendRootsListChanged();
    await vi.waitFor(() => expect(refetched).toHaveLength(2));
    expect(refetched[1].roots).toEqual(roots);
}
