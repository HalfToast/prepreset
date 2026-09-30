/**
 * Auto-bound mode: each chat remembers a master preset plus its own overrides
 * in chat_metadata, applied whenever the chat opens. Everything SillyTavern
 * arrives through the api passed to initAutobound.
 *
 * The rule here: a chat's overrides are only live while that chat is open.
 * Leaving it, switching to Manual, or renaming the master hands the master's
 * values back first, since every preset save reads the live values.
 */

import {
    effectiveValues, diffParams, diffToggles, mergeParams, mergeToggles, valuesEqual,
} from './overlay.js';

export function countOverrides(diff) {
    if (!diff || typeof diff !== 'object') {
        return 0;
    }
    const toggleCount = diff.toggles && typeof diff.toggles === 'object'
        ? Object.keys(diff.toggles).length
        : 0;
    const paramCount = diff.params && typeof diff.params === 'object'
        ? Object.keys(diff.params).length
        : 0;
    return toggleCount + paramCount;
}

export function formatIndicatorText(masterName, overrideCount) {
    const name = String(masterName || '');
    if (overrideCount <= 0) {
        return `Applied preset: ${name}`;
    }
    const countText = overrideCount === 1 ? '1 override' : `${overrideCount} overrides`;
    return `Applied preset: ${name} (${countText})`;
}

function isBinding(value) {
    return !!value && typeof value === 'object' && typeof value.master === 'string' && value.master.length > 0;
}

let api = null;
let isApplying = false;
// Which chat's overrides are live and which keys they cover, so they can be
// handed back after chat_metadata has moved on.
let applied = null;
// A chat bound to a master that won't load. Left untouched rather than
// rewritten against whatever master happens to be loaded.
let suspendedChatId = null;
// Set between PRESET_RENAMED_BEFORE and the re-apply after the rename.
let renaming = null;
// Chat changes run one at a time. The generation number spots when a newer one
// has made an older one's remaining work pointless.
let queue = Promise.resolve();
let generation = 0;
let pendingChanges = 0;

export function setIsApplying(value) {
    isApplying = !!value;
}

export function initAutobound(autoboundApi) {
    api = autoboundApi;
    isApplying = false;
    applied = null;
    suspendedChatId = null;
    renaming = null;
    queue = Promise.resolve();
    generation = 0;
    pendingChanges = 0;
}

// Anything in flight means live values don't yet belong to the open chat.
function isBusy() {
    return isApplying || pendingChanges > 0 || renaming !== null;
}

function whileApplying(run) {
    isApplying = true;
    try {
        return run();
    } finally {
        isApplying = false;
    }
}

// Only enabled keys were ever applied, and toggles only when they're managed.
function rememberApplied(chatId, overrides, enabledKeys, togglesManaged) {
    const enabled = new Set(enabledKeys);
    const params = Object.keys(overrides?.params ?? {}).filter(key => enabled.has(key));
    const toggles = togglesManaged ? Object.keys(overrides?.toggles ?? {}) : [];
    applied = { chatId, paramKeys: params, toggleIds: toggles };
}

// Puts the master's own values back for everything the last applied chat
// overrode. Fields it never managed are left as they are.
export function releaseChatOverrides() {
    if (!applied || !api) {
        return;
    }
    const { paramKeys, toggleIds } = applied;
    applied = null;
    if (paramKeys.length === 0 && toggleIds.length === 0) {
        return;
    }
    whileApplying(() => api.applyMasterValuesFor({ paramKeys, toggleIds }));
}

export function handleChatChanged() {
    const run = ++generation;
    pendingChanges++;
    queue = queue
        .then(() => applyOpenChat(run))
        .catch(error => console.error('[Prepreset] applying the chat preset failed', error))
        .finally(() => {
            pendingChanges--;
        });
    return queue;
}

