import { expect, test } from 'vitest';

import { REQUIREMENTS } from './requirements.js';

test('every non-deferred requirement has at least one test', () => {
    const missing = Object.entries(REQUIREMENTS)
        .filter(([, r]) => !r.deferred && r.tests.length === 0)
        .map(([id]) => id);
    expect(missing).toEqual([]);
});

test('every knownFailure references a test in tests[]', () => {
    const bad: string[] = [];
    for (const [id, r] of Object.entries(REQUIREMENTS)) {
        for (const kf of r.knownFailures ?? []) {
            if (!r.tests.includes(kf.test)) bad.push(`${id}: knownFailure references test not in tests[]`);
        }
    }
    expect(bad).toEqual([]);
});

test('every transport-restricted requirement explains why in note', () => {
    const missing = Object.entries(REQUIREMENTS)
        .filter(([, r]) => r.transports !== undefined && !r.note)
        .map(([id]) => id);
    expect(missing).toEqual([]);
});

test('every supersedes reference points at an existing requirement id', () => {
    for (const [id, req] of Object.entries(REQUIREMENTS)) {
        if (req.supersedes !== undefined) {
            expect(REQUIREMENTS[req.supersedes], `${id} supersedes unknown id '${req.supersedes}'`).toBeDefined();
        }
    }
});
