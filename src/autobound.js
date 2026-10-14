/**
 * Auto-bound mode: each chat remembers a master preset plus its own overrides
 * in chat_metadata, applied whenever the chat opens. Everything SillyTavern
 * arrives through the api passed to initAutobound.
 *
 * The rule here: a chat's overrides are only live while that chat is open.
 * Leaving it, switching to Manual, or renaming the master hands the master's
 * values back first, since every preset save reads the live values.
 *
 * The other half of that: edits are only recorded into a chat whose values this
 * file put on screen. Anything else there (a chat still opening, a preset
 * SillyTavern picked for a character, a chat whose master is missing) isn't
 * that chat's edit.
 */

import {
    effectiveValues, diffParams, diffToggles, mergeParams, mergeToggles, valuesEqual,
    paramsDirty, togglesDirty,
} from './overlay.js';

// A finished preset save emits no event, so the two places that need one poll
// for it instead. These are how long they keep trying.
const RENAME_TIMEOUT_MS = 15000;
const SAVE_LANDED_TIMEOUT_MS = 10000;

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
// handed back after chat_metadata has moved on. Also the only chat edits are
// recorded into.
let applied = null;
// Set between PRESET_RENAMED_BEFORE and the re-apply after the rename, with a
// watchdog in case the rename fails and PRESET_RENAMED never comes.
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

function endRename() {
    if (renaming?.watchdog !== undefined) {
        api?.clearTimer?.(renaming.watchdog);
    }
    renaming = null;
}

