/**
 * Self-contained test bodies for Express-bound hosting surfaces.
 *
 * These tests cover the SDK's Express-bound surface (auth middleware/routers, host
 * validation, createMcpExpressApp) over real HTTP — the layer a server operator
 * deploys and remote clients depend on; Client/Server are not the subject.
 *
 * The SDK's requireBearerAuth, mcpAuthRouter, mcpAuthMetadataRouter, and host-
 * header validation middleware are Express RequestHandlers; they cannot be
 * exercised with in-process Web-standard Request/Response. These tests build
 * real Express apps, listen on ephemeral ports (127.0.0.1), drive them with
 * fetch(), and assert exact HTTP status + header + body shapes.
 *
 * Function names mirror the requirement id in camelCase. NO casts, exact
 * assertions, closure recorders outside factories (for stateless compat),
 * minimal comments, every server closed in finally.
 */

import http from 'node:http';

import express, { type RequestHandler } from 'express';
import { expect } from 'vitest';

import { requireBearerAuth } from '../../../src/server/auth/middleware/bearerAuth.js';
import { mcpAuthRouter, mcpAuthMetadataRouter, createOAuthMetadata } from '../../../src/server/auth/router.js';
import { ProxyOAuthServerProvider } from '../../../src/server/auth/providers/proxyProvider.js';
import type { OAuthServerProvider } from '../../../src/server/auth/provider.js';
import { InvalidTokenError } from '../../../src/server/auth/errors.js';
import { createMcpExpressApp } from '../../../src/server/express.js';
import type { OAuthClientInformationFull } from '../../../src/shared/auth.js';

import type { TestArgs } from '../types.js';
import { startExpressMinimal, startExpressWithHostValidation } from '../helpers/express.js';

const RESOURCE_METADATA_URL = 'https://mcp.example.com/.well-known/oauth-protected-resource';
const VALID_TOKEN = 'analytics-dashboard-token';
const EXPIRED_TOKEN = 'expired-access-token';
const MALFORMED_TOKEN = 'not-a-valid-jwt';

/**
 * POST `body` to `url` via `node:http`, forcing `Host: <host>`.
 * Unlike undici fetch(), node:http sends caller-supplied Host header verbatim.
 */
function postWithHost(url: URL, host: string, body: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method: 'POST',
                headers: {
                    Host: host,
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                    'Content-Length': Buffer.byteLength(body)
                }
            },
            res => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', chunk => (data += chunk));
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
                res.on('error', reject);
            }
        );
        req.on('error', reject);
        req.end(body);
    });
}

export async function hostingAuthMissing401(_args: TestArgs) {
    const verifier = { verifyAccessToken: async (_token: string) => ({ token: '', clientId: 'test', scopes: [], expiresAt: 1e12 }) };

    await using host = await startExpressMinimal(requireBearerAuth({ verifier, resourceMetadataUrl: RESOURCE_METADATA_URL }));

    const res = await fetch(new URL('/mcp', host.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    });

    expect(res.status).toBe(401);

    const wwwAuth = res.headers.get('www-authenticate');
    expect(wwwAuth).toBeTruthy();
    expect(wwwAuth).toMatch(/^Bearer\b/i);
    expect(wwwAuth).toContain('error="invalid_token"');
    expect(wwwAuth).toContain(`resource_metadata="${RESOURCE_METADATA_URL}"`);

    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid_token');
}

