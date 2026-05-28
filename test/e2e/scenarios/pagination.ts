/**
 * Self-contained test bodies for cursor-pagination behaviors that span all
 * paginated list operations (tools/list, resources/list,
 * resources/templates/list, prompts/list).
 */

import { expect } from 'vitest';
import { z } from 'zod/v4';

import { Client } from '../../../src/client/index.js';
import { McpServer, ResourceTemplate } from '../../../src/server/mcp.js';
import { ErrorCode, McpError } from '../../../src/types.js';

import { wire } from '../helpers/index.js';
import type { TestArgs } from '../types.js';

const newClient = () => new Client({ name: 'c', version: '0' });

export async function paginationInvalidCursor({ transport }: TestArgs) {
    const makeServer = () => {
        const s = new McpServer({ name: 's', version: '0' });
        s.registerTool('echo', { inputSchema: z.object({}) }, () => ({ content: [] }));
        s.registerResource('static', 'e2e://static', {}, uri => ({
            contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'hi' }]
        }));
        s.registerResource('tpl', new ResourceTemplate('e2e://item/{id}', { list: undefined }), {}, uri => ({
            contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'hi' }]
        }));
        s.registerPrompt('p', {}, () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }] }));
        return s;
    };

    const client = newClient();
    await using _ = await wire(transport, makeServer, client);

    const badCursor = 'not-a-cursor-the-server-ever-issued';
    const invalidParams = expect.objectContaining({ code: ErrorCode.InvalidParams });

    await expect(client.listTools({ cursor: badCursor })).rejects.toBeInstanceOf(McpError);
    await expect(client.listTools({ cursor: badCursor })).rejects.toEqual(invalidParams);
    await expect(client.listResources({ cursor: badCursor })).rejects.toEqual(invalidParams);
    await expect(client.listResourceTemplates({ cursor: badCursor })).rejects.toEqual(invalidParams);
    await expect(client.listPrompts({ cursor: badCursor })).rejects.toEqual(invalidParams);
}