// Only enabled keys are ever applied, and only toggles for prompts that exist
// in `toggleSource` (null when toggles aren't managed).
function rememberApplied(chatId, overrides, enabledKeys, toggleSource) {
    const enabled = new Set(enabledKeys);
    const paramKeys = Object.keys(overrides?.params ?? {}).filter(key => enabled.has(key));
    const toggleIds = toggleSource
        ? Object.keys(overrides?.toggles ?? {}).filter(id => Object.hasOwn(toggleSource, id))
        : [];
    applied = { chatId, paramKeys, toggleIds };
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

// `silent` skips the "Applied preset" toast, for re-applies the user didn't
// start by opening a chat.
export function handleChatChanged({ silent = false } = {}) {
    const run = ++generation;
    pendingChanges++;
    queue = queue
        .then(() => applyOpenChat(run, silent))
        .catch(error => console.error('[Prepreset] applying the chat preset failed', error))
        .finally(() => {
            pendingChanges--;
        });
    return queue;
}

function stillCurrent(run) {
    return run === generation && api.getMode() === 'autobound';
}

async function applyOpenChat(run, silent) {
    if (run !== generation || !api) {
        return;
    }
    endRename();
    if (api.getMode() !== 'autobound') {
        return;
    }
    // On CHAT_CHANGED, SillyTavern may be switching to a preset named after the
    // character (preset-manager.js:49-76) without waiting for it. Let that land
    // first so it can't finish on top of this chat's own preset.
    await api.waitForPresetApplication?.();
    if (!stillCurrent(run)) {
        return;
    }

    const chatId = api.getCurrentChatId();
    if (applied && applied.chatId !== chatId) {
        releaseChatOverrides();
    }
    if (!chatId) {
        // After a reload nothing in memory knows the last chat's values are still
        // on screen (SillyTavern restored them from settings.json), so put the
        // master's values back for every managed field.
        whileApplying(() => {
            const masterValues = api.readMasterValues({ quiet: true });
            if (masterValues) {
                api.applyValuesToLive(masterValues);
            }
        });
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
        if (!silent) {
            api.toastInfo?.(formatIndicatorText(api.getMasterName(), 0), 'Prepreset');
        }
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
        if (!stillCurrent(run)) {
            return;
        }
        if (!switched) {
            // The overrides were measured against that master, so applying them
            // to this one would be wrong, and with nothing applied, no edit is
            // recorded either. Both stay as they are until the master is back.
            api.toastWarning?.(`Master preset "${chatPreset.master}" not found; this chat's settings aren't applied until it's back.`, 'Prepreset');
            return;
        }
    }

    const keys = api.enabledParamKeys();
    let count = null;
    whileApplying(() => {
        const masterValues = api.readMasterValues({ quiet: true });
        if (!masterValues) {
            return;
        }
        api.applyValuesToLive(effectiveValues(masterValues, chatPreset, keys));
        rememberApplied(chatId, chatPreset, keys, masterValues.toggles);
        count = applied.paramKeys.length + applied.toggleIds.length;
    });
    if (count !== null && !silent) {
        api.toastInfo?.(formatIndicatorText(api.getMasterName(), count), 'Prepreset');
    }
}

// Records how the live values differ from the master into the open chat. Runs
// every animation frame while a slider drags, hence the quiet reads. Merges
// rather than replaces, like saving a sub-preset does.
//
// `immediate` skips SillyTavern's one-second debounce, because it doesn't save
// chat metadata on a chat switch and drops a pending save when the character
// changes, losing an edit made just before either. Discrete edits pass it;
// slider drags don't, or every frame would write the chat file.
export function handleLiveValuesEdited({ immediate = false } = {}) {
    if (isBusy() || !api || api.getMode() !== 'autobound') {
        return;
    }
    const chatId = api.getCurrentChatId();
    if (!chatId || applied?.chatId !== chatId) {
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

    rememberApplied(chatId, next, keys, live.toggles);
    if (valuesEqual(next, chatMetadata.prepreset)) {
        return;
    }
    chatMetadata.prepreset = next;
    if (immediate) {
        api.saveMetadata?.();
    } else {
        api.saveMetadataDebounced?.();
    }
}

function liveMatchesMaster() {
    const live = api.readLiveValues({ quiet: true });
    const master = api.readMasterValues({ quiet: true });
    if (!live || !master) {
        return false;
    }
    if (paramsDirty(live.params, master.params, api.enabledParamKeys())) {
        return false;
    }
    return live.toggles === null || master.toggles === null || !togglesDirty(live.toggles, master.toggles);
}

// Saving the master from inside a chat writes what's on screen into the master,
// so once the save lands this chat's overrides match it. Left in place they'd
// pin today's values the next time the master changes, so record the difference
// again: it comes out empty, and overrides for fields that aren't enabled are
// kept, as with any other save.
export async function handleMasterSaved() {
    if (!api || isBusy() || api.getMode() !== 'autobound') {
        return;
    }
    const chatId = api.getCurrentChatId();
    if (!chatId || applied?.chatId !== chatId) {
        return;
    }
    const landed = await api.waitUntil(liveMatchesMaster, { timeout: SAVE_LANDED_TIMEOUT_MS });
    if (!landed) {
        return;
    }
    handleLiveValuesEdited({ immediate: true });
}

// SillyTavern saves the renamed preset from live values, so hand the chat's
// overrides back first. Recording edits stays off until they're re-applied, or
// the rename's preset change looks like the chat dropping them.
export function handleMasterRenameBefore(oldName, newName) {
    if (!api || api.getMode() !== 'autobound') {
        return;
    }
    endRename();
    renaming = {
        from: oldName,
        to: newName,
        // A failed rename never emits PRESET_RENAMED; put the chat back anyway.
        watchdog: api.setTimer?.(recoverFromRename, RENAME_TIMEOUT_MS),
    };
    releaseChatOverrides();
}

function recoverFromRename() {
    if (!renaming) {
        return;
    }
    endRename();
    return handleChatChanged({ silent: true });
}

// The PRESET_RENAMED listener must not await this: the overrides have to stay
// off until SillyTavern's follow-up save has read the live values (see the
// PRESET_RENAMED_BEFORE listener in index.js).
export async function handleMasterRenamed(oldName, newName) {
    if (!renaming || !api) {
        return;
    }
    await api.nextTask();
    // That follow-up save is also what puts any contents in the renamed preset,
    // and it announces nothing, so wait for the master to fill before
    // re-applying against it.
    const ready = await api.waitUntil(() => api.isMasterReady(), { timeout: RENAME_TIMEOUT_MS });
    endRename();
    if (!ready) {
        api.toastWarning?.(`Couldn't read "${newName}" after the rename; reopen this chat to apply its settings.`, 'Prepreset');
        return;
    }
    const chatMetadata = api.getCurrentChatId() ? api.getChatMetadata() : null;
    if (chatMetadata && isBinding(chatMetadata.prepreset) && chatMetadata.prepreset.master === oldName) {
        chatMetadata.prepreset = { ...chatMetadata.prepreset, master: newName };
        api.saveMetadata?.();
    }
    await handleChatChanged({ silent: true });
}
