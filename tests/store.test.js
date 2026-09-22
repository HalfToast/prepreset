import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SCHEMA_VERSION, MODES, createDefaultSettings, migrate, getMode, setMode,
    getMaster, listSubPresets, findSubPreset, getActiveSubPreset, setActiveSubPreset,
    createSubPreset, renameSubPreset, duplicateSubPreset, deleteSubPreset,
    updateSubPresetOverrides, getEnabledFields, setEnabledFields, newId,
} from '../src/store.js';

const DEFAULT_FIELDS = { toggles: true, params: [] };

test('SCHEMA_VERSION is 2', () => {
    assert.equal(SCHEMA_VERSION, 2);
});

test('createDefaultSettings returns empty v2 settings with manual mode', () => {
    const settings = createDefaultSettings();
    assert.equal(settings.version, 2);
    assert.equal(settings.mode, 'manual');
    assert.deepEqual(settings.enabledFields, DEFAULT_FIELDS);
    assert.deepEqual(settings.masters, {});
});

test('migrate preserves valid mode or defaults to manual', () => {
    assert.equal(migrate({}).mode, 'manual');
    assert.equal(migrate({ mode: 'autobound', masters: {} }).mode, 'autobound');
    assert.equal(migrate({ mode: 'invalid', masters: {} }).mode, 'manual');
});

test('getMode and setMode manage mode cleanly', () => {
    const settings = createDefaultSettings();
    assert.equal(getMode(settings), 'manual');
    setMode(settings, 'autobound');
    assert.equal(getMode(settings), 'autobound');
    setMode(settings, 'invalid_mode');
    assert.equal(getMode(settings), 'manual');
});

test('migrate replaces junk input with defaults', () => {
    for (const junk of [undefined, null, 'nonsense', 42, []]) {
        assert.deepEqual(migrate(junk), createDefaultSettings());
    }
});

test('migrate upgrades v1 settings', () => {
    const result = migrate({
        version: 1,
        masters: {
            'My Master': {
                activeSubId: 'a',
                subPresets: [{ id: 'a', name: 'Dark', toggles: { main: true, nsfw: false } }],
            },
        },
    });
    assert.equal(result.version, 2);
    assert.deepEqual(result.enabledFields, DEFAULT_FIELDS);
    assert.equal(result.masters['My Master'].activeSubId, 'a');
    assert.deepEqual(result.masters['My Master'].subPresets, [
        { id: 'a', name: 'Dark', params: {}, toggles: { main: true, nsfw: false } },
    ]);
});

test('migrate stamps the version onto unversioned settings', () => {
    assert.equal(migrate({ masters: {} }).version, 2);
});

test('migrate passes v2 data through', () => {
    const input = {
        version: 2,
        mode: 'manual',
        enabledFields: { toggles: false, params: ['temperature', 'openai_max_context'] },
        masters: {
            M: {
                activeSubId: 'a',
                subPresets: [{ id: 'a', name: 'A', params: { temperature: 0.7 }, toggles: { nsfw: true } }],
            },
        },
    };
    assert.deepEqual(migrate(input), input);
});

test('migrate copies params rather than aliasing them', () => {
    const input = {
        version: 2,
        masters: { M: { activeSubId: null, subPresets: [{ id: 'a', name: 'A', params: { nested: { x: 1 } }, toggles: {} }] } },
    };
    const result = migrate(input);
    input.masters.M.subPresets[0].params.nested.x = 2;
    assert.equal(result.masters.M.subPresets[0].params.nested.x, 1);
});

test('migrate coerces a non-object params map to empty', () => {
    const result = migrate({
        version: 2,
        masters: { M: { activeSubId: null, subPresets: [{ id: 'a', name: 'A', params: 'nope', toggles: {} }] } },
    });
    assert.deepEqual(result.masters.M.subPresets[0].params, {});
});

test('migrate sanitises enabledFields', () => {
    assert.deepEqual(migrate({ masters: {}, enabledFields: 'junk' }).enabledFields, DEFAULT_FIELDS);
    assert.deepEqual(
        migrate({ masters: {}, enabledFields: { toggles: 'yes', params: 'temperature' } }).enabledFields,
        DEFAULT_FIELDS,
    );
    assert.deepEqual(
        migrate({ masters: {}, enabledFields: { toggles: false, params: ['top_p', 7, '', 'top_p', 'future_key'] } }).enabledFields,
        { toggles: false, params: ['top_p', 'future_key'] },
    );
});

test('migrate drops malformed sub-presets', () => {
    const result = migrate({
        masters: {
            M: {
                activeSubId: null,
                subPresets: [
                    { id: 'good', name: 'Keep', toggles: {} },
                    { id: 'no-toggles', name: 'Drop' },
                    { name: 'No id', toggles: {} },
                    null,
                    'garbage',
                ],
            },
        },
    });
    assert.deepEqual(result.masters.M.subPresets.map(s => s.id), ['good']);
});

