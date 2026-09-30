import test from 'node:test';
import assert from 'node:assert/strict';
import {
    countOverrides, formatIndicatorText,
    initAutobound, handleChatChanged, handleLiveValuesEdited,
    setIsApplying, releaseChatOverrides,
    handleMasterRenameBefore, handleMasterRenamed,
} from '../src/autobound.js';

function pick(source, keys) {
    const result = {};
    for (const key of keys) {
        if (source[key] !== undefined) {
            result[key] = source[key];
        }
    }
    return result;
}

// A fake SillyTavern: preset files, live values and one open chat. The apply
// functions write into `live`, so the tests check what ends up on screen rather
// than which function was called.
function fakeTavern({
    mode = 'autobound',
    chatId = 'chat-1',
    chatMetadata = {},
    masters,
    loaded = 'Default',
    enabledKeys = ['temperature', 'top_p'],
    togglesOn = true,
    selectMasterPreset,
} = {}) {
    const state = {
        mode,
        chatId,
        chatMetadata,
        loaded,
        masters: masters ?? {
            Default: { params: { temperature: 1, top_p: 0.9, top_k: 0 }, toggles: { main: true, nsfw: false, jb: true } },
        },
        live: null,
        saves: 0,
        toasts: [],
        reads: [],
    };
    const master = () => state.masters[state.loaded];
    state.live = { params: { ...master().params }, toggles: { ...master().toggles } };

    initAutobound({
        getMode: () => state.mode,
        getCurrentChatId: () => state.chatId,
        getChatMetadata: () => state.chatMetadata,
        getMasterName: () => state.loaded,
        selectMasterPreset: selectMasterPreset ?? (async (name) => {
            if (!state.masters[name]) {
                return false;
            }
            state.loaded = name;
            state.live = { params: { ...master().params }, toggles: { ...master().toggles } };
            return true;
        }),
        enabledParamKeys: () => enabledKeys,
        readMasterValues: (options) => {
            state.reads.push(['master', options]);
            return { params: pick(master().params, enabledKeys), toggles: togglesOn ? { ...master().toggles } : null };
        },
        readLiveValues: (options) => {
            state.reads.push(['live', options]);
            return { params: pick(state.live.params, enabledKeys), toggles: togglesOn ? { ...state.live.toggles } : null };
        },
        // Like applyToggles, only prompts already on screen are touched.
        applyValuesToLive: (values) => {
            Object.assign(state.live.params, values.params ?? {});
            for (const [id, enabled] of Object.entries(values.toggles ?? {})) {
                if (Object.hasOwn(state.live.toggles, id)) {
                    state.live.toggles[id] = enabled;
                }
            }
            return true;
        },
        applyMasterValuesFor: ({ paramKeys, toggleIds }) => {
            for (const key of paramKeys) {
                state.live.params[key] = master().params[key];
            }
            for (const id of toggleIds) {
                state.live.toggles[id] = master().toggles[id];
            }
            return true;
        },
        saveMetadataDebounced: () => {
            state.saves++;
        },
        toastInfo: (text) => state.toasts.push(['info', text]),
        toastWarning: (text) => state.toasts.push(['warning', text]),
        nextTask: () => Promise.resolve(),
        waitForPresetApplication: () => Promise.resolve(),
    });
    return state;
}

test('countOverrides counts both toggles and params', () => {
    assert.equal(countOverrides(null), 0);
    assert.equal(countOverrides({}), 0);
    assert.equal(countOverrides({ toggles: { a: true, b: false }, params: { temp: 0.7 } }), 3);
    assert.equal(countOverrides({ toggles: { a: true }, params: {} }), 1);
});

test('formatIndicatorText handles zero and non-zero overrides', () => {
    assert.equal(formatIndicatorText('Default', 0), 'Applied preset: Default');
    assert.equal(formatIndicatorText('Story', 1), 'Applied preset: Story (1 override)');
    assert.equal(formatIndicatorText('Story', 3), 'Applied preset: Story (3 overrides)');
});

test('handleChatChanged no-ops when mode is manual', async () => {
    const tavern = fakeTavern({
        mode: 'manual',
        chatMetadata: { prepreset: { master: 'Default', params: { temperature: 0.5 }, toggles: {} } },
    });
    await handleChatChanged();
    assert.equal(tavern.live.params.temperature, 1);
});

test('handleChatChanged switches master and applies chat overrides with toast', async () => {
    const tavern = fakeTavern({
        masters: {
            Default: { params: { temperature: 1, top_p: 0.9 }, toggles: { main: true, nsfw: true } },
            Creative: { params: { temperature: 1, top_p: 0.9 }, toggles: { main: true, nsfw: true } },
        },
        chatMetadata: { prepreset: { master: 'Creative', params: { temperature: 0.8 }, toggles: { main: false } } },
    });

    await handleChatChanged();

    assert.equal(tavern.loaded, 'Creative');
    assert.equal(tavern.live.params.temperature, 0.8);
    assert.equal(tavern.live.params.top_p, 0.9);
    assert.equal(tavern.live.toggles.main, false);
    assert.equal(tavern.live.toggles.nsfw, true);
    assert.deepEqual(tavern.toasts, [['info', 'Applied preset: Creative (2 overrides)']]);
});

