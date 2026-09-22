import test from 'node:test';
import assert from 'node:assert/strict';
import {
    countOverrides, formatIndicatorText, resolveEffectiveChatValues,
    initAutobound, handleChatChanged, handleLiveValuesEdited,
    getIsApplying, setIsApplying,
} from '../src/autobound.js';

test('countOverrides counts toggles and params differing from master', () => {
    assert.equal(countOverrides(null), 0);
    assert.equal(countOverrides({}), 0);
    assert.equal(countOverrides({ toggles: { a: true, b: false }, params: { temp: 0.7 } }), 3);
    assert.equal(countOverrides({ toggles: { a: true }, params: {} }), 1);
});

test('formatIndicatorText handles zero and non-zero overrides', () => {
    const zero = formatIndicatorText('Default', 0);
    assert.equal(zero.toastText, 'Applied preset: <b>Default</b>');
    assert.equal(zero.badgeText, 'Default');

    const single = formatIndicatorText('Story', 1);
    assert.equal(single.toastText, 'Applied preset: <b>Story</b> (1 override)');
    assert.equal(single.badgeText, 'Story (1)');

    const multiple = formatIndicatorText('Story', 3);
    assert.equal(multiple.toastText, 'Applied preset: <b>Story</b> (3 overrides)');
    assert.equal(multiple.badgeText, 'Story (3)');
});

test('resolveEffectiveChatValues overlays chat diff onto master values', () => {
    const master = { params: { temperature: 1.0, top_p: 0.9 }, toggles: { prompt1: true, prompt2: false } };
    const chatDiff = { params: { temperature: 0.7 }, toggles: { prompt2: true } };
    const effective = resolveEffectiveChatValues(master, chatDiff, ['temperature', 'top_p']);

    assert.equal(effective.params.temperature, 0.7);
    assert.equal(effective.params.top_p, 0.9);
    assert.equal(effective.toggles.prompt1, true);
    assert.equal(effective.toggles.prompt2, true);
});

test('resolveEffectiveChatValues handles missing or empty chat diff', () => {
    const master = { params: { temperature: 1.0 }, toggles: { p: true } };
    const effectiveNull = resolveEffectiveChatValues(master, null, ['temperature']);
    assert.deepEqual(effectiveNull.params, { temperature: 1.0 });
    assert.deepEqual(effectiveNull.toggles, { p: true });

    const effectiveEmpty = resolveEffectiveChatValues(master, {}, ['temperature']);
    assert.deepEqual(effectiveEmpty.params, { temperature: 1.0 });
    assert.deepEqual(effectiveEmpty.toggles, { p: true });
});

test('handleChatChanged no-ops when mode is manual or no active chat', async () => {
    let applied = false;
    initAutobound({
        getMode: () => 'manual',
        getCurrentChatId: () => 'chat-1',
        applyValuesToLive: () => { applied = true; },
    });
    await handleChatChanged();
    assert.equal(applied, false);

    initAutobound({
        getMode: () => 'autobound',
        getCurrentChatId: () => null,
        applyValuesToLive: () => { applied = true; },
    });
    await handleChatChanged();
    assert.equal(applied, false);
});

test('handleChatChanged switches master and applies chat overrides', async () => {
    let selectedMaster = null;
    let appliedValues = null;
    let toast = null;
    const chatMetadata = {
        prepreset: {
            master: 'Creative',
            params: { temperature: 0.8 },
            toggles: { main: false },
        },
    };

    initAutobound({
        getMode: () => 'autobound',
        getCurrentChatId: () => 'chat-123',
        getChatMetadata: () => chatMetadata,
        getMasterName: () => (selectedMaster || 'Default'),
        selectMasterPreset: async (name) => {
            selectedMaster = name;
            return true;
        },
        readMasterValues: () => ({
            params: { temperature: 1.0, top_p: 0.9 },
            toggles: { main: true, nsfw: true },
        }),
        enabledParamKeys: () => ['temperature', 'top_p'],
        applyValuesToLive: (val) => { appliedValues = val; return true; },
        toastInfo: (text) => { toast = text; },
    });

    await handleChatChanged();

    assert.equal(selectedMaster, 'Creative');
    assert.equal(appliedValues.params.temperature, 0.8);
    assert.equal(appliedValues.params.top_p, 0.9);
    assert.equal(appliedValues.toggles.main, false);
    assert.equal(appliedValues.toggles.nsfw, true);
    assert.match(toast, /Creative/);
    assert.match(toast, /2 overrides/);
});