test('migrate clears an activeSubId that points at nothing', () => {
    const result = migrate({
        masters: { M: { activeSubId: 'gone', subPresets: [{ id: 'a', name: 'A', toggles: {} }] } },
    });
    assert.equal(result.masters.M.activeSubId, null);
});

test('migrate drops a master whose value is not an object', () => {
    const result = migrate({ masters: { Bad: 'nope', Good: { activeSubId: null, subPresets: [] } } });
    assert.deepEqual(Object.keys(result.masters), ['Good']);
});

test('getMaster creates a master entry lazily and returns the same object', () => {
    const settings = createDefaultSettings();
    const first = getMaster(settings, 'New Preset');
    assert.deepEqual(first, { activeSubId: null, subPresets: [] });
    first.subPresets.push({ id: 'x', name: 'X', params: {}, toggles: {} });
    const second = getMaster(settings, 'New Preset');
    assert.equal(second, first);
    assert.equal(second.subPresets.length, 1);
});

test('createSubPreset stores both override maps under a generated id', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark', { params: { temperature: 0.7 }, toggles: { nsfw: true } });
    assert.equal(typeof sub.id, 'string');
    assert.ok(sub.id.length > 0);
    assert.equal(sub.name, 'Dark');
    assert.deepEqual(sub.params, { temperature: 0.7 });
    assert.deepEqual(sub.toggles, { nsfw: true });
    assert.deepEqual(listSubPresets(settings, 'M'), [sub]);
});

test('createSubPreset without overrides stores empty maps', () => {
    const sub = createSubPreset(createDefaultSettings(), 'M', 'Blank');
    assert.deepEqual(sub.params, {});
    assert.deepEqual(sub.toggles, {});
});

test('createSubPreset copies both maps rather than aliasing them', () => {
    const settings = createDefaultSettings();
    const params = { temperature: 0.7, nested: { x: 1 } };
    const toggles = { main: true };
    const sub = createSubPreset(settings, 'M', 'Dark', { params, toggles });
    params.temperature = 1;
    params.nested.x = 2;
    toggles.main = false;
    assert.equal(sub.params.temperature, 0.7);
    assert.equal(sub.params.nested.x, 1);
    assert.equal(sub.toggles.main, true);
});

test('createSubPreset drops undefined parameter values', () => {
    const sub = createSubPreset(createDefaultSettings(), 'M', 'A', { params: { temperature: undefined, top_p: 0.9 } });
    assert.deepEqual(sub.params, { top_p: 0.9 });
});

test('createSubPreset generates distinct ids', () => {
    const settings = createDefaultSettings();
    const a = createSubPreset(settings, 'M', 'A');
    const b = createSubPreset(settings, 'M', 'B');
    assert.notEqual(a.id, b.id);
});

test('duplicate names are allowed because id is the identity', () => {
    const settings = createDefaultSettings();
    const a = createSubPreset(settings, 'M', 'Same');
    const b = createSubPreset(settings, 'M', 'Same');
    assert.notEqual(a.id, b.id);
    assert.equal(listSubPresets(settings, 'M').length, 2);
});

test('findSubPreset returns the sub-preset or null', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark');
    assert.equal(findSubPreset(settings, 'M', sub.id), sub);
    assert.equal(findSubPreset(settings, 'M', 'missing'), null);
});

test('setActiveSubPreset accepts a real id and rejects an unknown one', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark');
    assert.equal(setActiveSubPreset(settings, 'M', sub.id), sub.id);
    assert.equal(getActiveSubPreset(settings, 'M'), sub);
    assert.equal(setActiveSubPreset(settings, 'M', 'missing'), null);
    assert.equal(getActiveSubPreset(settings, 'M'), null);
});

test('setActiveSubPreset accepts null to select the master', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark');
    setActiveSubPreset(settings, 'M', sub.id);
    assert.equal(setActiveSubPreset(settings, 'M', null), null);
    assert.equal(getActiveSubPreset(settings, 'M'), null);
});

test('renameSubPreset renames in place and returns null for a bad id', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark');
    assert.equal(renameSubPreset(settings, 'M', sub.id, 'Light'), sub);
    assert.equal(sub.name, 'Light');
    assert.equal(renameSubPreset(settings, 'M', 'missing', 'X'), null);
});

