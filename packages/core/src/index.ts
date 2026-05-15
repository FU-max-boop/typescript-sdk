export * from './auth/errors';
export * from './errors/sdkErrors';
export * from './shared/auth';
export * from './shared/authUtils';
export * from './shared/metadataUtils';
export * from './shared/protocol';
export * from './shared/responseMessage';
export * from './shared/stdio';
export type { RequestTaskStore, TaskContext, TaskManagerOptions, TaskRequestOptions } from './shared/taskManager';
export { extractTaskManagerOptions, NullTaskManager, TaskManager } from './shared/taskManager';
export * from './shared/toolNameValidation';
export * from './shared/transport';
export * from './shared/uriTemplate';
export * from './types/index';
export * from './util/inMemory';
export * from './util/schema';
export * from './util/standardSchema';
export * from './util/zodCompat';

// experimental exports
export * from './experimental/index';
export * from './validators/ajvProvider';
// cfWorkerProvider is intentionally NOT re-exported here: it statically imports
// `@cfworker/json-schema` (an optional peer), and bundling it into the main barrel
// would force that import on all Node consumers. Import via `@modelcontextprotocol/core/validators/cfWorker`
// (used by the workerd/browser `_shims` and the public `/validators/cf-worker` subpaths).
export type { CfWorkerSchemaDraft } from './validators/cfWorkerProvider';
export * from './validators/fromJsonSchema';
/**
 * JSON Schema validation
 *
 * This module provides configurable JSON Schema validation for the MCP SDK.
 * Choose a validator based on your runtime environment:
 *
 * - {@linkcode AjvJsonSchemaValidator}: Best for Node.js (default, fastest)
 *   Bundled — no additional dependencies required.
 *
 * - `CfWorkerJsonSchemaValidator`: Best for edge runtimes
 *   Import from: `@modelcontextprotocol/server/validators/cf-worker` or `@modelcontextprotocol/client/validators/cf-worker`
 *   Bundled — no additional dependencies required.
 *
 * @example For Node.js with AJV
 * ```ts source="./index.examples.ts#validation_ajv"
 * const validator = new AjvJsonSchemaValidator();
 * ```
 *
 * @example For Cloudflare Workers
 * ```ts source="./index.examples.ts#validation_cfWorker"
 * const validator = new CfWorkerJsonSchemaValidator();
 * ```
 *
 * @module validation
 */

// Core types only - implementations are exported via separate entry points
export type { JsonSchemaType, JsonSchemaValidator, jsonSchemaValidator, JsonSchemaValidatorResult } from './validators/types';
