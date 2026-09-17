import test from 'node:test';
import assert from 'node:assert/strict';
import {
    valuesEqual, effectiveParams, diffParams, mergeParams,
    effectiveToggles, diffToggles, mergeToggles, paramsDirty, togglesDirty, releasedOverrides,
} from '../src/overlay.js';

test('valuesEqual compares primitives strictly', () => {
    assert.equal(valuesEqual(0.7, 0.7), true);
    assert.equal(valuesEqual(0.7, 0.8), false);
    assert.equal(valuesEqual('0.7', 0.7), false);
    assert.equal(valuesEqual(true, 1), false);
    assert.equal(valuesEqual(null, null), true);
    assert.equal(valuesEqual(null, undefined), false);
    assert.equal(valuesEqual('', 0), false);
});

test('valuesEqual treats NaN as equal to NaN', () => {
    assert.equal(valuesEqual(NaN, NaN), true);
    assert.equal(valuesEqual(NaN, 0), false);
});

test('valuesEqual compares arrays and objects structurally', () => {
    assert.equal(valuesEqual([1, 2], [1, 2]), true);
    assert.equal(valuesEqual([1, 2], [2, 1]), false);
    assert.equal(valuesEqual({ a: 1, b: [2] }, { b: [2], a: 1 }), true);
    assert.equal(valuesEqual({ a: 1 }, { a: 1, b: 2 }), false);
    assert.equal(valuesEqual([1], { 0: 1 }), false);
    assert.equal(valuesEqual({ a: null }, { a: undefined }), false);
});

test('effectiveParams prefers the override, else the master', () => {
    const result = effectiveParams(
        { temperature: 1, top_p: 0.9 },
        { temperature: 0.7 },
        ['temperature', 'top_p'],
    );
    assert.deepEqual(result, { temperature: 0.7, top_p: 0.9 });
});

test('effectiveParams covers only enabled keys', () => {
    const result = effectiveParams(
        { temperature: 1, top_p: 0.9 },
        { temperature: 0.7, top_p: 0.5 },
        ['top_p'],
    );
    assert.deepEqual(result, { top_p: 0.5 });
});

test('effectiveParams omits a key neither side defines', () => {
    const result = effectiveParams({ temperature: 1 }, {}, ['temperature', 'seed']);
    assert.deepEqual(result, { temperature: 1 });
    assert.equal(Object.hasOwn(result, 'seed'), false);
});

test('effectiveParams uses an override even when the master lacks the key', () => {
    assert.deepEqual(effectiveParams({}, { seed: 42 }, ['seed']), { seed: 42 });
});

test('diffParams stores only enabled keys that differ from the master', () => {
    const result = diffParams(
        { temperature: 0.7, top_p: 0.9, min_p: 0.1 },
        { temperature: 1, top_p: 0.9, min_p: 0 },
        ['temperature', 'top_p'],
    );
    assert.deepEqual(result, { temperature: 0.7 });
});

test('diffParams never stores a key the master does not define', () => {
    const result = diffParams({ seed: 42 }, {}, ['seed']);
    assert.deepEqual(result, {});
});

test('diffParams ignores a key missing from the live values', () => {
    const result = diffParams({}, { temperature: 1 }, ['temperature']);
    assert.deepEqual(result, {});
});

test('mergeParams keeps disabled overrides and replaces enabled ones', () => {
    const result = mergeParams(
        { temperature: 0.9, top_p: 0.5 },
        { temperature: 0.7 },
        ['temperature'],
    );
    assert.deepEqual(result, { top_p: 0.5, temperature: 0.7 });
});

test('mergeParams drops an enabled override that now matches the master', () => {
    const result = mergeParams({ temperature: 0.9 }, {}, ['temperature']);
    assert.deepEqual(result, {});
});

test('mergeParams keeps unknown stored keys', () => {
    const result = mergeParams({ future_key: 3 }, { temperature: 0.7 }, ['temperature']);
    assert.deepEqual(result, { future_key: 3, temperature: 0.7 });
});

test('effectiveToggles lays overrides over the master', () => {
    const result = effectiveToggles({ main: true, nsfw: false }, { nsfw: true });
    assert.deepEqual(result, { main: true, nsfw: true });
});

test('diffToggles keeps only changed prompts the master has', () => {
    const result = diffToggles(
        { main: true, nsfw: true, jb: false, brand_new: true },
        { main: true, nsfw: false, jb: false },
    );
    assert.deepEqual(result, { nsfw: true });
});

test('diffToggles compares truthiness, not strict equality', () => {
    assert.deepEqual(diffToggles({ main: 1 }, { main: true }), {});
    assert.deepEqual(diffToggles({ main: 0 }, { main: true }), { main: false });
});

test('mergeToggles keeps stored toggles for prompts not on screen', () => {
    const result = mergeToggles(
        { gone: true, main: false },
        { nsfw: true },
        { main: true, nsfw: true },
    );
    assert.deepEqual(result, { gone: true, nsfw: true });
});

test('paramsDirty spots a changed enabled key', () => {
    assert.equal(paramsDirty({ temperature: 0.7 }, { temperature: 1 }, ['temperature']), true);
    assert.equal(paramsDirty({ temperature: 1 }, { temperature: 1 }, ['temperature']), false);
});

test('paramsDirty ignores keys that are not enabled', () => {
    assert.equal(paramsDirty({ temperature: 0.7 }, { temperature: 1 }, []), false);
});

test('paramsDirty ignores keys with no effective value', () => {
    assert.equal(paramsDirty({ seed: 42 }, {}, ['seed']), false);
});

test('togglesDirty compares only prompts on screen', () => {
    assert.equal(togglesDirty({ main: true }, { main: true, deleted: false }), false);
    assert.equal(togglesDirty({ main: false }, { main: true }), true);
});