test('handleChatChanged handles deleted master preset gracefully', async () => {
    let warning = null;
    const chatMetadata = {
        prepreset: {
            master: 'DeletedPreset',
            params: {},
            toggles: {},
        },
    };

    initAutobound({
        getMode: () => 'autobound',
        getCurrentChatId: () => 'chat-123',
        getChatMetadata: () => chatMetadata,
        getMasterName: () => 'Fallback',
        selectMasterPreset: async () => false,
        readMasterValues: () => ({ params: {}, toggles: {} }),
        enabledParamKeys: () => [],
        applyValuesToLive: () => true,
        toastWarning: (text) => { warning = text; },
        toastInfo: () => {},
    });

    await handleChatChanged();

    assert.match(warning, /DeletedPreset.*not found/);
});

test('handleChatChanged initializes fresh chat with clean master preset', async () => {
    const chatMetadata = {};
    let saved = false;
    let appliedValues = null;

    initAutobound({
        getMode: () => 'autobound',
        getCurrentChatId: () => 'new-chat',
        getChatMetadata: () => chatMetadata,
        getMasterName: () => 'Default',
        readMasterValues: () => ({ params: { temperature: 1.0 }, toggles: { main: true } }),
        enabledParamKeys: () => ['temperature'],
        applyValuesToLive: (val) => { appliedValues = val; return true; },
        saveMetadataDebounced: () => { saved = true; },
        toastInfo: () => {},
    });

    await handleChatChanged();

    assert.equal(saved, true);
    assert.deepEqual(chatMetadata.prepreset, { master: 'Default', params: {}, toggles: {} });
    assert.deepEqual(appliedValues, { params: { temperature: 1.0 }, toggles: { main: true } });
});

test('handleLiveValuesEdited suppresses updates during isApplying or manual mode', () => {
    let saved = false;
    const chatMetadata = { prepreset: {} };

    initAutobound({
        getMode: () => 'autobound',
        getCurrentChatId: () => 'chat-1',
        getChatMetadata: () => chatMetadata,
        diffLiveAgainstMaster: () => ({ params: { temperature: 0.5 }, toggles: {} }),
        saveMetadataDebounced: () => { saved = true; },
    });

    setIsApplying(true);
    handleLiveValuesEdited();
    assert.equal(saved, false);
    setIsApplying(false);

    initAutobound({
        getMode: () => 'manual',
        getCurrentChatId: () => 'chat-1',
        getChatMetadata: () => chatMetadata,
        diffLiveAgainstMaster: () => ({ params: { temperature: 0.5 }, toggles: {} }),
        saveMetadataDebounced: () => { saved = true; },
    });
    handleLiveValuesEdited();
    assert.equal(saved, false);
});

test('handleLiveValuesEdited records diff and saves metadata', () => {
    let saved = false;
    const chatMetadata = { prepreset: {} };

    initAutobound({
        getMode: () => 'autobound',
        getCurrentChatId: () => 'chat-1',
        getChatMetadata: () => chatMetadata,
        getMasterName: () => 'Master',
        diffLiveAgainstMaster: () => ({ params: { temperature: 0.5 }, toggles: { promptA: false } }),
        saveMetadataDebounced: () => { saved = true; },
    });

    handleLiveValuesEdited();

    assert.equal(saved, true);
    assert.equal(chatMetadata.prepreset.master, 'Master');
    assert.deepEqual(chatMetadata.prepreset.params, { temperature: 0.5 });
    assert.deepEqual(chatMetadata.prepreset.toggles, { promptA: false });
});