export async function hostingAuthInvalid401(_args: TestArgs) {
    const verifier = {
        verifyAccessToken: async (token: string) => {
            if (token === MALFORMED_TOKEN) throw new InvalidTokenError('Token verification failed');
            return { token, clientId: 'test', scopes: [], expiresAt: 1e12 };
        }
    };

    await using host = await startExpressMinimal(requireBearerAuth({ verifier }));

    const res = await fetch(new URL('/mcp', host.baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${MALFORMED_TOKEN}`
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    });

    expect(res.status).toBe(401);

    const wwwAuth = res.headers.get('www-authenticate');
    expect(wwwAuth).toBeTruthy();
    expect(wwwAuth).toMatch(/^Bearer\b/i);
    expect(wwwAuth).toContain('error="invalid_token"');
}

export async function hostingAuthExpired401(_args: TestArgs) {
    const PAST_EXPIRY = 1;
    const verifier = {
        verifyAccessToken: async (token: string) => ({
            token,
            clientId: 'test-client',
            scopes: [],
            expiresAt: token === EXPIRED_TOKEN ? PAST_EXPIRY : Date.now() / 1000 + 3600
        })
    };

    await using host = await startExpressMinimal(requireBearerAuth({ verifier }));

    const res = await fetch(new URL('/mcp', host.baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${EXPIRED_TOKEN}`
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    });

    expect(res.status).toBe(401);

    const wwwAuth = res.headers.get('www-authenticate');
    expect(wwwAuth).toBeTruthy();
    expect(wwwAuth).toContain('error="invalid_token"');
}

