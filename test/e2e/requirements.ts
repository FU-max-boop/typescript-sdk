/**
 * Requirements manifest for the e2e suite.
 *
 * Each entry documents one behavior the SDK must satisfy, links to the test
 * cases that prove it, and records known failures (where the SDK does not yet
 * meet the requirement) and structural skips (where a transport cannot express
 * the behavior).
 */

import type { Requirement } from './types.js';
import * as tools from './scenarios/tools.js';
import * as validation from './scenarios/validation.js';
import * as hostingAuth from './scenarios/hosting-auth.js';
import * as hostingHttp from './scenarios/hosting-http.js';
import * as hostingExpress from './scenarios/hosting-express.js';
import * as hostingResume from './scenarios/hosting-resume.js';
import * as hostingSession from './scenarios/hosting-session.js';
import * as transportHttp from './scenarios/transport-http.js';
import * as stdio from './scenarios/stdio.js';
import * as resources from './scenarios/resources.js';
import * as prompts from './scenarios/prompts.js';
import * as lifecycle from './scenarios/lifecycle.js';
import * as logging from './scenarios/logging.js';
import * as completion from './scenarios/completion.js';
import * as roots from './scenarios/roots.js';
import * as protocol from './scenarios/protocol.js';
import * as sampling from './scenarios/sampling.js';
import * as elicitation from './scenarios/elicitation.js';
import * as dynamic from './scenarios/dynamic.js';
import * as pagination from './scenarios/pagination.js';
import * as flow from './scenarios/flow.js';
import * as clientAuth from './scenarios/client-auth.js';

/** Transports with a persistent server instance / standalone notification stream. */
const STATEFUL_TRANSPORTS = ['inMemory', 'stdio', 'streamableHttp'] as const;

