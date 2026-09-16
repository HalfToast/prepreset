import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SCHEMA_VERSION, createDefaultSettings, migrate, getMaster, listSubPresets,
    findSubPreset, getActiveSubPreset, setActiveSubPreset, createSubPreset,
    renameSubPreset, duplicateSubPreset, deleteSubPreset, updateSubPresetToggles,
} from '../src/store.js';

test('createDefaultSettings returns an empty v1 object', () => {
    const settings = createDefaultSettings();
    assert.equal(settings.version, SCHEMA_VERSION);
    assert.deepEqual(settings.masters, {});
});

test('migrate replaces junk input with defaults', () => {
    for (const junk of [undefined, null, 'nonsense', 42, []]) {
        const result = migrate(junk);
        assert.equal(result.version, SCHEMA_VERSION);
        assert.deepEqual(result.masters, {});
    }
});

test('migrate preserves valid data', () => {
    const input = {
        version: 1,
        masters: {
            'My Master': {
                activeSubId: 'a',
                subPresets: [{ id: 'a', name: 'Dark', toggles: { main: true } }],
            },
        },
    };
    const result = migrate(input);
    assert.equal(result.masters['My Master'].activeSubId, 'a');
    assert.equal(result.masters['My Master'].subPresets.length, 1);
    assert.deepEqual(result.masters['My Master'].subPresets[0].toggles, { main: true });
});

test('migrate stamps the version onto unversioned settings', () => {
    const result = migrate({ masters: {} });
    assert.equal(result.version, SCHEMA_VERSION);
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
    first.subPresets.push({ id: 'x', name: 'X', toggles: {} });
    const second = getMaster(settings, 'New Preset');
    assert.equal(second, first);
    assert.equal(second.subPresets.length, 1);
});

test('createSubPreset appends a sub-preset with a generated id', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark', { main: true, nsfw: false });
    assert.equal(typeof sub.id, 'string');
    assert.ok(sub.id.length > 0);
    assert.equal(sub.name, 'Dark');
    assert.deepEqual(sub.toggles, { main: true, nsfw: false });
    assert.deepEqual(listSubPresets(settings, 'M'), [sub]);
});

test('createSubPreset copies the toggles rather than aliasing them', () => {
    const settings = createDefaultSettings();
    const source = { main: true };
    const sub = createSubPreset(settings, 'M', 'Dark', source);
    source.main = false;
    assert.equal(sub.toggles.main, true);
});

test('createSubPreset generates distinct ids', () => {
    const settings = createDefaultSettings();
    const a = createSubPreset(settings, 'M', 'A', {});
    const b = createSubPreset(settings, 'M', 'B', {});
    assert.notEqual(a.id, b.id);
});

test('duplicate names are allowed because id is the identity', () => {
    const settings = createDefaultSettings();
    const a = createSubPreset(settings, 'M', 'Same', {});
    const b = createSubPreset(settings, 'M', 'Same', {});
    assert.notEqual(a.id, b.id);
    assert.equal(listSubPresets(settings, 'M').length, 2);
});

test('findSubPreset returns the sub-preset or null', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark', {});
    assert.equal(findSubPreset(settings, 'M', sub.id), sub);
    assert.equal(findSubPreset(settings, 'M', 'missing'), null);
});

test('setActiveSubPreset accepts a real id and rejects an unknown one', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark', {});
    assert.equal(setActiveSubPreset(settings, 'M', sub.id), sub.id);
    assert.equal(getActiveSubPreset(settings, 'M'), sub);
    assert.equal(setActiveSubPreset(settings, 'M', 'missing'), null);
    assert.equal(getActiveSubPreset(settings, 'M'), null);
});

test('setActiveSubPreset accepts null to select the master', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark', {});
    setActiveSubPreset(settings, 'M', sub.id);
    assert.equal(setActiveSubPreset(settings, 'M', null), null);
    assert.equal(getActiveSubPreset(settings, 'M'), null);
});

test('renameSubPreset renames in place and returns null for a bad id', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark', {});
    assert.equal(renameSubPreset(settings, 'M', sub.id, 'Light'), sub);
    assert.equal(sub.name, 'Light');
    assert.equal(renameSubPreset(settings, 'M', 'missing', 'X'), null);
});

test('duplicateSubPreset copies toggles into a new entry', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark', { main: true });
    const copy = duplicateSubPreset(settings, 'M', sub.id);
    assert.notEqual(copy.id, sub.id);
    assert.equal(copy.name, 'Dark (copy)');
    assert.deepEqual(copy.toggles, { main: true });
    copy.toggles.main = false;
    assert.equal(sub.toggles.main, true);
    assert.equal(listSubPresets(settings, 'M').length, 2);
});

test('duplicateSubPreset returns null for a bad id', () => {
    const settings = createDefaultSettings();
    assert.equal(duplicateSubPreset(settings, 'M', 'missing'), null);
});

test('deleteSubPreset removes the entry and reports success', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark', {});
    assert.equal(deleteSubPreset(settings, 'M', sub.id), true);
    assert.deepEqual(listSubPresets(settings, 'M'), []);
    assert.equal(deleteSubPreset(settings, 'M', sub.id), false);
});

test('deleting the active sub-preset clears activeSubId', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark', {});
    setActiveSubPreset(settings, 'M', sub.id);
    deleteSubPreset(settings, 'M', sub.id);
    assert.equal(settings.masters.M.activeSubId, null);
});

test('deleting a non-active sub-preset leaves activeSubId alone', () => {
    const settings = createDefaultSettings();
    const keep = createSubPreset(settings, 'M', 'Keep', {});
    const drop = createSubPreset(settings, 'M', 'Drop', {});
    setActiveSubPreset(settings, 'M', keep.id);
    deleteSubPreset(settings, 'M', drop.id);
    assert.equal(settings.masters.M.activeSubId, keep.id);
});

test('updateSubPresetToggles replaces the map with a copy', () => {
    const settings = createDefaultSettings();
    const sub = createSubPreset(settings, 'M', 'Dark', { main: true });
    const next = { main: false, nsfw: true };
    assert.equal(updateSubPresetToggles(settings, 'M', sub.id, next), sub);
    assert.deepEqual(sub.toggles, { main: false, nsfw: true });
    next.main = true;
    assert.equal(sub.toggles.main, false);
    assert.equal(updateSubPresetToggles(settings, 'M', 'missing', {}), null);
});