test('handleChatChanged binds a fresh chat to the loaded master with no overrides', async () => {
    const tavern = fakeTavern({ chatMetadata: {} });
    await handleChatChanged();
    assert.equal(tavern.saves, 1);
    assert.deepEqual(tavern.chatMetadata.prepreset, { master: 'Default', params: {}, toggles: {} });
});

test('leaving a chat hands the master values back for everything it overrode', async () => {
    const tavern = fakeTavern({
        chatMetadata: { prepreset: { master: 'Default', params: { temperature: 0.5 }, toggles: { nsfw: true } } },
    });
    await handleChatChanged();
    assert.equal(tavern.live.params.temperature, 0.5);
    assert.equal(tavern.live.toggles.nsfw, true);

    tavern.chatId = null;
    tavern.chatMetadata = {};
    await handleChatChanged();

    assert.equal(tavern.live.params.temperature, 1);
    assert.equal(tavern.live.toggles.nsfw, false);
});

test('releaseChatOverrides hands the master values back (switching to Manual)', async () => {
    const tavern = fakeTavern({
        chatMetadata: { prepreset: { master: 'Default', params: { temperature: 0.5 }, toggles: {} } },
    });
    await handleChatChanged();

    releaseChatOverrides();

    assert.equal(tavern.live.params.temperature, 1);
});

test('releasing leaves fields the chat never managed alone', async () => {
    const tavern = fakeTavern({
        enabledKeys: ['temperature'],
        chatMetadata: { prepreset: { master: 'Default', params: { temperature: 0.5 }, toggles: {} } },
    });
    await handleChatChanged();
    tavern.live.params.top_k = 99;

    releaseChatOverrides();

    assert.equal(tavern.live.params.temperature, 1);
    assert.equal(tavern.live.params.top_k, 99);
});

test('releasing includes overrides recorded after the chat was opened', async () => {
    const tavern = fakeTavern({
        chatMetadata: { prepreset: { master: 'Default', params: {}, toggles: {} } },
    });
    await handleChatChanged();
    tavern.live.params.top_p = 0.5;
    handleLiveValuesEdited();

    releaseChatOverrides();

    assert.equal(tavern.live.params.top_p, 0.9);
});

test('saving chat edits keeps stored overrides for fields that are not enabled', async () => {
    const tavern = fakeTavern({
        enabledKeys: ['temperature'],
        chatMetadata: { prepreset: { master: 'Default', params: { temperature: 0.5, top_k: 40 }, toggles: {} } },
    });
    await handleChatChanged();
    tavern.live.params.temperature = 0.7;

    handleLiveValuesEdited();

    assert.deepEqual(tavern.chatMetadata.prepreset.params, { temperature: 0.7, top_k: 40 });
});

test('saving chat edits keeps toggle overrides for prompts not on screen', async () => {
    const tavern = fakeTavern({
        chatMetadata: { prepreset: { master: 'Default', params: {}, toggles: { gone: true } } },
    });
    await handleChatChanged();
    tavern.live.toggles.nsfw = true;

    handleLiveValuesEdited();

    assert.deepEqual(tavern.chatMetadata.prepreset.toggles, { gone: true, nsfw: true });
});

test('saving chat edits keeps toggle overrides when prompt toggles are disabled', async () => {
    const tavern = fakeTavern({
        togglesOn: false,
        chatMetadata: { prepreset: { master: 'Default', params: {}, toggles: { nsfw: true } } },
    });
    await handleChatChanged();
    tavern.live.params.temperature = 0.7;

    handleLiveValuesEdited();

    assert.deepEqual(tavern.chatMetadata.prepreset, { master: 'Default', params: { temperature: 0.7 }, toggles: { nsfw: true } });
});

test('saving chat edits reads quietly', async () => {
    const tavern = fakeTavern({ chatMetadata: { prepreset: { master: 'Default', params: {}, toggles: {} } } });
    await handleChatChanged();
    tavern.reads.length = 0;
    tavern.live.params.temperature = 0.7;

    handleLiveValuesEdited();

    assert.ok(tavern.reads.length > 0);
    for (const [, options] of tavern.reads) {
        assert.deepEqual(options, { quiet: true });
    }
});

test('saving chat edits does not write the chat file when nothing changed', async () => {
    const tavern = fakeTavern({ chatMetadata: { prepreset: { master: 'Default', params: { temperature: 0.5 }, toggles: {} } } });
    await handleChatChanged();
    const before = tavern.saves;

    handleLiveValuesEdited();

    assert.equal(tavern.saves, before);
});