export const REQUIREMENTS: Record<string, Requirement> = {
    // Lifecycle & version negotiation

    'lifecycle:capability:client-not-declared': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#operation',
        behavior: 'Client rejects sending notifications or registering handlers for capabilities it did not declare.',
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [lifecycle.lifecycleCapabilityClientNotDeclared]
    },
    'lifecycle:capability:server-not-advertised': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#operation',
        behavior: 'Client rejects calls to methods (e.g. listResources) for capabilities the server did not advertise.',
        tests: [lifecycle.lifecycleCapabilityServerNotAdvertised]
    },
    'lifecycle:initialize:basic': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#initialization',
        behavior:
            'Client.connect() sends initialize with protocolVersion, capabilities, clientInfo; server responds with its own and the connection is established.',
        tests: [lifecycle.lifecycleInitializeBasic]
    },
    'lifecycle:initialize:instructions': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#initialization',
        behavior: 'Server may include an instructions string in InitializeResult; client exposes it.',
        tests: [lifecycle.lifecycleInitializeInstructions]
    },
    'lifecycle:initialized-notification': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#initialization',
        behavior: 'After receiving InitializeResult, client sends notifications/initialized before any other request.',
        tests: [lifecycle.lifecycleInitializedNotification]
    },
    'lifecycle:ping': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping#behavior-requirements',
        behavior: 'ping in either direction returns EmptyResult.',
        tests: [lifecycle.lifecyclePing]
    },
    'lifecycle:version:downgrade': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#version-negotiation',
        behavior: 'When server returns an older supported protocolVersion, client downgrades and connect succeeds.',
        tests: [lifecycle.lifecycleVersionDowngrade]
    },
    'lifecycle:version:match': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#version-negotiation',
        behavior: 'When server returns the same protocolVersion the client requested, connect succeeds at that version.',
        tests: [lifecycle.lifecycleVersionMatch]
    },
    'lifecycle:version:reject-unsupported': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#version-negotiation',
        behavior: 'When server returns a protocolVersion the client does not support, connect rejects and the transport is closed.',
        tests: [lifecycle.lifecycleVersionRejectUnsupported],
        knownFailures: [
            {
                test: lifecycle.lifecycleVersionRejectUnsupported,
                transport: 'stdio',
                note: 'connect rejects but client.transport is not cleared on stdio (other transports clear it)'
            }
        ]
    },
    'lifecycle:capability:experimental-passthrough': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#capability-negotiation',
        behavior:
            'Server-declared capabilities.experimental entries (vendor-namespaced keys, arbitrary object values) survive the initialize handshake and are exposed verbatim via client.getServerCapabilities().experimental; an undeclared key reads as undefined. Symmetric for client→server via getClientCapabilities().',
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [lifecycle.lifecycleCapabilityExperimentalPassthrough]
    },
    'lifecycle:connect:onerror-pre-handshake': {
        source: 'sdk',
        behavior:
            'Transport errors emitted after transport.start() but before client.connect() resolves are delivered to a client.onerror handler set prior to connect (Protocol wires transport.onerror before start() and before the initialize handshake).',
        transports: ['stdio'],
        note: 'The behavior itself is transport-agnostic but the garbage injection needs a real child process.',
        tests: [stdio.lifecycleConnectOnerrorPreHandshake]
    },
    'lifecycle:initialize:server-info-extended': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#initialization',
        behavior:
            'Server constructed with Implementation extended fields (title, websiteUrl, icons, description) returns them in InitializeResult.serverInfo; client.getServerVersion() exposes them unchanged.',
        tests: [lifecycle.lifecycleInitializeServerInfoExtended]
    },
    'lifecycle:server:get-client-version': {
        source: 'sdk',
        behavior:
            "After initialize completes, Server.getClientVersion() returns the connected client's Implementation (name/version) as sent in InitializeRequest.clientInfo; before initialize it is undefined.",
        transports: STATEFUL_TRANSPORTS,
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [lifecycle.lifecycleServerGetClientVersion]
    },
    'server:get-client-capabilities': {
        source: 'sdk',
        behavior:
            'After initialize, Server.getClientCapabilities() returns the capabilities object the client sent in InitializeRequest.params.capabilities; before initialize it returns undefined. Servers use this to gate optional features (e.g. dynamic registration) on what the connected client declared.',
        transports: STATEFUL_TRANSPORTS,
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [lifecycle.serverGetClientCapabilities]
    },

    // Protocol primitives: cancellation, timeout, progress, errors, _meta

    'protocol:cancel:abort-signal': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation#cancellation-flow',
        behavior: "Aborting a request's AbortSignal sends notifications/cancelled with the requestId and rejects the local promise.",
        tests: [protocol.protocolCancelAbortSignal]
    },
    'protocol:cancel:handler-abort-propagates': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior: "On the receiving side, notifications/cancelled aborts the handler's RequestHandlerExtra.signal.",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [protocol.protocolCancelHandlerAbortPropagates]
    },
    'protocol:cancel:initialize-not-cancellable': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation#behavior-requirements',
        behavior: 'Client never sends notifications/cancelled for the initialize request, even if connect() is aborted.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [protocol.protocolCancelInitializeNotCancellable],
        knownFailures: [
            {
                test: protocol.protocolCancelInitializeNotCancellable,
                note: 'SDK sends notifications/cancelled for initialize when connect() is aborted; spec says initialize MUST NOT be cancelled.'
            }
        ]
    },
    'protocol:cancel:late-response-ignored': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation#timing-considerations',
        behavior:
            'A response that arrives after the sender issued notifications/cancelled is silently ignored; the request promise remains rejected and no error is raised.',
        tests: [protocol.protocolCancelLateResponseIgnored],
        knownFailures: [
            {
                test: protocol.protocolCancelLateResponseIgnored,
                note: 'late response after cancellation fires client.onerror; spec says silently ignore'
            }
        ]
    },
    'protocol:cancel:unknown-id-ignored': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation#error-handling',
        behavior:
            'Receiver silently ignores notifications/cancelled referencing an unknown or already-completed requestId; no error response is sent and no exception is raised.',
        tests: [protocol.protocolCancelUnknownIdIgnored]
    },
    'protocol:error:connection-closed': {
        source: 'sdk',
        behavior: 'Closing the transport invokes onclose and rejects all in-flight requests with ErrorCode.ConnectionClosed.',
        tests: [protocol.protocolErrorConnectionClosed],
        knownFailures: [
            {
                test: protocol.protocolErrorConnectionClosed,
                transport: 'stdio',
                note: 'in-process stdio does not fire client.onclose after close()'
            }
        ]
    },
    'protocol:error:internal-error': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic#responses',
        behavior: 'An unhandled exception in a request handler is returned as JSON-RPC error -32603 InternalError.',
        tests: [protocol.protocolErrorInternalError]
    },
    'protocol:error:invalid-params': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic#responses',
        behavior: 'A request with malformed params returns JSON-RPC error -32602 InvalidParams.',
        tests: [protocol.protocolErrorInvalidParams],
        knownFailures: [
            {
                test: protocol.protocolErrorInvalidParams,
                note: 'Protocol wraps schema-parse failures as -32603 (InternalError), not -32602 (InvalidParams) as required by JSON-RPC 2.0.'
            }
        ]
    },
    'protocol:error:method-not-found': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic#responses',
        behavior: 'A request for an unknown method returns JSON-RPC error -32601 MethodNotFound.',
        tests: [protocol.protocolErrorMethodNotFound]
    },
    'protocol:error:reconnect-no-stale-timers': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior: 'Reconnecting on the same Protocol instance after close does not leave stale timers that fire spurious cancellations.',
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [protocol.protocolErrorReconnectNoStaleTimers]
    },
    'protocol:progress:callback': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress#progress-flow',
        behavior: "notifications/progress with a matching progressToken invokes the caller's onprogress with progress, total, and message.",
        tests: [protocol.protocolProgressCallback]
    },
    'protocol:progress:token-injected': {
        source: 'sdk',
        behavior: 'Passing onprogress causes a progressToken to be injected into request _meta, preserving existing _meta fields.',
        tests: [protocol.protocolProgressTokenInjected]
    },
    'protocol:progress:token-unique': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress#progress-flow',
        behavior: 'Concurrent in-flight requests that each pass onprogress receive distinct progressToken values in their _meta.',
        tests: [protocol.protocolProgressTokenUnique]
    },
    'protocol:timeout:basic': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#timeouts',
        behavior: 'request() with a timeout option rejects with ErrorCode.RequestTimeout if no response arrives in time.',
        tests: [protocol.protocolTimeoutBasic]
    },
    'protocol:timeout:max-total': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#timeouts',
        behavior: 'maxTotalTimeout is enforced even when progress keeps resetting the per-chunk timeout.',
        tests: [protocol.protocolTimeoutMaxTotal]
    },
    'protocol:timeout:reset-on-progress': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#timeouts',
        behavior: 'With resetTimeoutOnProgress: true, each progress notification resets the request timeout.',
        tests: [protocol.protocolTimeoutResetOnProgress]
    },
    'protocol:timeout:sends-cancellation': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#timeouts',
        behavior:
            'When a request times out, the sender issues notifications/cancelled for that requestId before rejecting the local promise.',
        tests: [protocol.protocolTimeoutSendsCancellation]
    },
    'mcpserver:onerror:reach-through': {
        source: 'sdk',
        behavior:
            'Setting mcpServer.server.onerror (or server.onerror on raw Server) receives both transport-level errors and protocol/handler errors (uncaught notification handler, failed-to-send-response, unknown-message-id). The reach-through via McpServer.server is the supported access path until McpServer exposes onerror directly.',
        tests: [protocol.mcpserverOnerrorReachThrough]
    },
    'protocol:custom-method:notification': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior:
            "server.notification({method:'x/custom', params}) reaches a client.setNotificationHandler(CustomSchema, ...) registered for that non-spec method; the handler fires with Zod-parsed params and no capability error is raised on either side.",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [protocol.protocolCustomMethodNotification]
    },
    'protocol:custom-method:request': {
        source: 'sdk',
        behavior:
            "A user-defined request schema registered via server.setRequestHandler(CustomSchema, h) is dispatched when client.request({method:'x/custom', params}, CustomResultSchema) is called; the handler's return value is parsed by the result schema and resolved to the caller. Capability checks do not reject non-spec method names.",
        tests: [protocol.protocolCustomMethodRequest]
    },
    'protocol:custom-method:roundtrip': {
        source: 'sdk',
        behavior:
            "server.setRequestHandler with a schema whose method literal is NOT in the MCP spec registers a handler; client.request({method:'<custom>'}, ResultSchema) returns the handler's result, not -32601 MethodNotFound. Capability assertions on both sides pass through unknown methods.",
        tests: [protocol.protocolCustomMethodRoundtrip]
    },
    'protocol:custom-notification:roundtrip': {
        source: 'sdk',
        behavior:
            "server.setNotificationHandler(CustomNotifSchema, h) registers a handler for a non-spec method; client.notification({method:'myorg/event', params}) delivers to it and h receives the schema-parsed notification.",
        tests: [protocol.protocolCustomNotificationRoundtrip]
    },
    'protocol:error:data-roundtrip': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic#responses',
        behavior:
            'A request handler that throws McpError(code, message, data) produces a JSON-RPC error whose error.data equals the thrown data; the client-side rejection is an McpError with .data deep-equal to the original object.',
        tests: [protocol.protocolErrorDataRoundtrip]
    },
    'protocol:fallback-notification-handler': {
        source: 'sdk',
        behavior:
            'Setting fallbackNotificationHandler on a Client/Server receives any inbound notification whose method has no registered handler; notifications with a method-specific handler do not reach it.',
        tests: [protocol.protocolFallbackNotificationHandler]
    },
    'protocol:handler:re-register-replaces': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior:
            'Calling setRequestHandler() twice for the same method replaces the prior handler (no throw, no chaining); subsequent inbound requests dispatch only to the latest handler.',
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [protocol.protocolHandlerReRegisterReplaces]
    },
    'protocol:request-handler:override-builtin': {
        source: 'sdk',
        behavior:
            'server.setRequestHandler() for a spec method that has a built-in handler (initialize, ping, logging/setLevel) replaces that handler; the user-supplied result is what the client receives. No throw on re-registration.',
        tests: [protocol.protocolRequestHandlerOverrideBuiltin]
    },

    // Tools

    'tools:call:content:audio': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#audio-content',
        behavior: "tools/call returns content[] with type:'audio' carrying base64 data and mimeType.",
        tests: [tools.toolsCallContentAudio]
    },
    'tools:call:content:embedded-resource': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#embedded-resources',
        behavior: "tools/call returns content[] with type:'resource' carrying inline TextResourceContents or BlobResourceContents.",
        tests: [tools.toolsCallContentEmbeddedResource]
    },
    'tools:call:content:image': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#image-content',
        behavior: "tools/call returns content[] with type:'image' carrying base64 data and mimeType.",
        tests: [tools.toolsCallContentImage]
    },
    'tools:call:content:mixed': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-result',
        behavior: 'tools/call may return a heterogeneous content[] mixing text, image, and resource blocks.',
        tests: [tools.toolsCallContentMixed]
    },
    'tools:call:content:resource-link': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#resource-links',
        behavior: "tools/call returns content[] with type:'resource_link' carrying a resource reference (uri, name).",
        tests: [tools.toolsCallContentResourceLink]
    },
    'tools:call:content:text': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#text-content',
        behavior: "tools/call returns content[] with type:'text' carrying the string in text.",
        tests: [tools.toolsCallContentText]
    },
    'tools:call:elicitation-roundtrip': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#user-interaction-model',
        behavior: "A tool handler issuing elicitation/create receives the client's ElicitResult and may use it to complete the call.",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [tools.toolsCallElicitationRoundtrip]
    },
    'tools:call:is-error': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling',
        behavior: 'A tool failure is returned as {isError: true, content:[...]} (a result, not a JSON-RPC error).',
        tests: [tools.toolsCallIsError]
    },
    'tools:call:logging-mid-execution': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging#log-message-notifications',
        behavior: 'A tool handler may emit notifications/message during execution; client receives them before the result.',
        tests: [tools.toolsCallLoggingMidExecution]
    },
    'tools:call:progress': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress#progress-flow',
        behavior: "A tool handler sending progress via sendNotification reaches the client's onprogress before the result resolves.",
        tests: [tools.toolsCallProgress]
    },
    'tools:call:sampling-roundtrip': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/sampling',
        behavior: "A tool handler issuing sampling/createMessage receives the client's response and may embed it in the tool result.",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [tools.toolsCallSamplingRoundtrip]
    },
    'tools:call:structured-content': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content',
        behavior: 'A tool with outputSchema returns structuredContent matching that schema alongside (or instead of) content[].',
        tests: [tools.toolsCallStructuredContent]
    },
    'tools:call:structured-content:text-mirror': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content',
        behavior:
            "A tool returning structuredContent also includes the serialized JSON as a type:'text' block in content[] for backwards compatibility.",
        tests: [tools.toolsCallStructuredContentTextMirror]
    },
    'tools:call:unknown-name': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling',
        behavior: 'tools/call for an unregistered name returns a JSON-RPC error (not isError result).',
        tests: [tools.toolsCallUnknownName, tools.toolsCallUnknownNameRaw],
        knownFailures: [
            {
                test: tools.toolsCallUnknownName,
                note: "RULED 2026-05-26: spec violation (spec error-handling section shows -32602 protocol error for unknown tools). McpServer's blanket try/catch around the tools/call handler converts the McpError(InvalidParams, 'Tool {name} not found') into {isError:true} via createToolError(), so callTool() resolves instead of rejecting. Spec says unknown tool is a protocol error and MUST surface as a JSON-RPC error envelope."
            }
        ]
    },
    'tools:capability:declared': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#capabilities',
        behavior: 'A server that exposes tools declares the tools capability (optionally with listChanged) in its InitializeResult.',
        tests: [tools.toolsCapabilityDeclared]
    },
    'tools:input-schema:json-schema-2020-12': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool',
        behavior: 'A tool registered with a JSON Schema 2020-12 inputSchema (nested objects, $defs refs) is discoverable and callable.',
        tests: [tools.toolsInputSchemaJsonSchema202012Raw]
    },
    'tools:input-schema:preserve-additional-properties': {
        source: 'sdk',
        behavior: 'tools/list preserves inputSchema.additionalProperties as registered.',
        tests: [tools.toolsInputSchemaPreserveAdditionalPropertiesRaw]
    },
    'tools:input-schema:preserve-defs': {
        source: 'sdk',
        behavior: 'tools/list preserves inputSchema.$defs as registered.',
        tests: [tools.toolsInputSchemaPreserveDefsRaw]
    },
    'tools:input-schema:preserve-schema-dialect': {
        source: 'sdk',
        behavior: 'tools/list preserves inputSchema.$schema (the JSON Schema dialect URI) as registered.',
        tests: [tools.toolsInputSchemaPreserveSchemaDialectRaw]
    },
    'tools:list-changed': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#list-changed-notification',
        behavior: 'When the tool set changes on a connected server, notifications/tools/list_changed is sent.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [tools.toolsListChanged]
    },
    'tools:list:basic': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#listing-tools',
        behavior: 'tools/list returns registered tools with name, description, inputSchema.',
        tests: [tools.toolsListBasic]
    },
    'tools:list:metadata': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool',
        behavior:
            'tools/list includes title, annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint), _meta, icons, and execution.taskSupport when set.',
        tests: [tools.toolsListMetadataRaw]
    },
    'tools:list:pagination': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#listing-tools',
        behavior: 'tools/list supports cursor pagination; nextCursor round-trips until exhausted.',
        tests: [tools.toolsListPagination, tools.toolsListPaginationRaw],
        knownFailures: [
            {
                test: tools.toolsListPagination,
                note: 'McpServer does not implement automatic pagination — handlers receive the cursor but the high-level API returns the full list with no nextCursor unless the user implements cursor handling in their own handler.'
            }
        ]
    },

    // Tools: SDK guarantees

    'client:output-schema:skip-on-error': {
        source: 'sdk',
        behavior: 'Client.callTool() skips structuredContent validation when isError:true.',
        tests: [tools.clientOutputSchemaSkipOnError]
    },
    'client:output-schema:validate': {
        source: 'sdk',
        behavior:
            'Client.callTool() validates structuredContent against the advertised outputSchema and throws on mismatch, missing structuredContent, or extra properties.',
        tests: [tools.clientOutputSchemaValidateRaw]
    },
    'mcpserver:output-schema:missing-structured': {
        source: 'sdk',
        behavior: 'A tool with outputSchema whose handler returns no structuredContent produces a server error.',
        tests: [tools.mcpserverOutputSchemaMissingStructured]
    },
    'mcpserver:output-schema:server-validate': {
        source: 'sdk',
        behavior: 'McpServer validates structuredContent against outputSchema before returning; mismatch produces a server error.',
        tests: [tools.mcpserverOutputSchemaServerValidate]
    },
    'mcpserver:output-schema:skip-on-error': {
        source: 'sdk',
        behavior: 'Server-side outputSchema validation is skipped when the handler returns isError:true.',
        tests: [tools.mcpserverOutputSchemaSkipOnError]
    },
    'mcpserver:tool:duplicate-name': {
        source: 'sdk',
        behavior: 'Registering a tool with a name already in use throws.',
        tests: [tools.mcpserverToolDuplicateName]
    },
    'mcpserver:tool:extra': {
        source: 'sdk',
        behavior:
            'Tool handlers receive RequestHandlerExtra with sessionId, requestId, signal, sendNotification, and (when applicable) authInfo and requestInfo.',
        tests: [tools.mcpserverToolExtra]
    },
    'mcpserver:tool:handle-update': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior:
            'The handle returned by registerTool can .update() description/schema/handler; changes reflect in subsequent tools/list and tools/call and trigger list_changed.',
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [tools.mcpserverToolHandleUpdate]
    },
    'mcpserver:tool:handler-throws': {
        source: 'sdk',
        behavior: "A tool handler that throws is converted to {isError:true, content:[{type:'text', text:<message>}]}.",
        tests: [tools.mcpserverToolHandlerThrows]
    },
    'mcpserver:tool:input-validation': {
        source: 'sdk',
        behavior:
            'McpServer rejects tools/call arguments that fail the Zod inputSchema, returning {isError:true} without invoking the handler.',
        tests: [tools.mcpserverToolInputValidation]
    },
    'mcpserver:tool:naming-validation': {
        source: 'sdk',
        behavior: 'registerTool warns on names that violate SEP-986 naming conventions.',
        tests: [tools.mcpserverToolNamingValidation]
    },
    'mcpserver:tool:url-elicitation-error': {
        source: 'sdk',
        behavior:
            'A tool handler throwing UrlElicitationRequiredError surfaces to Client.callTool() as that error type with elicitation params intact.',
        tests: [tools.mcpserverToolUrlElicitationError]
    },
    'mcpserver:tool:zod-variants': {
        source: 'sdk',
        behavior:
            'inputSchema accepts Zod union, intersection, nested-object, preprocess, transform, and pipe schemas; validation/coercion runs before the handler.',
        tests: [tools.mcpserverToolZodVariants]
    },
    'client:call-tool:compat-result-schema': {
        source: 'sdk',
        behavior:
            'Client.callTool(params, CompatibilityCallToolResultSchema) accepts a legacy protocol-2024-10-07 result ({toolResult: ...}, no content[]) without throwing and returns the parsed toolResult field.',
        tests: [tools.clientCallToolCompatResultSchemaRaw]
    },
    'mcpserver:tool:variadic-forms': {
        source: 'sdk',
        behavior:
            'Deprecated McpServer.tool() positional overloads — (name,cb), (name,desc,cb), (name,paramsSchema,cb), (name,desc,paramsSchema,cb), (name,desc,paramsSchema,annotations,cb), and the annotations-without-schema forms — register tools whose tools/list entry and tools/call result match an equivalent registerTool() registration.',
        tests: [tools.mcpserverToolVariadicForms]
    },

    // Resources

    'resources:annotations': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#annotations',
        behavior:
            'Resources, resource templates, and resource contents may carry annotations {audience, priority, lastModified}; these round-trip from server registration to the client list/read result.',
        tests: [resources.resourcesAnnotations]
    },
    'resources:capability:declared': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#capabilities',
        behavior:
            "A server that exposes resources declares the 'resources' capability (with subscribe/listChanged flags as supported) in InitializeResult.",
        tests: [resources.resourcesCapabilityDeclared]
    },
    'resources:list-changed': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#list-changed-notification',
        behavior: 'When the resource set changes, notifications/resources/list_changed is sent.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [resources.resourcesListChanged]
    },
    'resources:list:basic': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#listing-resources',
        behavior: 'resources/list returns registered resources with uri, name, mimeType, description.',
        tests: [resources.resourcesListBasic]
    },
    'resources:list:pagination': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#listing-resources',
        behavior: 'resources/list supports cursor pagination.',
        tests: [resources.resourcesListPagination, resources.resourcesListPaginationRaw],
        knownFailures: [
            {
                test: resources.resourcesListPagination,
                note: 'McpServer does not implement automatic pagination — handlers receive the cursor but the high-level API returns the full list with no nextCursor unless the user implements cursor handling in their own handler.'
            }
        ]
    },
    'resources:read:blob': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#reading-resources',
        behavior: 'resources/read returns contents[] with BlobResourceContents (base64 blob field) for binary resources.',
        tests: [resources.resourcesReadBlob]
    },
    'resources:read:template-vars': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#resource-templates',
        behavior: 'Reading a templated URI passes parsed template variables to the read handler.',
        tests: [resources.resourcesReadTemplateVars]
    },
    'resources:read:text': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#reading-resources',
        behavior: 'resources/read returns contents[] with TextResourceContents (text field) for text resources.',
        tests: [resources.resourcesReadText]
    },
    'resources:read:unknown-uri': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#error-handling',
        behavior: 'resources/read for an unknown URI returns JSON-RPC error -32002 (Resource not found).',
        tests: [resources.resourcesReadUnknownUri],
        knownFailures: [
            {
                test: resources.resourcesReadUnknownUri,
                note: 'SDK emits -32602 (InvalidParams) instead of spec-mandated -32002 (ResourceNotFound). ErrorCode enum lacks ResourceNotFound member.'
            }
        ]
    },
    'resources:subscribe:capability-required': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#capabilities',
        behavior:
            'resources/subscribe is only accepted when the server advertised resources.subscribe:true; otherwise the client rejects the call (or server errors).',
        tests: [resources.resourcesSubscribeCapabilityRequired]
    },
    'resources:subscribe:updated': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#subscriptions',
        behavior: 'After resources/subscribe, server changes to that URI send notifications/resources/updated.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [resources.resourcesSubscribeUpdated]
    },
    'resources:templates:list': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#resource-templates',
        behavior: 'resources/templates/list returns registered templates with uriTemplate.',
        tests: [resources.resourcesTemplatesList]
    },
    'resources:templates:pagination': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination#operations-supporting-pagination',
        behavior: 'resources/templates/list supports cursor pagination; nextCursor round-trips until exhausted.',
        tests: [resources.resourcesTemplatesPagination, resources.resourcesTemplatesPaginationRaw],
        knownFailures: [
            {
                test: resources.resourcesTemplatesPagination,
                note: 'McpServer does not implement automatic pagination — handlers receive the cursor but the high-level API returns the full list with no nextCursor unless the user implements cursor handling in their own handler.'
            }
        ]
    },
    'resources:unsubscribe:stops-updates': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/resources#subscriptions',
        behavior: 'After resources/unsubscribe, no further notifications/resources/updated are sent for that URI.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [resources.resourcesUnsubscribeStopsUpdates]
    },

    // Resources: SDK guarantees

    'mcpserver:resource:duplicate-name': {
        source: 'sdk',
        behavior: 'Registering a resource or template with a duplicate name throws.',
        tests: [resources.mcpserverResourceDuplicateName]
    },
    'mcpserver:resource:handle-update-remove': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior: 'The handle from resource()/registerResource() can .update() and .remove(), triggering list_changed.',
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [resources.mcpserverResourceHandleUpdateRemove]
    },
    'mcpserver:resource:metadata-override': {
        source: 'sdk',
        behavior: 'Per-resource metadata from a template list callback overrides template-level metadata field-by-field.',
        tests: [resources.mcpserverResourceMetadataOverride]
    },
    'mcpserver:resource:read-throws-surfaced': {
        source: 'sdk',
        behavior: 'A resource read callback that throws is surfaced as a JSON-RPC error response.',
        tests: [resources.mcpserverResourceReadThrowsSurfaced]
    },
    'mcpserver:resource:template-list-callback': {
        source: 'sdk',
        behavior: 'A ResourceTemplate with a list callback contributes its expanded items to resources/list.',
        tests: [resources.mcpserverResourceTemplateListCallback]
    },
    'mcpserver:resource:legacy-overload': {
        source: 'sdk',
        behavior:
            'The deprecated McpServer.resource() overloads (fixed-URI and ResourceTemplate, with and without the optional metadata arg) register a resource that surfaces in resources/list and reads via resources/read identically to registerResource().',
        tests: [resources.mcpserverResourceLegacyOverload]
    },

    // Prompts

    'prompts:capability:declared': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/prompts#capabilities',
        behavior: 'A server that exposes prompts declares the prompts capability (optionally with listChanged) in its InitializeResult.',
        tests: [prompts.promptsCapabilityDeclared]
    },
    'prompts:get:content:audio': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/prompts#audio-content',
        behavior: 'Prompt messages may contain AudioContent with base64 data and mimeType.',
        tests: [prompts.promptsGetContentAudio]
    },
    'prompts:get:content:embedded-resource': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/prompts#embedded-resources',
        behavior: 'Prompt messages may contain EmbeddedResource content.',
        tests: [prompts.promptsGetContentEmbeddedResource]
    },
    'prompts:get:content:image': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/prompts#image-content',
        behavior: 'Prompt messages may contain ImageContent.',
        tests: [prompts.promptsGetContentImage]
    },
    'prompts:get:missing-required-args': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/prompts#error-handling',
        behavior: 'prompts/get omitting a required argument returns JSON-RPC error -32602 (Invalid params).',
        tests: [prompts.promptsGetMissingRequiredArgs]
    },
    'prompts:get:no-args': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/prompts#getting-a-prompt',
        behavior: 'prompts/get with no arguments returns messages[].',
        tests: [prompts.promptsGetNoArgs]
    },
    'prompts:get:unknown-name': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/prompts#error-handling',
        behavior: 'prompts/get for an unknown name returns JSON-RPC error -32602 (Invalid params).',
        tests: [prompts.promptsGetUnknownName]
    },
    'prompts:get:with-args': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/prompts#getting-a-prompt',
        behavior: 'prompts/get with arguments interpolates them into the returned messages.',
        tests: [prompts.promptsGetWithArgs]
    },
    'prompts:list-changed': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/prompts#list-changed-notification',
        behavior: 'When the prompt set changes, notifications/prompts/list_changed is sent.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [prompts.promptsListChanged]
    },
    'prompts:list:basic': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/prompts#listing-prompts',
        behavior: 'prompts/list returns registered prompts with name, description, and argument definitions.',
        tests: [prompts.promptsListBasic]
    },
    'prompts:list:pagination': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/prompts#listing-prompts',
        behavior: 'prompts/list supports cursor pagination.',
        tests: [prompts.promptsListPagination, prompts.promptsListPaginationRaw],
        knownFailures: [
            {
                test: prompts.promptsListPagination,
                note: 'McpServer does not implement automatic pagination — handlers receive the cursor but the high-level API returns the full list with no nextCursor unless the user implements cursor handling in their own handler.'
            }
        ]
    },

    // Prompts: SDK guarantees

    'mcpserver:prompt:args-validation': {
        source: 'sdk',
        behavior: 'McpServer rejects prompts/get arguments that fail the Zod argsSchema before invoking the handler.',
        tests: [prompts.mcpserverPromptArgsValidation]
    },
    'mcpserver:prompt:duplicate-name': {
        source: 'sdk',
        behavior: 'Registering a duplicate prompt name throws.',
        tests: [prompts.mcpserverPromptDuplicateName]
    },
    'mcpserver:prompt:handle-update-remove': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior: 'The handle from prompt()/registerPrompt() can .update() and .remove(), triggering list_changed.',
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [prompts.mcpserverPromptHandleUpdateRemove]
    },
    'mcpserver:prompt:optional-args': {
        source: 'sdk',
        behavior: 'A prompt with optional arguments can be fetched without supplying them.',
        tests: [prompts.mcpserverPromptOptionalArgs]
    },
    'mcpserver:prompt:legacy-overload': {
        source: 'sdk',
        behavior:
            'McpServer.prompt() (deprecated positional overloads: name+cb, name+desc+cb, name+args+cb, name+desc+args+cb) registers a prompt that appears in prompts/list with the given description/arguments and is callable via prompts/get.',
        tests: [prompts.mcpserverPromptLegacyOverload]
    },

    // Completion

    'completion:capability:declared': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/completion#capabilities',
        behavior: "A server that supports completion/complete declares the 'completions' capability in InitializeResult.",
        tests: [completion.completionCapabilityDeclared]
    },
    'completion:context-arguments': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/completion#requesting-completions',
        behavior:
            'completion/complete passes context.arguments (already-resolved values) to the handler so completions can depend on prior selections.',
        tests: [completion.completionContextArguments]
    },
    'completion:error:invalid-ref': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/completion#error-handling',
        behavior:
            'completion/complete with a ref naming an unknown prompt (or non-matching resource URI) returns JSON-RPC error -32602 InvalidParams.',
        tests: [completion.completionErrorInvalidRef, completion.completionErrorInvalidRefRaw]
    },
    'completion:prompt-arg': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/completion#reference-types',
        behavior: "completion/complete with ref.type:'ref/prompt' returns values for a prompt argument.",
        tests: [completion.completionPromptArg]
    },
    'completion:resource-template-arg': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/completion#reference-types',
        behavior: "completion/complete with ref.type:'ref/resource' returns values for a template URI variable.",
        tests: [completion.completionResourceTemplateArg]
    },
    'completion:result-shape': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/completion#completion-results',
        behavior: 'CompleteResult carries values[≤100], optional total, optional hasMore.',
        tests: [completion.completionResultShape]
    },
    'mcpserver:completion:capability-auto': {
        source: 'sdk',
        behavior:
            'McpServer advertises the completions capability iff at least one completable() prompt arg or template complete callback is registered.',
        tests: [completion.mcpserverCompletionCapabilityAuto, completion.mcpserverCompletionCapabilityAutoRaw]
    },

    // Logging

    'logging:capability:declared': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging#capabilities',
        behavior: 'A server that emits notifications/message declares the logging capability in InitializeResult.',
        tests: [logging.loggingCapabilityDeclared]
    },
    'logging:message:fields': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging#log-message-notifications',
        behavior: 'notifications/message carries level (debug..emergency), data, and optional logger.',
        tests: [logging.loggingMessageFields]
    },
    'logging:message:filtered': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging#setting-log-level',
        behavior: 'After setLevel, notifications/message below that level are not sent.',
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [logging.loggingMessageFiltered]
    },
    'logging:set-level': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging#setting-log-level',
        behavior: 'logging/setLevel sets the minimum level for notifications/message.',
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [logging.loggingMessageFiltered]
    },
    'logging:set-level:invalid-level': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging#error-handling',
        behavior: 'logging/setLevel with an invalid level value returns JSON-RPC error -32602 (Invalid params).',
        tests: [logging.loggingSetLevelInvalidLevel, logging.loggingSetLevelInvalidLevelRaw],
        knownFailures: [
            {
                test: logging.loggingSetLevelInvalidLevel,
                note: 'Protocol wraps schema-parse failures as -32603 (InternalError), not -32602 (InvalidParams) as required by JSON-RPC 2.0.'
            }
        ]
    },
    'logging:out-of-band:basic': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior:
            'McpServer.sendLoggingMessage() called outside any request handler delivers the notifications/message to a connected client over the standalone notification stream.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [logging.loggingOutOfBandBasic]
    },

    // Sampling

    'sampling:capability:declare': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/sampling#capabilities',
        behavior:
            'A client that handles sampling/createMessage MUST advertise the sampling capability ({} for basic, {tools:{}} for tool-use support) in its initialize request.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingCapabilityDeclare]
    },
    'sampling:create:basic': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/sampling#creating-messages',
        behavior: 'Server sends sampling/createMessage with messages[] and maxTokens; client returns role, content, model, stopReason.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingCreateBasic]
    },
    'sampling:create:include-context': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/sampling#capabilities',
        behavior: "createMessage with includeContext round-trips to the client's sampler handler with the value intact.",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingCreateIncludeContext]
    },
    'sampling:create:model-preferences': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/sampling#model-preferences',
        behavior: 'createMessage may include modelPreferences (hints, costPriority, speedPriority, intelligencePriority).',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingCreateModelPreferences]
    },
    'sampling:create:system-prompt': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/sampling#creating-messages',
        behavior: 'createMessage may include systemPrompt.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingCreateSystemPrompt]
    },
    'sampling:create:tools': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/sampling#tools-in-sampling',
        behavior:
            'When client advertises sampling.tools, createMessage may include tools[] and toolChoice; result content may include tool_use blocks.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingCreateTools]
    },
    'sampling:error:user-rejected': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/sampling#error-handling',
        behavior:
            "When the user denies a sampling request, the client SHOULD return JSON-RPC error code -1 ('User rejected sampling request').",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingErrorUserRejected]
    },
    'sampling:message:content-cardinality': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/sampling',
        behavior: 'SamplingMessage.content may be a single block or an array of blocks.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingMessageContentCardinality]
    },
    'sampling:result:no-tools-single-content': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior: 'When the request has no tools/toolChoice, client rejects a handler result whose content is an array.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingResultNoToolsSingleContent]
    },
    'sampling:result:with-tools-array-content': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior: 'When the request includes tools, client accepts result content as an array including tool_use blocks.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingResultWithToolsArrayContent]
    },
    'sampling:tool-result:no-mixed-content': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/sampling#tool-result-messages',
        behavior:
            'A user SamplingMessage containing tool_result content MUST contain only tool_result blocks; mixing with text/image/audio is rejected by the client with -32602 Invalid params.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingToolResultNoMixedContent],
        knownFailures: [{ test: sampling.samplingToolResultNoMixedContent, note: 'client does not validate tool_result-only constraint' }]
    },
    'sampling:tool-use:result-balance': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/sampling#tool-use-and-result-balance',
        behavior:
            'In createMessage messages[], every assistant tool_use block MUST be matched by a tool_result with the same toolUseId in the immediately-following user message; a missing result is rejected with -32602 Invalid params.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingToolUseResultBalance],
        knownFailures: [{ test: sampling.samplingToolUseResultBalance, note: 'client does not validate tool_use/tool_result balance' }]
    },
    'sampling:tools:server-gated-by-capability': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/sampling#tools-in-sampling',
        behavior:
            'Server MUST NOT send sampling/createMessage with tools[]/toolChoice to a client that did not declare sampling.tools; the SDK rejects the send (or the client rejects the request).',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [sampling.samplingToolsServerGatedByCapability]
    },

    // Elicitation

    'elicitation:capability:empty-is-form': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#capabilities',
        behavior: 'Client advertising elicitation:{} (empty) accepts form-mode elicitation (back-compat default).',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationCapabilityEmptyIsForm]
    },
    'elicitation:capability:mode-mismatch': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#error-handling',
        behavior:
            'Client returns JSON-RPC error -32602 (Invalid params) for elicitation/create requests with a mode it did not advertise (form-only rejects url, url-only rejects form).',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationCapabilityModeMismatch]
    },
    'elicitation:capability:server-respects-mode': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#capabilities',
        behavior:
            'Server.elicitInput() rejects (or the SDK refuses to send) elicitation/create with a mode the connected client did not declare in capabilities.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationCapabilityServerRespectsMode]
    },
    'elicitation:form:action:accept': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#response-actions',
        behavior: "ElicitResult action:'accept' carries content matching requestedSchema.",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationFormActionAccept]
    },
    'elicitation:form:action:cancel': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#response-actions',
        behavior: "ElicitResult action:'cancel' carries no content.",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationFormActionCancel]
    },
    'elicitation:form:action:decline': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#response-actions',
        behavior: "ElicitResult action:'decline' carries no content.",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationFormActionDecline]
    },
    'elicitation:form:basic': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#form-mode-elicitation-requests',
        behavior: "Server sends elicitation/create with mode:'form', message, requestedSchema; client returns action + content.",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationFormBasic]
    },
    'elicitation:form:defaults': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#requested-schema',
        behavior: 'When client advertises elicitation.form.applyDefaults, schema default values are filled into the result content.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationFormDefaults]
    },
    'elicitation:form:mode-omitted-default': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#elicitation-requests',
        behavior: 'elicitation/create request with no mode field is treated as form mode by the client.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationFormModeOmittedDefault]
    },
    'elicitation:form:schema:enum-variants': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#requested-schema',
        behavior: 'requestedSchema enum fields may be bare enum, oneOf/const+title, legacy enumNames, or array items+anyOf multi-select.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationFormSchemaEnumVariants]
    },
    'elicitation:form:schema:primitives': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#requested-schema',
        behavior: 'requestedSchema fields may be string (with format), number/integer, or boolean.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationFormSchemaPrimitives]
    },
    'elicitation:url:action:accept-no-content': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#response-actions',
        behavior: "ElicitResult for URL mode with action:'accept' omits the content field (consent only, not completion).",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationUrlActionAcceptNoContent]
    },
    'elicitation:url:basic': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#url-mode-elicitation-requests',
        behavior: "Server sends elicitation/create with mode:'url', elicitationId, url; client opens URL out-of-band.",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationUrlBasic]
    },
    'elicitation:url:complete-notification': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#completion-notifications-for-url-mode-elicitation',
        behavior: 'Server sends notifications/elicitation/complete with elicitationId when the out-of-band flow finishes.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [elicitation.elicitationUrlCompleteNotification]
    },
    'elicitation:url:complete-unknown-ignored': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#completion-notifications-for-url-mode-elicitation',
        behavior:
            'Client ignores notifications/elicitation/complete referencing an unknown or already-completed elicitationId without error.',
        tests: [elicitation.elicitationUrlCompleteUnknownIgnored]
    },
    'elicitation:url:required-error': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#url-elicitation-required-error',
        behavior: 'A handler may signal URL elicitation is required via UrlElicitationRequiredError (-32042) carrying elicitations[].',
        tests: [elicitation.elicitationUrlRequiredError]
    },

    // Roots

    'roots:list-changed': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/roots#root-list-changes',
        behavior: 'When client roots change, client sends notifications/roots/list_changed; server may re-request roots/list.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [roots.rootsListChanged]
    },
    'roots:list:basic': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/roots#listing-roots',
        behavior: 'Server requests roots/list; client returns roots[] with file:// URIs.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [roots.rootsListBasic]
    },

    // list_changed & dynamic registration

    'client:list-changed:auto-refresh': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior:
            'Client configured with listChanged.{tools,prompts,resources}.onChanged auto-calls the corresponding list method and delivers the fresh list to the callback.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [dynamic.clientListChangedAutoRefresh]
    },
    'client:list-changed:capability-gated': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior: 'Client does not activate a listChanged handler for a kind the server did not advertise as listChanged:true.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [dynamic.clientListChangedCapabilityGated]
    },
    'client:list-changed:signal-only': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior: 'With autoRefresh:false, the listChanged callback is invoked with null data (signal-only).',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [dynamic.clientListChangedSignalOnly]
    },
    'mcpserver:handle:enable-disable': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior:
            'handle.disable() removes the item from list results and calling/reading it errors; handle.enable() restores it; each transition emits list_changed.',
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [dynamic.mcpserverHandleEnableDisable]
    },
    'mcpserver:list-changed:debounce': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior: 'Synchronous bursts of list-changed-triggering changes on McpServer are debounced into one notification per kind.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [dynamic.mcpserverListChangedDebounce]
    },
    'mcpserver:register:post-connect': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior:
            'Calling registerTool/registerResource/registerPrompt after connect emits the corresponding list_changed notification and the new item appears in a subsequent list call.',
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [dynamic.mcpserverRegisterPostConnect]
    },

    // Pagination

    'pagination:invalid-cursor': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination#error-handling',
        behavior:
            'A list request (tools/list, resources/list, resources/templates/list, prompts/list) with an invalid cursor returns JSON-RPC error -32602 (InvalidParams).',
        tests: [pagination.paginationInvalidCursor],
        knownFailures: [
            {
                test: pagination.paginationInvalidCursor,
                note: 'McpServer does not implement automatic pagination — handlers receive the cursor but the high-level API ignores invalid cursors instead of returning -32602.'
            }
        ]
    },

    // Tasks
    'protocol:meta:related-task': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#related-task-metadata',
        behavior: "Messages may carry _meta['io.modelcontextprotocol/related-task'] = {taskId} to associate with a task.",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },

    'tasks:auth:context-isolation': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#task-isolation-and-access-control',
        behavior:
            "With an authorization context, tasks/get|result|cancel for a task created under a different auth context are rejected, and tasks/list returns only tasks from the requestor's auth context.",
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:bidirectional': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#definitions',
        behavior: 'Task APIs are bidirectional: server may create/get/list/cancel tasks on the client (e.g. task-augmented elicitation).',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:cancel:no-handler-abort': {
        source: 'sdk',
        behavior: "tasks/cancel does not abort the originating request handler's signal.",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:cancel:remains-cancelled': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#task-cancellation',
        behavior:
            "After tasks/cancel, the task remains in 'cancelled' status even if the underlying handler subsequently completes or fails.",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:cancel:terminal-rejected': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#task-cancellation',
        behavior: 'tasks/cancel on a task already in a terminal state returns InvalidParams (-32602).',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:cancel:working': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#task-cancellation',
        behavior: 'tasks/cancel on a working task transitions it to cancelled and returns the updated Task.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:create:ttl-honored': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#ttl-and-resource-management',
        behavior:
            'The returned task metadata includes the actual ttl (receivers MAY override the requested value; MUST include the actual ttl or null).',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:create:via-tool-call': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#creating-tasks',
        behavior: 'tools/call with params.task returns CreateTaskResult {task:{taskId,status,ttl,...}} instead of CallToolResult.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:get': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#getting-tasks',
        behavior: 'tasks/get returns the current Task (status, ttl, timestamps, statusMessage).',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:lifecycle:initial-working': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#task-status-lifecycle',
        behavior: "A newly created task has status 'working' in the CreateTaskResult.",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:lifecycle:input-required': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#input-required-status',
        behavior:
            "While a task awaits a side-channel client response its status is 'input_required'; once the response arrives status returns to 'working' before terminal.",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:list:invalid-cursor': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#protocol-errors',
        behavior: 'tasks/list with an invalid or nonexistent cursor returns InvalidParams (-32602).',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:list:pagination': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#listing-tasks',
        behavior: 'tasks/list returns created tasks and supports cursor pagination.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:no-capability:ignore-task-param': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#task-support-and-handling',
        behavior:
            'A receiver that did not declare task capability for a request type processes the request normally and returns the ordinary result, ignoring params.task.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:progress:after-create': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#task-progress-notifications',
        behavior:
            "After CreateTaskResult, progress notifications keyed to the original progressToken continue to reach the caller's onprogress until terminal.",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:request-cancel:no-task-cancel': {
        source: 'sdk',
        behavior: 'notifications/cancelled for the originating request does not auto-cancel the created task.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:result:failed': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#task-execution-errors',
        behavior: 'tasks/result for a failed task returns the failure result (isError:true).',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:result:related-task-meta': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#related-task-metadata',
        behavior: "tasks/result response carries _meta['io.modelcontextprotocol/related-task'] = {taskId} matching the requested task.",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:result:terminal': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#result-retrieval',
        behavior: 'tasks/result for a completed task returns the stored result of the original request type.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:side-channel:drain-fifo': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#input-required-status',
        behavior: 'Calling tasks/result drains queued related-task messages in FIFO order before returning the final result.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:side-channel:drop-on-cancel': {
        source: 'sdk',
        behavior: 'When a task is cancelled before tasks/result, queued related-task messages are dropped.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:side-channel:elicitation': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#input-required-status',
        behavior:
            'A tool handler issuing elicitation mid-task delivers it via the tasks/result side-channel; client response routes back to the handler.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:side-channel:queue': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#input-required-status',
        behavior: 'Server→client requests with relatedTask metadata, sent while no tasks/result is open, are queued.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:side-channel:sampling': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#input-required-status',
        behavior:
            'A task handler issuing sampling/createMessage mid-task delivers it via the tasks/result side-channel; the client response routes back to the task and appears in the terminal result.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:side-channel:stream': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#result-retrieval',
        behavior: 'Calling tasks/result while the task is working streams related-task messages as produced, then returns the result.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:status-notification': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#task-status-notification',
        behavior: 'notifications/tasks/status delivers task status updates with full Task fields.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:tool-level:forbidden-with-task-32601': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#tool-level-negotiation',
        behavior:
            "tools/call with params.task on a tool whose execution.taskSupport is absent or 'forbidden' returns JSON-RPC error -32601 (Method not found).",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:tool-level:required-no-task-32601': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#tool-level-negotiation',
        behavior:
            "tools/call without params.task on a tool advertising execution.taskSupport:'required' returns JSON-RPC error -32601 (Method not found).",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'tasks:unknown-id': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks#protocol-errors',
        behavior: 'tasks/get, tasks/result, tasks/cancel for an unknown taskId return InvalidParams (-32602).',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },

    // Tasks: registerToolTask (SDK)

    'mcpserver:tooltask:advertise': {
        source: 'sdk',
        behavior: 'registerToolTask tools advertise their execution.taskSupport in tools/list.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'mcpserver:tooltask:autopoll-cancelled': {
        source: 'sdk',
        behavior: 'Auto-polling surfaces a cancelled task as an error result.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'mcpserver:tooltask:autopoll-failed': {
        source: 'sdk',
        behavior: 'Auto-polling surfaces a task that ends failed as the failed CallToolResult.',
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'mcpserver:tooltask:forbidden-throws': {
        source: 'sdk',
        behavior: "registerToolTask throws at registration if taskSupport:'forbidden'.",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'mcpserver:tooltask:optional-autopoll': {
        source: 'sdk',
        behavior:
            "A taskSupport:'optional' tool called without task augmentation transparently creates and polls the task, returning the final CallToolResult.",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'mcpserver:tooltask:required-with-task': {
        source: 'sdk',
        behavior: "A taskSupport:'required' tool called with task augmentation returns CreateTaskResult.",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },
    'mcpserver:tooltask:required-without-task': {
        source: 'sdk',
        behavior: "A registerToolTask tool with taskSupport:'required' returns isError when called without task augmentation.",
        tests: [],
        deferred:
            'Tasks are experimental and the spec is being substantially revised. Scenarios deferred until the next spec revision settles.'
    },

    // Client streaming API (SDK)

    'client:stream:non-task-single': {
        source: 'sdk',
        behavior: 'requestStream() on a non-task request yields exactly the final result.',
        tests: [],
        deferred: 'client.stream() is a thin wrapper over tasks; deferred with tasks.'
    },
    'client:stream:task-elicitation': {
        source: 'sdk',
        behavior:
            'callToolStream() over a task-augmented tool with mid-task elicitation delivers it to the client handler and yields the final result.',
        tests: [],
        deferred: 'client.stream() is a thin wrapper over tasks; deferred with tasks.'
    },
    'client:stream:terminal-error': {
        source: 'sdk',
        behavior:
            'requestStream() yields a terminal error message and nothing further on server error, timeout, abort, network error, or task failure.',
        tests: [],
        deferred: 'client.stream() is a thin wrapper over tasks; deferred with tasks.'
    },
    'client:stream:tool-validation': {
        source: 'sdk',
        behavior:
            'callToolStream() applies the same outputSchema validation as callTool(); mismatch yields an error, isError skips validation.',
        tests: [],
        deferred:
            'client.stream() is a thin wrapper over tasks; deferred with tasks, part of the task-streaming work and not transport-specific.'
    },

    // McpServer reach-through (SDK)

    'mcpserver:reach-through:set-request-handler': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior:
            'mcpServer.server is public: .server.setRequestHandler(Schema, fn) installs a low-level handler alongside high-level registrations. A handler for a method McpServer has not auto-wired (e.g. resources/list with no registerResource) is reachable by clients; if set before the first registerX of that kind, registerX throws via assertCanSetRequestHandler.',
        note: 'Under stateless hosting each request is served by a new server instance, so state set up earlier in the session cannot be observed.',
        tests: [dynamic.mcpserverReachThroughSetRequestHandler]
    },

    // Validation (SDK)

    'validation:cfworker-provider': {
        source: 'sdk',
        behavior:
            'Passing jsonSchemaValidator: new CfWorkerJsonSchemaValidator() to the Client produces the same accept/reject outcomes as the default Ajv provider for client-side tool outputSchema validation.',
        tests: [validation.validationCfworkerProvider]
    },
    'validation:pluggable-provider': {
        source: 'sdk',
        behavior:
            'ClientOptions.jsonSchemaValidator swaps the JSON Schema validator implementation: the configured provider is the one consulted for client-side tool outputSchema validation and its verdicts are honored.',
        tests: [validation.validationPluggableProvider]
    },

    // Hosting: session lifecycle

    'hosting:session:cors-expose': {
        source: 'sdk',
        behavior: 'CORS exposes Mcp-Session-Id so browser clients can read it.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and session management; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingSessionCorsExpose]
    },
    'hosting:session:create': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management',
        behavior:
            'POST initialize with no Mcp-Session-Id creates a session; Mcp-Session-Id is returned in response headers and onsessioninitialized fires.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and session management; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingSessionCreate]
    },
    'hosting:session:delete': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management',
        behavior: 'DELETE with valid Mcp-Session-Id returns 200, fires onsessionclosed, removes the transport.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and session management; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingSessionDelete]
    },
    'hosting:session:id-charset': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management',
        behavior: 'Generated MCP-Session-Id values contain only visible ASCII characters (0x21–0x7E).',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and session management; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingSessionIdCharset]
    },
    'hosting:session:isolation': {
        source: 'sdk',
        behavior: 'Each session has its own McpServer instance; closing one does not affect others.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and session management; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingSessionIsolation]
    },
    'hosting:session:missing-id': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management',
        behavior: 'Non-initialize POST without Mcp-Session-Id in stateful mode returns 400.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and session management; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingSessionMissingId]
    },
    'hosting:session:reinitialize': {
        source: 'sdk',
        behavior: 'Second initialize on an already-initialized transport returns 400.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and session management; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingSessionReinitialize]
    },
    'hosting:session:reuse': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management',
        behavior: "POST with a valid Mcp-Session-Id routes to that session's transport with state preserved.",
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and session management; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingSessionReuse]
    },
    'hosting:session:unknown-id': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management',
        behavior: 'POST/GET/DELETE with an unknown Mcp-Session-Id returns 404.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and session management; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingSessionUnknownId],
        knownFailures: [
            {
                test: hostingSession.hostingSessionUnknownId,
                note: "The SDK's documented hosting pattern rejects unknown session ids with 400 at the app level (see src/examples servers); the transport's own validateSession 404 is never reached, while the spec requires 404."
            }
        ]
    },
    'hosting:stateless:concurrent-clients': {
        source: 'sdk',
        behavior: 'Multiple independent clients can connect to a stateless server concurrently.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and stateless mode; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingStatelessConcurrentClients]
    },
    'hosting:stateless:no-reuse': {
        source: 'sdk',
        behavior: 'Reusing a stateless transport for a second request throws.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and stateless mode; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingStatelessNoReuse]
    },
    'hosting:stateless:no-session-id': {
        source: 'sdk',
        behavior: 'With sessionIdGenerator:undefined, no Mcp-Session-Id is emitted and no session validation is performed.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and stateless mode; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingStatelessNoSessionId]
    },
    'hosting:session:delete-cancels-inflight': {
        source: 'sdk',
        behavior:
            "DELETE on a session aborts every in-flight request handler's RequestHandlerExtra.signal; their POST-initiated SSE streams close without a JSON-RPC response being written.",
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and session management; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingSessionDeleteCancelsInflight]
    },
    'hosting:stateless:get-delete-405': {
        source: 'sdk',
        behavior:
            'In stateless mode (sessionIdGenerator: undefined), GET (standalone SSE) and DELETE on /mcp return 405 Method Not Allowed — there is no session to stream to or terminate.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and stateless mode; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingStatelessGetDelete405],
        knownFailures: [
            {
                test: hostingSession.hostingStatelessGetDelete405,
                note: 'webStandardStreamableHttp.ts:833-836: validateSession() returns undefined in stateless mode, so GET opens an SSE stream and DELETE succeeds with 200 instead of 405.'
            }
        ]
    },
    'hosting:stateless:progress-in-post-stream': {
        source: 'sdk',
        behavior:
            "In stateless mode (sessionIdGenerator: undefined), notifications/progress emitted by a tool handler via sendNotification are delivered on the POST-initiated SSE stream and reach the client's onprogress before the result resolves.",
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer and stateless mode; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingSession.hostingStatelessProgressInPostStream]
    },
    'hosting:stateless:server-to-client-request-fails': {
        source: 'sdk',
        behavior:
            "In stateless mode (sessionIdGenerator:undefined), a handler calling server.createMessage() / elicitInput() / listRoots() rejects promptly with a clear error instead of hanging — there is no back-channel for the client's response to reach this transport instance.",
        transports: ['streamableHttpStateless'],
        note: 'The exercised behavior depends on stateless hosting; the test runs as streamableHttpStateless to test the specific stateless condition.',
        tests: [hostingSession.hostingStatelessServerToClientRequestFails],
        knownFailures: [
            {
                test: hostingSession.hostingStatelessServerToClientRequestFails,
                note: 'Under stateless hosting a server-to-client request (e.g. sampling/createMessage) with no GET stream and no relatedRequestId is silently dropped by send(), so the tool call hangs instead of failing fast with an error result.'
            }
        ]
    },

    // Hosting: auth

    'hosting:auth:as-router': {
        source: 'sdk',
        behavior: 'mcpAuthRouter mounts the /authorize, /token, /register, and /revoke endpoints and serves them.',
        transports: ['streamableHttp'],
        note: 'These exercise the HTTP hosting/auth layer (mostly over real Express); the matrix transport arg is ignored, so they run as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingExpress.hostingAuthAsRouter]
    },
    'hosting:auth:aud-validation': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#access-token-usage',
        behavior: 'Resource server MUST validate the token audience (aud) matches its resource identifier per RFC 8707.',
        transports: ['streamableHttp'],
        note: 'These exercise the HTTP hosting/auth layer (mostly over real Express); the matrix transport arg is ignored, so they run as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingExpress.hostingAuthAudValidation],
        knownFailures: [
            {
                test: hostingExpress.hostingAuthAudValidation,
                note: 'src/server/auth/middleware/bearerAuth.ts: authInfo.resource is never compared to the resource identifier — audience validation missing.'
            }
        ]
    },
    'hosting:auth:authinfo-propagates': {
        source: 'sdk',
        behavior: 'Verified AuthInfo passed to handleRequest(req, { authInfo }) is exposed to tool handlers as extra.authInfo unchanged.',
        transports: ['streamableHttp'],
        note: 'These exercise the HTTP hosting/auth layer (mostly over real Express); the matrix transport arg is ignored, so they run as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingAuth.hostingAuthAuthinfoPropagates]
    },
    'hosting:auth:expired-401': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#token-handling',
        behavior: 'Expired token returns 401 invalid_token.',
        transports: ['streamableHttp'],
        note: 'These exercise the HTTP hosting/auth layer (mostly over real Express); the matrix transport arg is ignored, so they run as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingExpress.hostingAuthExpired401]
    },
    'hosting:auth:invalid-401': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#token-handling',
        behavior: 'Malformed bearer or token-verification failure returns 401 with WWW-Authenticate.',
        transports: ['streamableHttp'],
        note: 'These exercise the HTTP hosting/auth layer (mostly over real Express); the matrix transport arg is ignored, so they run as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingExpress.hostingAuthInvalid401]
    },
    'hosting:auth:metadata-endpoints': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-server-location',
        behavior: 'Server publishes /.well-known/oauth-protected-resource and /.well-known/oauth-authorization-server.',
        transports: ['streamableHttp'],
        note: 'These exercise the HTTP hosting/auth layer (mostly over real Express); the matrix transport arg is ignored, so they run as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingExpress.hostingAuthMetadataEndpoints]
    },
    'hosting:auth:missing-401': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#error-handling',
        behavior: 'Missing Authorization header returns 401 with WWW-Authenticate including resource_metadata.',
        transports: ['streamableHttp'],
        note: 'These exercise the HTTP hosting/auth layer (mostly over real Express); the matrix transport arg is ignored, so they run as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingExpress.hostingAuthMissing401]
    },
    'hosting:auth:prm:authorization-servers-field': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-server-location',
        behavior:
            'The Protected Resource Metadata document served by the MCP server includes an authorization_servers array with at least one entry.',
        transports: ['streamableHttp'],
        note: 'These exercise the HTTP hosting/auth layer (mostly over real Express); the matrix transport arg is ignored, so they run as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingExpress.hostingAuthPrmAuthorizationServersField]
    },
    'hosting:auth:scope-403': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#runtime-insufficient-scope-errors',
        behavior:
            'Token lacking a required scope returns 403 with WWW-Authenticate including error="insufficient_scope", scope, and resource_metadata.',
        transports: ['streamableHttp'],
        note: 'These exercise the HTTP hosting/auth layer (mostly over real Express); the matrix transport arg is ignored, so they run as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingExpress.hostingAuthScope403]
    },
    'hosting:auth:proxy-provider': {
        source: 'sdk',
        behavior:
            'ProxyOAuthServerProvider plugged into mcpAuthRouter mounts the /authorize, /token, and /revoke endpoints and serves them.',
        transports: ['streamableHttp'],
        note: 'These exercise the HTTP hosting/auth layer (mostly over real Express); the matrix transport arg is ignored, so they run as a single streamableHttp-labelled cell to avoid duplicate runs. Asserting that requests are forwarded to the configured upstream AS endpoints is post-ship backlog.',
        tests: [hostingExpress.hostingAuthProxyProvider]
    },

    // Hosting: resumability

    'hosting:resume:bad-event-id': {
        source: 'sdk',
        behavior: 'Last-Event-ID that cannot be mapped to a stream returns 400; replay failure returns 500.',
        transports: ['streamableHttp'],
        note: 'Resumability requires a per-session transport with an EventStore and a standalone GET stream; stateless hosting has neither.',
        tests: [hostingResume.hostingResumeBadEventId]
    },
    'hosting:resume:buffered-replay': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#resumability-and-redelivery',
        behavior: 'Notifications emitted while no client is connected are replayed in order on reconnect.',
        transports: ['streamableHttp'],
        note: 'Resumability requires a per-session transport with an EventStore and a standalone GET stream; stateless hosting has neither.',
        tests: [hostingResume.hostingResumeBufferedReplay]
    },
    'hosting:resume:close-stream': {
        source: 'sdk',
        behavior:
            'Handlers receive closeSSEStream/closeStandaloneSSEStream when eventStore is configured; calling them ends the stream cleanly.',
        transports: ['streamableHttp'],
        note: 'Resumability requires a per-session transport with an EventStore and a standalone GET stream; stateless hosting has neither.',
        tests: [hostingResume.hostingResumeCloseStream]
    },
    'hosting:resume:event-ids': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#resumability-and-redelivery',
        behavior: 'With eventStore configured, every SSE event carries an id: field.',
        transports: ['streamableHttp'],
        note: 'Resumability requires a per-session transport with an EventStore and a standalone GET stream; stateless hosting has neither.',
        tests: [hostingResume.hostingResumeEventIds]
    },
    'hosting:resume:priming': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server',
        behavior: 'With eventStore + new protocol, POST SSE streams begin with a priming event carrying the configured retry: interval.',
        transports: ['streamableHttp'],
        note: 'Resumability requires a per-session transport with an EventStore and a standalone GET stream; stateless hosting has neither.',
        tests: [hostingResume.hostingResumePriming]
    },
    'hosting:resume:replay': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#resumability-and-redelivery',
        behavior: 'GET with Last-Event-ID replays stored events for that stream after the given ID.',
        transports: ['streamableHttp'],
        note: 'Resumability requires a per-session transport with an EventStore and a standalone GET stream; stateless hosting has neither.',
        tests: [hostingResume.hostingResumeReplay]
    },
    'hosting:resume:stream-scoped': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#resumability-and-redelivery',
        behavior:
            'Replay via Last-Event-ID returns only messages from the stream that event ID belongs to, never messages from other streams.',
        transports: ['streamableHttp'],
        note: 'Resumability requires a per-session transport with an EventStore and a standalone GET stream; stateless hosting has neither.',
        tests: [hostingResume.hostingResumeStreamScoped]
    },

    // Hosting: HTTP semantics

    'hosting:http:accept-406': {
        source: 'sdk',
        behavior: 'GET without Accept:text/event-stream, or POST without acceptable Accept, returns 406.',
        transports: ['streamableHttp'],
        note: 'These test the per-session host layer (via hostPerSession helper); stateless transport tests use hostStateless which has different request routing.',
        tests: [hostingHttp.hostingHttpAccept406]
    },
    'hosting:http:batch': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server',
        behavior:
            'POST body is a single JSON-RPC message; batched arrays are accepted only as an SDK back-compat affordance for pre-2025-06-18 clients (spec forbids batches).',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpBatch]
    },
    'hosting:http:content-type-415': {
        source: 'sdk',
        behavior: 'POST with Content-Type other than application/json returns 415.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpContentType415]
    },
    'hosting:http:disconnect-not-cancel': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server',
        behavior:
            'Client HTTP connection drop during an in-flight request does not abort the server-side handler; the request continues and its result is available via resumption.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpDisconnectNotCancel]
    },
    'hosting:http:dns-rebinding': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#security-warning',
        behavior: 'With DNS-rebinding protection enabled, disallowed Host/Origin returns 403; missing Origin is accepted.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpDnsRebinding]
    },
    'hosting:http:json-response-mode': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server',
        behavior: 'With enableJsonResponse:true, POST returns application/json instead of SSE.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpJsonResponseMode]
    },
    'hosting:http:method-405': {
        source: 'sdk',
        behavior: 'Unsupported HTTP method on /mcp returns 405.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpMethod405]
    },
    'hosting:http:no-broadcast': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#multiple-connections',
        behavior:
            'When multiple SSE streams are open for a session, each server-originated JSON-RPC message is sent on exactly one stream (never duplicated).',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpNoBroadcast]
    },
    'hosting:http:notifications-202': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server',
        behavior: 'POST containing only notifications/responses returns 202 with no body.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpNotifications202]
    },
    'hosting:http:onerror': {
        source: 'sdk',
        behavior: "All transport-level rejections invoke the transport's onerror callback.",
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpOnerror]
    },
    'hosting:http:parse-error-400': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server',
        behavior: 'Invalid JSON or invalid JSON-RPC envelope returns 400 with -32700 ParseError body.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpParseError400]
    },
    'hosting:http:protocol-version-400': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#protocol-version-header',
        behavior: 'Unsupported mcp-protocol-version header returns 400 listing supported versions.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpProtocolVersion400]
    },
    'hosting:http:response-same-connection': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server',
        behavior: 'A response is written to the same HTTP connection that carried its request.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpResponseSameConnection]
    },
    'hosting:http:second-sse-rejected': {
        source: 'sdk',
        behavior: 'A second concurrent standalone GET SSE on the same session is rejected.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpSecondSseRejected]
    },
    'hosting:http:sse-close-after-response': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server',
        behavior: 'Server terminates a POST-initiated SSE stream after writing the JSON-RPC response.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpSseCloseAfterResponse]
    },
    'hosting:http:standalone-sse': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#listening-for-messages-from-the-server',
        behavior: 'GET opens a standalone SSE stream that receives server-initiated notifications.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpStandaloneSse]
    },
    'hosting:http:standalone-sse-no-response': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#listening-for-messages-from-the-server',
        behavior:
            'The standalone GET SSE stream carries server requests/notifications but never a JSON-RPC response (except when resuming a prior request stream).',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpStandaloneSseNoResponse]
    },
    'hosting:express-app-helper': {
        transports: ['streamableHttp'],
        source: 'sdk',
        behavior:
            'createMcpExpressApp() returns an Express app with JSON body parsing and localhost host-header validation pre-applied: an MCP endpoint mounted on it serves an initialize POST over real HTTP from 127.0.0.1 and rejects a spoofed Host header with 403.',
        note: 'This exercises the Express hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingExpress.hostingExpressAppHelper]
    },
    'hosting:http:host-validation-middleware': {
        transports: ['streamableHttp'],
        source: 'sdk',
        behavior:
            "hostHeaderValidation()/localhostHostValidation() Express middleware reject requests whose Host header is missing or not in the allow-list with 403 (port-agnostic), independent of the transport's enableDnsRebindingProtection.",
        note: 'This exercises the Express hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingExpress.hostingHttpHostValidationMiddleware]
    },
    'hosting:http:send-no-listener-noop': {
        source: 'sdk',
        behavior:
            'A server-initiated notification sent on a stateful session with no open standalone GET SSE stream does not throw; it is silently dropped (or stored for replay when an eventStore is configured).',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting layer; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [hostingHttp.hostingHttpSendNoListenerNoop]
    },

    // Client transport: streamableHttp

    'client-transport:http:404-surfaces': {
        source: 'sdk',
        behavior: 'A 404 (session expired) on a request surfaces as an error to the caller.',
        transports: ['streamableHttp'],
        note: 'Session-id continuity testing requires the per-session host (404 is session-not-found).',
        tests: [transportHttp.clientTransportHttp404Surfaces]
    },
    'client-transport:http:session-404-reinitialize': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management',
        behavior:
            'When a request carrying an Mcp-Session-Id receives HTTP 404, the client starts a new session by sending a new InitializeRequest without a session ID, and the original operation then succeeds against the new session.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpSession404Reinitialize],
        knownFailures: [
            {
                test: transportHttp.clientTransportHttpSession404Reinitialize,
                note: 'On a 404 for an existing session the transport throws StreamableHTTPError (streamableHttp.ts:551) and never re-initializes — no session recovery is attempted.'
            }
        ]
    },
    'client-transport:http:accept-header-get': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#listening-for-messages-from-the-server',
        behavior: 'Client GET to the MCP endpoint includes an Accept header listing text/event-stream.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpAcceptHeaderGet]
    },
    'client-transport:http:accept-header-post': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server',
        behavior: 'Every client POST to the MCP endpoint includes an Accept header listing both application/json and text/event-stream.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpAcceptHeaderPost]
    },
    'client-transport:http:concurrent-streams': {
        source: 'sdk',
        behavior: 'Multiple concurrent POST-initiated SSE streams each deliver their response to the right caller.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpConcurrentStreams]
    },
    'client-transport:http:custom-fetch': {
        source: 'sdk',
        behavior: 'A custom fetch in options is used for all HTTP including OAuth; global fetch is not called.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpCustomFetch]
    },
    'client-transport:http:custom-headers': {
        source: 'sdk',
        behavior: 'requestInit.headers (object, Headers, or tuple array) are sent on every POST/GET/DELETE.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpCustomHeaders]
    },
    'client-transport:http:json-response-parsed': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server',
        behavior: 'Content-Type:application/json response is parsed as a single JSON-RPC message.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpJsonResponseParsed]
    },
    'client-transport:http:no-reconnect-after-close': {
        source: 'sdk',
        behavior: 'After transport.close(), no further reconnection attempts are scheduled.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpNoReconnectAfterClose]
    },
    'client-transport:http:no-reconnect-after-response': {
        source: 'sdk',
        behavior: 'POST-initiated stream that already delivered its response is not reconnected on close.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpNoReconnectAfterResponse]
    },
    'client-transport:http:protocol-version-header': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#protocol-version-header',
        behavior: 'After initialize, client sends the negotiated MCP-Protocol-Version header on every subsequent HTTP request.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpProtocolVersionHeader]
    },
    'client-transport:http:protocol-version-stored': {
        source: 'sdk',
        behavior: 'transport.protocolVersion is populated after connect() completes.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpProtocolVersionStored]
    },
    'client-transport:http:reconnect-get': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#resumability-and-redelivery',
        behavior: 'GET-initiated SSE stream that errors is reconnected with Last-Event-ID of the last received event.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpReconnectGet]
    },
    'client-transport:http:reconnect-post-priming': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server',
        behavior: 'POST-initiated SSE stream that errors is reconnected only if a priming event was received.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpReconnectPostPriming]
    },
    'client-transport:http:reconnect-retry-value': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#sending-messages-to-the-server',
        behavior: 'Reconnection delay uses the SSE retry: value if sent; otherwise exponential backoff up to maxRetries.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpReconnectRetryValue]
    },
    'client-transport:http:resume-stream-api': {
        source: 'sdk',
        behavior:
            'Client can capture lastEventId via onresumptiontoken, reconnect with the same sessionId, call resumeStream(lastEventId), and receive missed notifications.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpResumeStreamApi]
    },
    'client-transport:http:session-stored': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management',
        behavior: 'Mcp-Session-Id from initialize is stored on transport.sessionId and sent on every subsequent request.',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpSessionStored]
    },
    'client-transport:http:sse-405-tolerated': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#listening-for-messages-from-the-server',
        behavior: 'Opening the standalone GET SSE stream tolerates 405 without failing start().',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpSse405Tolerated]
    },
    'client-transport:http:terminate-405-ok': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management',
        behavior: 'terminateSession() resolves without error if the server responds 405 (termination unsupported).',
        transports: ['streamableHttp'],
        note: 'This exercises the StreamableHTTP client transport directly; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [transportHttp.clientTransportHttpTerminate405Ok]
    },
    'client-transport:http:body-stream-error-preserved': {
        source: 'sdk',
        behavior:
            'When the SSE response body stream errors during read, transport.onerror is invoked with an Error that preserves the original thrown error (as the instance itself or via .cause), not a string-interpolated wrapper that discards its type and stack.',
        transports: ['streamableHttp'],
        note: 'Session-id continuity testing requires the per-session host (validates session recovery/GET stream behavior).',
        tests: [transportHttp.clientTransportHttpBodyStreamErrorPreserved],
        knownFailures: [
            {
                test: transportHttp.clientTransportHttpBodyStreamErrorPreserved,
                note: 'src/client/streamableHttp.ts error-wrapping code: SSE body-stream errors wrapped as new Error(`SSE stream disconnected: ...`) with no .cause, losing original instance/stack.'
            }
        ]
    },

    // Client auth

    'client-auth:401-after-auth-throws': {
        source: 'sdk',
        behavior: 'If the server still returns 401 after a successful auth, the transport throws instead of looping.',
        transports: ['streamableHttp'],
        note: 'These exercise the HTTP hosting/auth layer (mostly over real Express); the matrix transport arg is ignored, so they run as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuth401AfterAuthThrows]
    },
    'client-auth:401-triggers-flow': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#protected-resource-metadata-discovery-requirements',
        behavior: '401 on POST triggers the OAuth authProvider flow once.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuth401TriggersFlow]
    },
    'client-auth:403-scope-upgrade': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#step-up-authorization-flow',
        behavior: '403 with WWW-Authenticate triggers a scope-upgrade auth attempt; repeated 403s do not loop.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuth403ScopeUpgrade]
    },
    'client-auth:as-metadata-discovery:priority-order': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-server-metadata-discovery',
        behavior:
            'Client discovers AS metadata by trying, in order: OAuth AS metadata (path-inserted), OIDC discovery (path-inserted), OIDC discovery (path-appended); for issuers without a path, OAuth AS metadata then OIDC discovery.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthAsMetadataDiscoveryPriorityOrder]
    },
    'client-auth:bearer-header:every-request': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#token-requirements',
        behavior:
            'Once authorized, client sends Authorization: Bearer <token> on every HTTP request to the MCP server (POST, GET SSE, DELETE), never in the query string.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthBearerHeaderEveryRequest]
    },
    'client-auth:cimd': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-id-metadata-document',
        behavior: 'Client uses its CIMD URL as the OAuth client_id (no DCR) when configured to do so.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthCimd]
    },
    'client-auth:client-credentials': {
        source: 'sdk',
        behavior:
            'ClientCredentialsProvider obtains a token via the client_credentials grant during connect() with no user interaction; the resulting bearer token authorizes subsequent requests.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthClientCredentials]
    },
    'client-auth:dcr': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#dynamic-client-registration',
        behavior:
            'Client performs RFC 7591 dynamic client registration against the AS /register endpoint when no client_id is preconfigured.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthDcr]
    },
    'client-auth:invalid-client-clears-all': {
        source: 'sdk',
        behavior: 'InvalidClientError/UnauthorizedClientError during auth invalidates all stored credentials.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthInvalidClientClearsAll]
    },
    'client-auth:invalid-grant-clears-tokens': {
        source: 'sdk',
        behavior: 'InvalidGrantError during auth invalidates only tokens.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthInvalidGrantClearsTokens]
    },
    'client-auth:pkce:refuse-if-unsupported': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-code-protection',
        behavior: 'Client refuses to proceed when AS metadata advertises code_challenge_methods_supported without S256.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthPkceRefuseIfUnsupported]
    },
    'client-auth:pkce:s256': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-code-protection',
        behavior:
            'Client authorization request includes PKCE code_challenge with code_challenge_method=S256; token request includes the matching code_verifier.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthPkceS256]
    },
    'client-auth:pre-registration': {
        source: 'sdk',
        behavior: 'Client with statically preconfigured client_id/secret skips DCR and uses those credentials directly.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthPreRegistration]
    },
    'client-auth:private-key-jwt': {
        source: 'sdk',
        behavior:
            'PrivateKeyJwtProvider authenticates the client_credentials grant with a signed JWT assertion (client_assertion_type=jwt-bearer) instead of a client_secret.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthPrivateKeyJwt]
    },
    'client-auth:prm-discovery:fallback-order': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#protected-resource-metadata-discovery-requirements',
        behavior:
            'Client uses resource_metadata from the WWW-Authenticate header when present; otherwise falls back to GET /.well-known/oauth-protected-resource/<path>, then /.well-known/oauth-protected-resource at the root.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthPrmDiscoveryFallbackOrder]
    },
    'client-auth:prm-resource-mismatch': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-server-location',
        behavior: 'Client refuses to proceed with auth when the PRM resource field does not match the MCP server URL it is connecting to.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthPrmResourceMismatch]
    },
    'client-auth:resource-parameter': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#resource-parameter-implementation',
        behavior:
            'Client includes the RFC 8707 resource parameter (canonical MCP server URI) in both the authorization request and the token request, regardless of AS support.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthResourceParameter]
    },
    'client-auth:scope-selection:priority': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#scope-selection-strategy',
        behavior:
            'Client selects requested scope from the WWW-Authenticate scope param if present; otherwise uses scopes_supported from the PRM document; otherwise omits scope.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthScopeSelectionPriority]
    },
    'client-auth:state:verify': {
        source: 'sdk',
        behavior: 'SDK calls provider.state?.() and includes the returned value as the state parameter in the authorize URL.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthStateVerify]
    },
    'client-auth:token-endpoint-auth-method': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#token-request',
        behavior:
            'Client authenticates to /token using the token_endpoint_auth_method from registration (client_secret_basic, client_secret_post, or none).',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthTokenEndpointAuthMethod]
    },
    'client-auth:low-level:discover-and-exchange': {
        source: 'sdk',
        behavior:
            'The low-level auth helpers compose standalone: discoverOAuthProtectedResourceMetadata → discoverAuthorizationServerMetadata → startAuthorization → exchangeAuthorization, called directly (without the auth() orchestrator or an OAuthClientProvider), chain their outputs to inputs and yield valid OAuthTokens against a live AS.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthLowLevelDiscoverAndExchange]
    },
    'client-auth:middleware:with-oauth': {
        source: 'sdk',
        behavior:
            'withOAuth(provider, baseUrl) wraps a fetch: adds Authorization: Bearer from provider.tokens(); on 401 it runs the auth() flow (discovery/refresh) and retries once with the fresh token; a REDIRECT result or a second 401 throws UnauthorizedError.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthMiddlewareWithOauth]
    },
    'client-auth:private-key-jwt:static-assertion': {
        source: 'sdk',
        behavior:
            'StaticPrivateKeyJwtProvider authenticates the client_credentials grant by sending a caller-supplied pre-built JWT verbatim as client_assertion (jwt-bearer), with a fixed client_id so DCR is skipped — no per-request signing.',
        transports: ['streamableHttp'],
        note: 'This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientAuthPrivateKeyJwtStaticAssertion]
    },

    // Client middleware (SDK)

    'client-middleware:compose': {
        source: 'sdk',
        behavior:
            'applyMiddlewares(...mw) chains createMiddleware-built handlers in declaration order around a base fetch; passed as the transport fetch option, each layer can read/mutate request init and the result reaches the server.',
        transports: ['streamableHttp'],
        note: 'Exercises the client fetch middleware over HTTP; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientMiddlewareCompose]
    },
    'client-middleware:with-logging': {
        source: 'sdk',
        behavior:
            'withLogging() wraps fetch: invokes the configured logger once per HTTP request with {method, url, status, duration} and passes the response through unmodified so the MCP call result is unaffected.',
        transports: ['streamableHttp'],
        note: 'Exercises the client fetch middleware over HTTP; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [clientAuth.clientMiddlewareWithLogging]
    },

    // stdio transport

    'transport:stdio:clean-shutdown': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#shutdown',
        behavior: "Closing the client transport closes the child process's stdin; server exits cleanly.",
        transports: ['stdio'],
        note: 'Spawn-based tests against the real StdioClientTransport child process; only meaningful on stdio.',
        tests: [stdio.transportStdioCleanShutdown]
    },
    'transport:stdio:no-embedded-newlines': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio',
        behavior: 'Serialized JSON-RPC messages on stdio contain no embedded newline characters; one message per line.',
        transports: ['stdio'],
        note: 'Spawn-based tests against the real StdioClientTransport child process; only meaningful on stdio.',
        tests: [stdio.transportStdioNoEmbeddedNewlines]
    },
    'transport:stdio:shutdown-escalation': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#stdio',
        behavior:
            'If the server process does not exit after stdin is closed, the client transport sends SIGTERM (and SIGKILL if still alive) after a grace period.',
        transports: ['stdio'],
        note: 'Spawn-based tests against the real StdioClientTransport child process; only meaningful on stdio.',
        tests: [stdio.transportStdioShutdownEscalation]
    },
    'transport:stdio:stderr-passthrough': {
        source: 'sdk',
        behavior: 'Server stderr is available to the client (not consumed by the transport).',
        transports: ['stdio'],
        note: 'Spawn-based tests against the real StdioClientTransport child process; only meaningful on stdio.',
        tests: [stdio.transportStdioStderrPassthrough]
    },
    'transport:stdio:default-env-safelist': {
        source: 'sdk',
        behavior:
            'StdioClientTransport spawned with no `env` option passes only DEFAULT_INHERITED_ENV_VARS (PATH, HOME, USER, …) to the child; arbitrary parent process.env entries (secrets) are not inherited. getDefaultEnvironment() is the public helper that produces this safelist.',
        transports: ['stdio'],
        note: 'Spawn-based tests against the real StdioClientTransport child process; only meaningful on stdio.',
        tests: [stdio.transportStdioDefaultEnvSafelist]
    },

    // Composite end-to-end flows

    'flow:compat:dual-transport-server': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#backwards-compatibility',
        behavior:
            'A single McpServer instance serves both a StreamableHTTPServerTransport (/mcp) and an SSEServerTransport (/sse, /messages) concurrently; clients on either transport can call the same tools.',
        transports: ['streamableHttp'],
        note: 'Deferred flows test legacy SSE; transport restriction reflects test infrastructure, not behavioral exclusion.',
        tests: [],
        deferred: 'Legacy SSE transport is deprecated in the spec. Back-compat flows that require an SSE server are deferred.'
    },
    'flow:compat:streamable-then-sse-fallback': {
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#backwards-compatibility',
        behavior:
            'When a Streamable HTTP initialize POST fails with 4xx, falling back to SSEClientTransport against the same server URL connects and tools/list succeeds.',
        transports: ['streamableHttp'],
        note: 'This is an HTTP-specific compatibility flow; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [],
        deferred: 'Legacy SSE transport is deprecated in the spec. Back-compat flows that require an SSE server are deferred.'
    },
    'flow:elicitation:multi-step-form': {
        transports: STATEFUL_TRANSPORTS,
        source: 'sdk',
        behavior:
            'A single tool handler issues sequential elicitation/create requests; an accept on step N feeds step N+1, a decline/cancel at any step short-circuits to a final result.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [flow.flowElicitationMultiStepForm]
    },
    'flow:elicitation:url-at-session-init': {
        transports: ['streamableHttp'],
        source: 'sdk',
        behavior:
            'Server issues a URL-mode elicitation over the standalone GET SSE stream immediately after onsessioninitialized (before any client request); client receives and may answer it.',
        note: 'This is an HTTP-specific flow requiring session management and a standalone GET stream; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [flow.flowElicitationUrlAtSessionInit]
    },
    'flow:elicitation:url-required-then-retry': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#url-elicitation-required-error',
        behavior:
            'tools/call returns -32042 UrlElicitationRequiredError; client opens the URL; server emits notifications/elicitation/complete; a subsequent tools/call for the same tool succeeds.',
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [flow.flowElicitationUrlRequiredThenRetry]
    },
    'flow:multi-client:stateful-isolation': {
        transports: ['streamableHttp'],
        source: 'sdk',
        behavior:
            'N independent Client instances connect to one stateful server concurrently; each receives a distinct sessionId and only the notifications produced by its own requests.',
        note: 'This is an HTTP-specific flow requiring session management; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [flow.flowMultiClientStatefulIsolation]
    },
    'flow:oauth:authorization-code-roundtrip': {
        transports: ['streamableHttp'],
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#authorization-flow-steps',
        behavior:
            'connect() against a protected server throws UnauthorizedError after redirecting; transport.finishAuth(code) exchanges the code; a second connect() succeeds and tools/list works.',
        note: 'End-to-end authorization-code journey (401 → discovery → DCR → redirect → finishAuth → authorized reconnect); the individual mechanisms are covered by the client-auth:* requirements. This exercises the HTTP hosting/auth layer and OAuth client; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [flow.flowOauthAuthorizationCodeRoundtrip]
    },
    'flow:resume:tool-call-resumption-token': {
        transports: ['streamableHttp'],
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#resumability-and-redelivery',
        behavior:
            'A tools/call issued with onresumptiontoken captures Last-Event-IDs; after a mid-stream disconnect, re-issuing with resumptionToken=<lastId> delivers only the remaining notifications and the final result.',
        note: 'Resumability requires a per-session transport with an EventStore and a standalone GET stream; stateless hosting has neither.',
        tests: [flow.flowResumeToolCallResumptionToken]
    },
    'flow:session:terminate-then-reconnect': {
        transports: ['streamableHttp'],
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management',
        behavior:
            'transport.terminateSession() clears transport.sessionId on success; a subsequent connect() on a fresh transport obtains a new sessionId and operations succeed.',
        note: 'This is an HTTP-specific flow requiring session management; the matrix transport arg is ignored, so it runs as a single streamableHttp-labelled cell to avoid duplicate runs.',
        tests: [flow.flowSessionTerminateThenReconnect]
    },
    'flow:tool-result:resource-link-follow': {
        transports: STATEFUL_TRANSPORTS,
        source: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools#resource-links',
        behavior:
            "Client follows a resource_link returned by tools/call with resources/read on the link's uri and receives the referenced contents.",
        note: 'Stateless hosting creates a fresh server per request and has no standalone GET stream, so there is no server→client channel to deliver/observe these.',
        tests: [flow.flowToolResultResourceLinkFollow]
    },
    'flow:proxy:forward-tools-resources': {
        transports: ['inMemory', 'streamableHttp'],
        source: 'sdk',
        behavior:
            "A proxy node composing a low-level Server (downstream) with a Client (upstream) forwards tools/list and resources/list; the downstream caller receives the upstream server's tool and resource lists with names, schemas, and _meta intact (mcp-proxy / mcp-remote / firebase-tools shape).",
        note: 'This is a multi-hop proxy flow that should work across transports; restricted to inMemory and streamableHttp to avoid test matrix bloat.',
        tests: [flow.flowProxyForwardToolsResources]
    }
} satisfies Record<string, Requirement>;

export type RequirementId = keyof typeof REQUIREMENTS;
