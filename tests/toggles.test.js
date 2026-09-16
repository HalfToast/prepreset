import test from 'node:test';
import assert from 'node:assert/strict';
import { findOrderEntry, readToggles, applyToggles, togglesEqual } from '../src/toggles.js';

/** The shape a real SillyTavern preset file has. */
function samplePromptOrder() {
    return [
        { character_id: 100001, order: [
            { identifier: 'main', enabled: true },
            { identifier: 'nsfw', enabled: false },
            { identifier: 'jailbreak', enabled: true },
        ] },
    ];
}

test('findOrderEntry matches the dummy id', () => {
    const entry = findOrderEntry(samplePromptOrder(), 100001);
    assert.equal(entry.order.length, 3);
});

test('findOrderEntry compares ids as strings', () => {
    assert.ok(findOrderEntry([{ character_id: '100001', order: [] }], 100001));
    assert.ok(findOrderEntry([{ character_id: 100001, order: [] }], '100001'));
});

test('findOrderEntry returns null when nothing matches or input is not an array', () => {
    assert.equal(findOrderEntry(samplePromptOrder(), 999), null);
    assert.equal(findOrderEntry(undefined, 100001), null);
    assert.equal(findOrderEntry(null, 100001), null);
    assert.equal(findOrderEntry([null, undefined], 100001), null);
});

test('readToggles maps identifiers to booleans', () => {
    const toggles = readToggles(samplePromptOrder()[0].order);
    assert.deepEqual(toggles, { main: true, nsfw: false, jailbreak: true });
});

test('readToggles coerces truthiness and skips malformed entries', () => {
    const toggles = readToggles([
        { identifier: 'a', enabled: 1 },
        { identifier: 'b' },
        { enabled: true },
        null,
        'garbage',
    ]);
    assert.deepEqual(toggles, { a: true, b: false });
});

test('readToggles returns an empty map for non-array input', () => {
    assert.deepEqual(readToggles(undefined), {});
    assert.deepEqual(readToggles(null), {});
});

test('applyToggles updates only the identifiers present in the map', () => {
    const order = samplePromptOrder()[0].order;
    const result = applyToggles(order, { main: false, nsfw: true });
    assert.deepEqual(result, [
        { identifier: 'main', enabled: false },
        { identifier: 'nsfw', enabled: true },
        { identifier: 'jailbreak', enabled: true },
    ]);
});

test('applyToggles leaves identifiers absent from the map untouched', () => {
    const order = samplePromptOrder()[0].order;
    const result = applyToggles(order, { main: false });
    assert.equal(result[1].enabled, false);
    assert.equal(result[2].enabled, true);
});

test('applyToggles ignores toggles for identifiers not in the order', () => {
    const order = samplePromptOrder()[0].order;
    const result = applyToggles(order, { deleted_prompt: true });
    assert.equal(result.length, 3);
    assert.equal(result.some(e => e.identifier === 'deleted_prompt'), false);
});

test('applyToggles preserves order and entry count', () => {
    const order = samplePromptOrder()[0].order;
    const result = applyToggles(order, { jailbreak: false });
    assert.deepEqual(result.map(e => e.identifier), ['main', 'nsfw', 'jailbreak']);
});

test('applyToggles does not mutate its input', () => {
    const order = samplePromptOrder()[0].order;
    const before = JSON.parse(JSON.stringify(order));
    applyToggles(order, { main: false, nsfw: true });
    assert.deepEqual(order, before);
});

test('applyToggles preserves unknown fields on an entry', () => {
    const result = applyToggles([{ identifier: 'main', enabled: true, extra: 'keep' }], { main: false });
    assert.deepEqual(result[0], { identifier: 'main', enabled: false, extra: 'keep' });
});

test('applyToggles tolerates a missing toggle map and non-array order', () => {
    assert.deepEqual(applyToggles(samplePromptOrder()[0].order, undefined).length, 3);
    assert.deepEqual(applyToggles(undefined, {}), []);
});

test('togglesEqual compares key sets and values', () => {
    assert.equal(togglesEqual({ a: true, b: false }, { b: false, a: true }), true);
    assert.equal(togglesEqual({ a: true }, { a: false }), false);
    assert.equal(togglesEqual({ a: true }, { a: true, b: true }), false);
    assert.equal(togglesEqual({ a: true, b: true }, { a: true }), false);
    assert.equal(togglesEqual({}, {}), true);
    assert.equal(togglesEqual(undefined, {}), true);
    assert.equal(togglesEqual({ a: 1 }, { a: true }), true);
});