test('handleLiveValuesEdited is suppressed while applying, in manual, and with no chat', async () => {
    const tavern = fakeTavern({ chatMetadata: { prepreset: { master: 'Default', params: {}, toggles: {} } } });
    await handleChatChanged();
    tavern.live.params.temperature = 0.7;

    setIsApplying(true);
    handleLiveValuesEdited();
    setIsApplying(false);
    assert.deepEqual(tavern.chatMetadata.prepreset.params, {});

    tavern.mode = 'manual';
    handleLiveValuesEdited();
    assert.deepEqual(tavern.chatMetadata.prepreset.params, {});

    tavern.mode = 'autobound';
    tavern.chatId = null;
    handleLiveValuesEdited();
    assert.deepEqual(tavern.chatMetadata.prepreset.params, {});
});

test('a chat whose master is missing keeps its binding and applies nothing', async () => {
    const tavern = fakeTavern({
        chatMetadata: { prepreset: { master: 'Story', params: { temperature: 0.2 }, toggles: {} } },
    });

    await handleChatChanged();

    assert.equal(tavern.toasts[0][0], 'warning');
    assert.match(tavern.toasts[0][1], /Story.*not found/);
    assert.equal(tavern.live.params.temperature, 1);

    tavern.live.params.top_p = 0.5;
    handleLiveValuesEdited();
    assert.deepEqual(tavern.chatMetadata.prepreset, { master: 'Story', params: { temperature: 0.2 }, toggles: {} });
});

test('a chat whose master is missing still hands back the previous chat overrides', async () => {
    const tavern = fakeTavern({
        chatMetadata: { prepreset: { master: 'Default', params: { temperature: 0.5 }, toggles: {} } },
    });
    await handleChatChanged();

    tavern.chatId = 'chat-2';
    tavern.chatMetadata = { prepreset: { master: 'Story', params: {}, toggles: {} } };
    await handleChatChanged();

    assert.equal(tavern.live.params.temperature, 1);
});

test('renaming the master keeps overrides out of the file, then re-applies them', async () => {
    const tavern = fakeTavern({
        chatMetadata: { prepreset: { master: 'Default', params: { temperature: 0.5 }, toggles: { nsfw: true } } },
    });
    await handleChatChanged();

    handleMasterRenameBefore('Default', 'Renamed');
    // SillyTavern saves the renamed file from live values: they must be the master's.
    assert.equal(tavern.live.params.temperature, 1);
    assert.equal(tavern.live.toggles.nsfw, false);

    tavern.masters.Renamed = tavern.masters.Default;
    delete tavern.masters.Default;
    tavern.loaded = 'Renamed';
    // The preset change during a rename must not be recorded as the chat's edit.
    handleLiveValuesEdited();
    assert.deepEqual(tavern.chatMetadata.prepreset.params, { temperature: 0.5 });

    await handleMasterRenamed('Default', 'Renamed');

    assert.equal(tavern.chatMetadata.prepreset.master, 'Renamed');
    assert.deepEqual(tavern.chatMetadata.prepreset.params, { temperature: 0.5 });
    assert.equal(tavern.live.params.temperature, 0.5);
    assert.equal(tavern.live.toggles.nsfw, true);
});

test('a second chat change supersedes a first one still switching master', async () => {
    let finishSwitch;
    const tavern = fakeTavern({
        masters: {
            Default: { params: { temperature: 1, top_p: 0.9 }, toggles: { main: true } },
            Story: { params: { temperature: 1, top_p: 0.9 }, toggles: { main: true } },
        },
        chatMetadata: { prepreset: { master: 'Story', params: { temperature: 0.2 }, toggles: {} } },
        // Only the first switch hangs until released; later ones finish at once.
        selectMasterPreset: (name) => {
            if (finishSwitch) {
                tavern.loaded = name;
                return Promise.resolve(true);
            }
            return new Promise((resolve) => {
                finishSwitch = () => {
                    tavern.loaded = name;
                    resolve(true);
                };
            });
        },
    });

    const first = handleChatChanged();
    // CHAT_CHANGED events arrive in separate tasks, so the first change has
    // started, and is waiting on its master switch, before the second arrives.
    await new Promise(resolve => setImmediate(resolve));

    const chatB = { prepreset: { master: 'Default', params: { top_p: 0.4 }, toggles: {} } };
    tavern.chatId = 'chat-2';
    tavern.chatMetadata = chatB;
    const second = handleChatChanged();

    // Edits while a chat change is still pending belong to nobody yet.
    handleLiveValuesEdited();
    assert.deepEqual(chatB.prepreset.params, { top_p: 0.4 });

    finishSwitch();
    await first;
    await second;

    assert.equal(tavern.live.params.temperature, 1);
    assert.deepEqual(chatB.prepreset, { master: 'Default', params: { top_p: 0.4 }, toggles: {} });
});