test('togglesDirty ignores prompts the effective map lacks', () => {
    assert.equal(togglesDirty({ main: true, brand_new: false }, { main: true }), false);
});

test('none of the functions mutate their inputs', () => {
    const master = { temperature: 1, top_p: 0.9 };
    const stored = { temperature: 0.9, top_p: 0.5 };
    const live = { temperature: 0.7, top_p: 0.9 };
    const toggles = { main: true };
    const snapshot = JSON.stringify([master, stored, live, toggles]);
    effectiveParams(master, stored, ['temperature']);
    diffParams(live, master, ['temperature']);
    mergeParams(stored, { temperature: 0.7 }, ['temperature']);
    effectiveToggles(toggles, { main: false });
    diffToggles(toggles, { main: false });
    mergeToggles(toggles, { main: false }, toggles);
    assert.equal(JSON.stringify([master, stored, live, toggles]), snapshot);
});

test('functions tolerate missing maps', () => {
    assert.deepEqual(effectiveParams(null, undefined, ['temperature']), {});
    assert.deepEqual(diffParams(undefined, null, ['temperature']), {});
    assert.deepEqual(mergeParams(null, null, []), {});
    assert.deepEqual(effectiveToggles(null, undefined), {});
    assert.deepEqual(diffToggles(undefined, null), {});
    assert.deepEqual(mergeToggles(null, null, null), {});
    assert.equal(paramsDirty(null, null, ['temperature']), false);
    assert.equal(togglesDirty(null, undefined), false);
});

// Save, re-apply, and nothing should show as unsaved. These mimic how
// index.js applies values.
function applyEffectiveParams(live, effective) {
    return { ...live, ...effective };
}

function applyEffectiveToggles(live, effective) {
    const result = {};
    for (const [id, enabled] of Object.entries(live)) {
        result[id] = Object.hasOwn(effective, id) ? !!effective[id] : enabled;
    }
    return result;
}

test('params are clean after save and re-apply', () => {
    const keys = ['temperature', 'top_p', 'seed'];
    const master = { temperature: 1, top_p: 0.9 };
    const stored = { top_p: 0.5, future_key: 3 };
    let live = { temperature: 0.7, top_p: 0.9, seed: 42 };

    const saved = mergeParams(stored, diffParams(live, master, keys), keys);
    assert.deepEqual(saved, { future_key: 3, temperature: 0.7 });

    const effective = effectiveParams(master, saved, keys);
    live = applyEffectiveParams(live, effective);
    assert.equal(paramsDirty(live, effective, keys), false);
});

test('toggles are clean after save and re-apply', () => {
    const master = { main: true, nsfw: false, jb: true };
    const stored = { gone: true, jb: false };
    let live = { main: false, nsfw: false, jb: true, brand_new: true };

    const saved = mergeToggles(stored, diffToggles(live, master), live);
    assert.deepEqual(saved, { gone: true, main: false });

    const effective = effectiveToggles(master, saved);
    live = applyEffectiveToggles(live, effective);
    assert.equal(togglesDirty(live, effective), false);
});

test('saving again right after a save changes nothing', () => {
    const keys = ['temperature', 'top_p'];
    const master = { temperature: 1, top_p: 0.9 };
    const live = { temperature: 0.7, top_p: 0.9 };

    const first = mergeParams({}, diffParams(live, master, keys), keys);
    const applied = applyEffectiveParams(live, effectiveParams(master, first, keys));
    const second = mergeParams(first, diffParams(applied, master, keys), keys);
    assert.deepEqual(second, first);
});

test('releasedOverrides releases a disabled key the sub-preset overrides', () => {
    const result = releasedOverrides(
        { toggles: true, params: ['temperature', 'top_p'] },
        { toggles: true, params: ['top_p'] },
        { params: { temperature: 0.7, top_p: 0.5 }, toggles: {} },
    );
    assert.deepEqual(result, { paramKeys: ['temperature'], toggleIds: [] });
});

test('releasedOverrides skips disabled keys with no override', () => {
    const result = releasedOverrides(
        { toggles: true, params: ['temperature'] },
        { toggles: true, params: [] },
        { params: {}, toggles: {} },
    );
    assert.deepEqual(result.paramKeys, []);
});

test('releasedOverrides skips keys that are still or newly enabled', () => {
    const result = releasedOverrides(
        { toggles: true, params: ['top_p'] },
        { toggles: true, params: ['top_p', 'temperature'] },
        { params: { top_p: 0.5, temperature: 0.7 }, toggles: {} },
    );
    assert.deepEqual(result.paramKeys, []);
});

test('releasedOverrides releases all toggles when toggles are switched off', () => {
    const result = releasedOverrides(
        { toggles: true, params: [] },
        { toggles: false, params: [] },
        { params: {}, toggles: { nsfw: true, jb: false } },
    );
    assert.deepEqual(result.toggleIds, ['nsfw', 'jb']);
});

test('releasedOverrides releases no toggles while prompt toggles stay on', () => {
    const result = releasedOverrides(
        { toggles: true, params: [] },
        { toggles: true, params: [] },
        { params: {}, toggles: { nsfw: true } },
    );
    assert.deepEqual(result.toggleIds, []);
});

test('releasedOverrides releases no toggles when prompt toggles were already off', () => {
    const result = releasedOverrides(
        { toggles: false, params: [] },
        { toggles: false, params: [] },
        { params: {}, toggles: { nsfw: true } },
    );
    assert.deepEqual(result.toggleIds, []);
});

test('releasedOverrides tolerates missing inputs', () => {
    assert.deepEqual(releasedOverrides(null, undefined, null), { paramKeys: [], toggleIds: [] });
});