test('duplicateSubPreset copies both maps', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark', { params: { temperature: 0.7 }, toggles: { main: true } });
    const copy = duplicateSubPreset(settings, 'M', sub.id);
    assert.notEqual(copy.id, sub.id);
    assert.equal(copy.name, 'Dark (copy)');
    assert.deepEqual(copy.params, { temperature: 0.7 });
    assert.deepEqual(copy.toggles, { main: true });
    copy.params.temperature = 1;
    copy.toggles.main = false;
    assert.equal(sub.params.temperature, 0.7);
    assert.equal(sub.toggles.main, true);
    assert.equal(listSubPresets(settings, 'M').length, 2);
});

test('duplicateSubPreset returns null for a bad id', () => {
    assert.equal(duplicateSubPreset(createDefaultSettings(), 'M', 'missing'), null);
});

test('deleteSubPreset removes the entry and reports success', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark');
    assert.equal(deleteSubPreset(settings, 'M', sub.id), true);
    assert.deepEqual(listSubPresets(settings, 'M'), []);
    assert.equal(deleteSubPreset(settings, 'M', sub.id), false);
});

test('deleting the active sub-preset clears activeSubId', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark');
    setActiveSubPreset(settings, 'M', sub.id);
    deleteSubPreset(settings, 'M', sub.id);
    assert.equal(settings.masters.M.activeSubId, null);
});

test('deleting a non-active sub-preset leaves activeSubId alone', () => {
    const settings = createDefaultSettings();
    const keep = createSubPreset(settings, 'M', 'Keep');
    const drop = createSubPreset(settings, 'M', 'Drop');
    setActiveSubPreset(settings, 'M', keep.id);
    deleteSubPreset(settings, 'M', drop.id);
    assert.equal(settings.masters.M.activeSubId, keep.id);
});

test('updateSubPresetOverrides replaces both maps with copies', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark', { params: { temperature: 0.7 }, toggles: { main: true } });
    const next = { params: { top_p: 0.5 }, toggles: { nsfw: true } };
    assert.equal(updateSubPresetOverrides(settings, 'M', sub.id, next), sub);
    assert.deepEqual(sub.params, { top_p: 0.5 });
    assert.deepEqual(sub.toggles, { nsfw: true });
    next.params.top_p = 1;
    next.toggles.nsfw = false;
    assert.equal(sub.params.top_p, 0.5);
    assert.equal(sub.toggles.nsfw, true);
    assert.equal(updateSubPresetOverrides(settings, 'M', 'missing', {}), null);
});

test('getEnabledFields creates defaults when missing', () => {
    const settings = { version: 2, masters: {} };
    const fields = getEnabledFields(settings);
    assert.deepEqual(fields, DEFAULT_FIELDS);
    assert.equal(getEnabledFields(settings), fields);
});

test('setEnabledFields stores a sanitised copy', () => {
    const settings = createDefaultSettings();
    const input = { toggles: false, params: ['temperature', 3, 'temperature'] };
    const stored = setEnabledFields(settings, input);
    assert.deepEqual(stored, { toggles: false, params: ['temperature'] });
    assert.equal(getEnabledFields(settings), stored);
    input.params.push('top_p');
    assert.deepEqual(getEnabledFields(settings).params, ['temperature']);
});

// globalThis.crypto is an accessor in Node, so defineProperty is the only way
// to stub it.
function withoutRandomUUID(run) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    try {
        run();
    } finally {
        Object.defineProperty(globalThis, 'crypto', original);
    }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('newId works when crypto.randomUUID is unavailable', () => {
    withoutRandomUUID(() => {
        assert.equal(typeof crypto.randomUUID, 'undefined');
        assert.match(newId(), UUID_V4);
        assert.notEqual(newId(), newId());
    });
});

// Shape alone proves nothing here: real randomUUID output matches UUID_V4 too.
test('newId falls back to Math.random, not a still-present randomUUID', () => {
    const realRandom = Math.random;
    withoutRandomUUID(() => {
        try {
            Math.random = () => 0;
            assert.equal(newId(), '00000000-0000-4000-8000-000000000000');
            Math.random = () => 0.9999999999;
            assert.equal(newId(), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
        } finally {
            Math.random = realRandom;
        }
    });
});

test('newId uses crypto.randomUUID when it is available', () => {
    assert.equal(typeof crypto.randomUUID, 'function');
    assert.match(newId(), UUID_V4);
    assert.notEqual(newId(), newId());
});

test('createSubPreset still assigns distinct ids without crypto.randomUUID', () => {
    withoutRandomUUID(() => {
        const settings = createDefaultSettings();
        const a = createSubPreset(settings, 'M', 'A', { toggles: { main: true } });
        const b = createSubPreset(settings, 'M', 'B', { toggles: { main: false } });
        assert.match(a.id, UUID_V4);
        assert.notEqual(a.id, b.id);
        assert.equal(listSubPresets(settings, 'M').length, 2);
        assert.deepEqual(a.toggles, { main: true });
        assert.deepEqual(b.toggles, { main: false });
    });
});
