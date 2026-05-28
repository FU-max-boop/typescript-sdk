/**
 * The matrix runner.
 *
 * Iterates `REQUIREMENTS`, registering each linked test against each
 * applicable (transport, protocolVersion) pair. This is the single point that
 * turns the manifest into an executable suite — `requirements.ts` is the
 * registry, this file is the dispatcher.
 *
 * For each (requirement, test, transport, version) cell, registration is one of:
 *                 requirement on this cell (xfail — passes when it fails as
 *                 documented, fails when the SDK is fixed → remove the entry)
 *  - `test`       otherwise
 *
 * To run a subset: `npx vitest run test/e2e/matrix.test.ts -t 'tools:'`
 */

import { describe, test } from 'vitest';

import { REQUIREMENTS } from './requirements.js';
import { ALL_SPEC_VERSIONS, ALL_TRANSPORTS, type TestArgs } from './types.js';

for (const [id, req] of Object.entries(REQUIREMENTS)) {
    // Deferred entries are documentation-only; coverage.test.ts enforces that
    // every non-deferred requirement links at least one test.
    if (req.deferred || req.tests.length === 0) continue;

    const transports = req.transports ?? ALL_TRANSPORTS;
    const versions = ALL_SPEC_VERSIONS.filter(
        v =>
            (req.addedInSpecVersion === undefined || v >= req.addedInSpecVersion) &&
            (req.removedInSpecVersion === undefined || v < req.removedInSpecVersion)
    );

    // One describe per (transport, version) so the cell shows up as `<id> [<transport> <version>]`.
    const cells = versions.flatMap(v => transports.map(t => [t, v] as const));

    describe.each(cells)(`${id} [%s %s]`, (transport, protocolVersion) => {
        const args: TestArgs = { transport, protocolVersion };

        for (const fn of req.tests) {
            const kf = req.knownFailures?.find(
                k =>
                    k.test === fn &&
                    (k.transport === undefined || k.transport === transport) &&
                    (k.specVersion === undefined || k.specVersion === protocolVersion)
            );

            const run = kf ? test.fails : test;
            run(fn.name, () => fn(args), 15_000);
        }
    });
}