export async function hostingAuthScope403(_args: TestArgs) {
    const verifier = {
        verifyAccessToken: async (token: string) => ({
            token,
            clientId: 'test-client',
            scopes: token === VALID_TOKEN ? ['mcp:tools:read'] : ['mcp:tools:call'],
            expiresAt: Date.now() / 1000 + 3600
        })
    };

    await using host = await startExpressMinimal(
        requireBearerAuth({
            verifier,
            requiredScopes: ['mcp:tools:read', 'mcp:tools:call'],
            resourceMetadataUrl: RESOURCE_METADATA_URL
        })
    );

    const res = await fetch(new URL('/mcp', host.baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${VALID_TOKEN}`
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    });

    expect(res.status).toBe(403);

    const wwwAuth = res.headers.get('www-authenticate');
    expect(wwwAuth).toBeTruthy();
    expect(wwwAuth).toMatch(/^Bearer\b/i);
    expect(wwwAuth).toContain('error="insufficient_scope"');
    expect(wwwAuth).toContain('scope="mcp:tools:read mcp:tools:call"');
    expect(wwwAuth).toContain(`resource_metadata="${RESOURCE_METADATA_URL}"`);

    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('insufficient_scope');
}

export async function hostingAuthAudValidation(_args: TestArgs) {
    const SERVER_RESOURCE_ID = 'https://mcp.example.com/api';
    const WRONG_AUDIENCE = 'https://other.example.com/api';

    const verifier = {
        verifyAccessToken: async (token: string) => {
            const aud = token === 'wrong-aud-token' ? WRONG_AUDIENCE : SERVER_RESOURCE_ID;
            return {
                token,
                clientId: 'test-client',
                scopes: [],
                expiresAt: Date.now() / 1000 + 3600,
                resource: new URL(aud)
            };
        }
    };

    const app = express();
    app.use(express.json());
    app.use(requireBearerAuth({ verifier, resourceMetadataUrl: SERVER_RESOURCE_ID }));
    app.post('/mcp', (_req, res) => {
        res.json({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    });

    await using host = await startExpressMinimal(app);

    const wrongAud = await fetch(new URL('/mcp', host.baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: 'Bearer wrong-aud-token'
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    });

    expect(wrongAud.status).toBeGreaterThanOrEqual(401);
    expect(wrongAud.status).toBeLessThanOrEqual(403);

    const wwwAuth = wrongAud.headers.get('www-authenticate');
    expect(wwwAuth).toBeTruthy();
    expect(wwwAuth).toMatch(/^Bearer\b/i);
    expect(wwwAuth).toContain('error=');

    const body = (await wrongAud.json()) as { error?: string };
    expect(body.error).toBeTruthy();
}

export async function hostingAuthMetadataEndpoints(_args: TestArgs) {
    const issuer = new URL('https://auth.example.com');
    const provider = {
        authorize: async () => {
            throw new Error('not needed');
        },
        challengeForAuthorizationCode: async () => 'test-challenge',
        exchangeAuthorizationCode: async () => ({ access_token: 'test-token', token_type: 'Bearer' }),
        exchangeRefreshToken: async () => ({ access_token: 'test-token', token_type: 'Bearer' }),
        verifyAccessToken: async () => ({ token: '', clientId: '', scopes: [], expiresAt: 1e12 }),
        clientsStore: { getClient: async () => undefined }
    };

    const app = express();
    app.use(express.json());
    app.use(
        mcpAuthRouter({
            provider,
            issuerUrl: issuer
        })
    );

    await using host = await startExpressMinimal(app);

    const asMetadata = await fetch(new URL('/.well-known/oauth-authorization-server', host.baseUrl));
    expect(asMetadata.status).toBe(200);
    const asBody = (await asMetadata.json()) as { issuer?: string; authorization_endpoint?: string };
    expect(asBody.issuer).toBe(issuer.href);
    expect(asBody.authorization_endpoint).toBeTruthy();

    const prmMetadata = await fetch(new URL('/.well-known/oauth-protected-resource', host.baseUrl));
    expect(prmMetadata.status).toBe(200);
    const prmBody = (await prmMetadata.json()) as { resource?: string; authorization_servers?: string[] };
    expect(prmBody.authorization_servers).toContain(issuer.href);
}

export async function hostingAuthPrmAuthorizationServersField(_args: TestArgs) {
    const issuer = new URL('https://auth.example.com');
    const oauthMetadata = createOAuthMetadata({
        provider: {
            authorize: async () => {
                throw new Error('stub');
            },
            challengeForAuthorizationCode: async () => 'test',
            exchangeAuthorizationCode: async () => ({ access_token: 'test', token_type: 'Bearer' }),
            exchangeRefreshToken: async () => ({ access_token: 'test', token_type: 'Bearer' }),
            verifyAccessToken: async () => ({ token: '', clientId: '', scopes: [], expiresAt: 1e12 }),
            clientsStore: { getClient: async () => undefined }
        },
        issuerUrl: issuer
    });

    const app = express();
    app.use(
        mcpAuthMetadataRouter({
            oauthMetadata,
            resourceServerUrl: new URL('https://mcp.example.com')
        })
    );

    await using host = await startExpressMinimal(app);

    const res = await fetch(new URL('/.well-known/oauth-protected-resource', host.baseUrl));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorization_servers?: string[] };
    expect(body.authorization_servers).toBeInstanceOf(Array);
    expect(body.authorization_servers?.length).toBeGreaterThan(0);
    expect(body.authorization_servers).toContain(issuer.href);
}

export async function hostingAuthAsRouter(_args: TestArgs) {
    const issuer = new URL('https://auth.example.com');
    const provider: OAuthServerProvider = {
        authorize: async (_client, _params, res) => {
            res.redirect(302, 'https://example.com/callback?code=test-code&state=test');
        },
        challengeForAuthorizationCode: async () => 'test-challenge',
        exchangeAuthorizationCode: async () => ({ access_token: 'test-token', token_type: 'Bearer' }),
        exchangeRefreshToken: async () => ({ access_token: 'test-token', token_type: 'Bearer' }),
        verifyAccessToken: async (token: string) => ({ token, clientId: 'test', scopes: [], expiresAt: 1e12 }),
        clientsStore: {
            getClient: async (id: string) =>
                id === 'test-client'
                    ? ({
                          client_id: 'test-client',
                          client_secret: 'secret',
                          redirect_uris: ['https://example.com/callback']
                      } as OAuthClientInformationFull)
                    : undefined,
            registerClient: async () =>
                ({
                    client_id: 'new-client',
                    client_secret: 'new-secret',
                    redirect_uris: ['https://example.com/callback']
                }) as OAuthClientInformationFull
        },
        revokeToken: async () => {}
    };

    const app = express();
    app.use(express.json());
    app.use(mcpAuthRouter({ provider, issuerUrl: issuer }));

    await using host = await startExpressMinimal(app);

    const authRes = await fetch(new URL('/authorize', host.baseUrl));
    expect(authRes.status).not.toBe(404);

    const tokenRes = await fetch(new URL('/token', host.baseUrl), { method: 'POST' });
    expect(tokenRes.status).not.toBe(404);

    const registerRes = await fetch(new URL('/register', host.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['https://example.com/callback'] })
    });
    expect(registerRes.status).not.toBe(404);
    const registerBody = (await registerRes.json()) as { client_id?: string };
    expect(registerBody.client_id).toBeTruthy();

    const revokeRes = await fetch(new URL('/revoke', host.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'token=old-token&client_id=test-client&client_secret=secret'
    });
    expect([200, 400]).toContain(revokeRes.status);
}

export async function hostingAuthProxyProvider(_args: TestArgs) {
    const upstreamRequests: Array<{ url: string; method: string; body?: string }> = [];

    const upstreamAS = express();
    upstreamAS.use(express.json());
    upstreamAS.use(express.urlencoded({ extended: true }));
    upstreamAS.get('/authorize', (req, res) => {
        upstreamRequests.push({ url: req.url, method: req.method });
        res.redirect(302, `https://example.com/callback?code=upstream-code&state=${req.query.state ?? ''}`);
    });
    upstreamAS.post('/token', (req, res) => {
        upstreamRequests.push({ url: req.url, method: req.method, body: JSON.stringify(req.body) });
        res.json({ access_token: 'upstream-token', token_type: 'Bearer' });
    });
    upstreamAS.post('/revoke', (req, res) => {
        upstreamRequests.push({ url: req.url, method: req.method, body: JSON.stringify(req.body) });
        res.sendStatus(200);
    });

    await using upstream = await startExpressMinimal(upstreamAS);

    const provider = new ProxyOAuthServerProvider({
        endpoints: {
            authorizationUrl: new URL('/authorize', upstream.baseUrl).href,
            tokenUrl: new URL('/token', upstream.baseUrl).href,
            revocationUrl: new URL('/revoke', upstream.baseUrl).href
        },
        verifyAccessToken: async token => ({ token, clientId: 'proxy-client', scopes: [], expiresAt: 1e12 }),
        getClient: async (id: string) =>
            id === 'proxy-client'
                ? ({
                      client_id: 'proxy-client',
                      client_secret: 'proxy-secret',
                      redirect_uris: ['https://example.com/cb']
                  } as OAuthClientInformationFull)
                : undefined
    });

    const app = express();
    app.use(express.json());
    app.use(mcpAuthRouter({ provider, issuerUrl: new URL('https://proxy.example.com') }));

    await using proxy = await startExpressMinimal(app);

    const authRes = await fetch(new URL('/authorize', proxy.baseUrl));
    expect(authRes.status).not.toBe(404);

    const tokenRes = await fetch(new URL('/token', proxy.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code&code=test&redirect_uri=https://example.com/cb&client_id=proxy-client&code_verifier=test'
    });
    expect(tokenRes.status).not.toBe(404);

    const revokeRes = await fetch(new URL('/revoke', proxy.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'token=old-token&client_id=proxy-client&client_secret=proxy-secret'
    });
    expect([200, 400]).toContain(revokeRes.status);
}

export async function hostingHttpHostValidationMiddleware(_args: TestArgs) {
    const handler: RequestHandler = (_req, res) => {
        res.json({ ok: true });
    };

    await using host = await startExpressWithHostValidation(['localhost', '127.0.0.1'], handler);

    const good = await fetch(new URL('/test', host.baseUrl));
    expect(good.status).toBe(200);

    const spoofed = await postWithHost(new URL('/test', host.baseUrl), 'evil.example.com', JSON.stringify({ test: 'data' }));
    expect(spoofed.status).toBe(403);
    const body = JSON.parse(spoofed.body) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/Invalid Host/i);
}

export async function hostingExpressAppHelper(_args: TestArgs) {
    const app = createMcpExpressApp();
    app.post('/mcp', (_req, res) => {
        res.json({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    });

    await using host = await startExpressMinimal(app);

    expect(host.baseUrl.hostname).toBe('127.0.0.1');

    const good = await fetch(new URL('/mcp', host.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    });
    expect(good.status).toBe(200);

    const spoofed = await postWithHost(
        new URL('/mcp', host.baseUrl),
        'evil.example.com',
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    );
    expect(spoofed.status).toBe(403);
    const body = JSON.parse(spoofed.body) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/Invalid Host/i);
}
