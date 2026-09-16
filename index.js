/**
 * Prepreset: named sub-presets for chat completion prompt toggles.
 *
 * The only module that touches SillyTavern globals. The real logic lives in
 * src/store.js and src/toggles.js, which are unit-tested under plain Node.
 */

import { saveSettingsDebounced, eventSource, event_types } from '/script.js';
import { extension_settings } from '/scripts/extensions.js';
import { oai_settings, promptManager } from '/scripts/openai.js';
import { getPresetManager } from '/scripts/preset-manager.js';
import {
    migrate, getActiveSubPreset, setActiveSubPreset, updateSubPresetToggles,
} from './src/store.js';
import { findOrderEntry, readToggles, applyToggles, togglesEqual } from './src/toggles.js';
import { injectControlRow, renderControlRow } from './src/ui.js';
import { installMasterSaveGuard } from './src/guard.js';

export const EXTENSION_KEY = 'prepreset';
export const EXTENSION_NAME = 'Prepreset';

let initCalled = false;

export function getSettings() {
    return extension_settings[EXTENSION_KEY];
}

// Queues a write of settings.json. That covers extension_settings, where the
// sub-presets live, but applyTogglesToLive leans on it too, to persist the
// oai_settings.prompt_order it mutates.
export function persist() {
    saveSettingsDebounced();
}

// Entry point, called via the 'activate' manifest hook.
export async function init() {
    if (initCalled) {
        return;
    }
    initCalled = true;

    extension_settings[EXTENSION_KEY] = migrate(extension_settings[EXTENSION_KEY]);

    installAutoSaveHook();

    injectControlRow({
        getSettings,
        getMasterName,
        getActiveSub,
        selectSubPreset,
        readLiveToggles,
        persist,
    });

    installMasterSaveGuard({
        getActiveSub,
        readMasterToggles,
        applyTogglesToLive,
    });

    onSelectionChanged(renderControlRow);

    eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
        installAutoSaveHook();
        // prompt_order has just been loaded from the new preset file, so the live
        // state already equals the new master's own toggles. Reset the selection
        // rather than silently re-applying a remembered sub-preset.
        setActiveSubPreset(getSettings(), getMasterName(), null);
        persist();
        notifySelectionChanged();
    });

    // preset-manager.js awaits this before renamePreset() runs, and renamePreset
    // saves the renamed preset from live oai_settings as its first act, before any
    // click the guard could intercept. With a sub-preset active that save would
    // bake its toggles into the master file under the new name, so put the
    // master's own toggles back first.
    //
    // Nothing re-applies the sub-preset afterwards, on purpose: the rename changes
    // the master's name, so the OAI_PRESET_CHANGED_AFTER handler above resets the
    // selection to Master anyway.
    eventSource.on(event_types.PRESET_RENAMED_BEFORE, ({ apiId } = {}) => {
        if (apiId !== 'openai') {
            return;
        }
        if (!getActiveSub()) {
            return;
        }
        const masterToggles = readMasterToggles();
        if (!masterToggles) {
            return;
        }
        applyTogglesToLive(masterToggles);
    });

    console.debug(`[${EXTENSION_NAME}] initialized`, getSettings());
}

// True while we are writing toggles ourselves.
let applying = false;

export function isApplying() {
    return applying;
}

export function getMasterName() {
    return oai_settings.preset_settings_openai ?? '';
}

// PromptManager defaults the dummy character id to 100000 but openai.js
// overrides it to 100001, so read it at runtime.
export function getDummyId() {
    return promptManager?.configuration?.promptOrder?.dummyId ?? null;
}

// Null if the Prompt Manager isn't ready.
export function readLiveToggles() {
    const dummyId = getDummyId();
    if (dummyId === null) {
        console.warn(`[${EXTENSION_NAME}] Prompt Manager not ready`);
        return null;
    }
    const entry = findOrderEntry(oai_settings.prompt_order, dummyId);
    if (!entry) {
        const message = `No prompt order for dummy id ${dummyId}`;
        console.warn(`[${EXTENSION_NAME}] ${message}`);
        toastr.warning(message, EXTENSION_NAME);
        return null;
    }
    return readToggles(entry.order);
}