async function applyOpenChat(run) {
    if (run !== generation || !api) {
        return;
    }
    renaming = null;
    suspendedChatId = null;

    if (api.getMode() !== 'autobound') {
        return;
    }
    const chatId = api.getCurrentChatId();
    if (applied && applied.chatId !== chatId) {
        releaseChatOverrides();
    }
    if (!chatId) {
        return;
    }
    const chatMetadata = api.getChatMetadata();
    if (!chatMetadata) {
        return;
    }

    const chatPreset = chatMetadata.prepreset;
    if (!isBinding(chatPreset)) {
        // A chat opened for the first time binds to whatever master is loaded.
        whileApplying(() => {
            const masterValues = api.readMasterValues({ quiet: true });
            if (masterValues) {
                api.applyValuesToLive(masterValues);
            }
        });
        chatMetadata.prepreset = { master: api.getMasterName(), params: {}, toggles: {} };
        api.saveMetadataDebounced?.();
        applied = { chatId, paramKeys: [], toggleIds: [] };
        api.toastInfo?.(formatIndicatorText(api.getMasterName(), 0), 'Prepreset');
        return;
    }

    if (chatPreset.master !== api.getMasterName()) {
        isApplying = true;
        let switched;
        try {
            switched = await api.selectMasterPreset(chatPreset.master);
        } finally {
            isApplying = false;
        }
        if (run !== generation) {
            return;
        }
        if (!switched) {
            // The overrides were measured against that master, so applying them
            // to this one would be wrong and recording edits would rebind the
            // chat. Leave both alone until the master is back.
            suspendedChatId = chatId;
            api.toastWarning?.(`Master preset "${chatPreset.master}" not found; this chat's settings aren't applied until it's back.`, 'Prepreset');
            return;
        }
    }

    const keys = api.enabledParamKeys();
    whileApplying(() => {
        const masterValues = api.readMasterValues({ quiet: true });
        if (!masterValues) {
            return;
        }
        api.applyValuesToLive(effectiveValues(masterValues, chatPreset, keys));
        rememberApplied(chatId, chatPreset, keys, masterValues.toggles !== null);
    });
    api.toastInfo?.(formatIndicatorText(api.getMasterName(), countOverrides(chatPreset)), 'Prepreset');
}

// Records how the live values differ from the master into the open chat. Runs
// every animation frame while a slider drags, hence the quiet reads. Merges
// rather than replaces, like saving a sub-preset does.
export function handleLiveValuesEdited() {
    if (isBusy() || !api || api.getMode() !== 'autobound') {
        return;
    }
    const chatId = api.getCurrentChatId();
    if (!chatId || chatId === suspendedChatId) {
        return;
    }
    const chatMetadata = api.getChatMetadata();
    if (!chatMetadata) {
        return;
    }
    const live = api.readLiveValues({ quiet: true });
    const master = api.readMasterValues({ quiet: true });
    if (!live || !master) {
        return;
    }

    const masterName = api.getMasterName();
    // Picking another master for this chat rebinds it; overrides measured
    // against the old master don't carry over.
    const stored = isBinding(chatMetadata.prepreset) && chatMetadata.prepreset.master === masterName
        ? chatMetadata.prepreset
        : null;
    const keys = api.enabledParamKeys();
    const next = {
        master: masterName,
        params: mergeParams(stored?.params, diffParams(live.params, master.params, keys), keys),
        toggles: live.toggles === null
            ? { ...(stored?.toggles ?? {}) }
            : mergeToggles(stored?.toggles, diffToggles(live.toggles, master.toggles), live.toggles),
    };

    rememberApplied(chatId, next, keys, live.toggles !== null);
    if (valuesEqual(next, chatMetadata.prepreset)) {
        return;
    }
    chatMetadata.prepreset = next;
    api.saveMetadataDebounced?.();
}

// SillyTavern saves the renamed preset straight from live values, so hand the
// chat's overrides back first. Recording edits stays off until they're
// re-applied, or the rename's preset change looks like the chat dropping them.
export function handleMasterRenameBefore(oldName, newName) {
    if (!api || api.getMode() !== 'autobound') {
        return;
    }
    renaming = { from: oldName, to: newName };
    releaseChatOverrides();
}

// The PRESET_RENAMED listener must not await this. SillyTavern saves the
// renamed preset once more right after that event (preset-manager.js:1077),
// and the overrides have to stay off until that save has read the live values.
export async function handleMasterRenamed(oldName, newName) {
    if (!renaming || !api) {
        return;
    }
    try {
        await api.nextTask();
        await api.waitForPresetApplication();
        const chatMetadata = api.getCurrentChatId() ? api.getChatMetadata() : null;
        if (chatMetadata && isBinding(chatMetadata.prepreset) && chatMetadata.prepreset.master === oldName) {
            chatMetadata.prepreset = { ...chatMetadata.prepreset, master: newName };
            api.saveMetadataDebounced?.();
        }
    } finally {
        renaming = null;
    }
    await handleChatChanged();
}