// Reads the master's own toggles straight from the stored preset, so "no
// sub-preset" reflects the master as saved rather than a cached copy.
export function readMasterToggles() {
    const dummyId = getDummyId();
    if (dummyId === null) {
        return null;
    }
    const preset = getPresetManager('openai')?.getCompletionPresetByName(getMasterName());
    if (!preset) {
        toastr.error(`Could not read the master preset "${getMasterName()}"`, EXTENSION_NAME);
        return null;
    }
    const entry = findOrderEntry(preset.prompt_order, dummyId);
    if (!entry) {
        const message = `Master preset "${getMasterName()}" has no prompt order for dummy id ${dummyId}`;
        console.warn(`[${EXTENSION_NAME}] ${message}`);
        toastr.warning(message, EXTENSION_NAME);
        return null;
    }
    return readToggles(entry.order);
}

// Writes a toggle map into the live prompt order and re-renders the Prompt
// Manager.
//
// Don't count on `applying` to keep this write out of auto-save. render(false)
// does its work inside a waitUntilCondition().then() (PromptManager.js:865+),
// by which point the flag is false again. What actually saves us is the
// togglesEqual short-circuit in autoSaveActiveSubPreset().
export function applyTogglesToLive(toggles) {
    installAutoSaveHook();

    const dummyId = getDummyId();
    if (dummyId === null) {
        console.warn(`[${EXTENSION_NAME}] Prompt Manager not ready`);
        return false;
    }
    const entry = findOrderEntry(oai_settings.prompt_order, dummyId);
    if (!entry) {
        console.warn(`[${EXTENSION_NAME}] no prompt order for dummy id ${dummyId}`);
        return false;
    }

    applying = true;
    try {
        entry.order = applyToggles(entry.order, toggles);
        promptManager?.render(false);
        persist();
        return true;
    } finally {
        applying = false;
    }
}

const selectionListeners = [];

export function onSelectionChanged(callback) {
    selectionListeners.push(callback);
}

function notifySelectionChanged() {
    for (const callback of selectionListeners) {
        callback();
    }
}

// Null when the master is selected.
export function getActiveSub() {
    return getActiveSubPreset(getSettings(), getMasterName());
}

// Null selects the master, whose toggles come from the stored preset.
export function selectSubPreset(subId) {
    const masterName = getMasterName();
    const storedId = setActiveSubPreset(getSettings(), masterName, subId);
    const sub = storedId ? getActiveSub() : null;
    const toggles = sub ? sub.toggles : readMasterToggles();

    if (toggles) {
        applyTogglesToLive(toggles);
    }

    persist();
    notifySelectionChanged();
}

function autoSaveActiveSubPreset() {
    if (applying) {
        return;
    }
    const sub = getActiveSub();
    if (!sub) {
        return;
    }
    const live = readLiveToggles();
    if (!live || togglesEqual(live, sub.toggles)) {
        return;
    }
    updateSubPresetToggles(getSettings(), getMasterName(), sub.id, live);
    persist();
}

// Wraps promptManager.saveServiceSettings so every mutation also snapshots into
// the active sub-preset. Every mutation path in PromptManager goes through it,
// which makes it the one choke point.
//
// Text edits and reordering route through here too. Harmless: only the enabled
// flags are read, and togglesEqual drops an unchanged snapshot.
let saveHookInstalled = false;

function installAutoSaveHook() {
    if (saveHookInstalled || !promptManager) {
        return;
    }
    const original = promptManager.saveServiceSettings.bind(promptManager);
    promptManager.saveServiceSettings = function () {
        // Snapshot before returning the original's promise. That promise resolves
        // on SETTINGS_UPDATED up to a second later, by which point the user may
        // have picked a different sub-preset, and the edit would land on the wrong
        // one or be dropped.
        autoSaveActiveSubPreset();
        return original();
    };
    saveHookInstalled = true;
    console.debug(`[${EXTENSION_NAME}] auto-save hook installed`);
}
