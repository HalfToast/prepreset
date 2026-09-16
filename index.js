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

    installChangeHook();

    injectControlRow({
        getSettings,
        getMasterName,
        getActiveSub,
        selectSubPreset,
        readLiveToggles,
        isDirty,
        saveActiveSubPreset,
        persist,
    });

    installMasterSaveGuard({
        getActiveSub,
        readMasterToggles,
        applyTogglesToLive,
    });

    onSelectionChanged(renderControlRow);

    eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
        installChangeHook();
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

export function getMasterName() {
    return oai_settings.preset_settings_openai ?? '';
}

// PromptManager defaults the dummy character id to 100000 but openai.js
// overrides it to 100001, so read it at runtime.
export function getDummyId() {
    return promptManager?.configuration?.promptOrder?.dummyId ?? null;
}

// Null if the Prompt Manager isn't ready. Pass quiet for callers that run on
// every toggle flip, like isDirty(), where a toast per flip would be a stream.
export function readLiveToggles({ quiet = false } = {}) {
    const dummyId = getDummyId();
    if (dummyId === null) {
        console.warn(`[${EXTENSION_NAME}] Prompt Manager not ready`);
        return null;
    }
    const entry = findOrderEntry(oai_settings.prompt_order, dummyId);
    if (!entry) {
        const message = `No prompt order for dummy id ${dummyId}`;
        console.warn(`[${EXTENSION_NAME}] ${message}`);
        if (!quiet) {
            toastr.warning(message, EXTENSION_NAME);
        }
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
// Manager. Nothing is stored against a sub-preset here; that only happens when
// the user saves.
export function applyTogglesToLive(toggles) {
    installChangeHook();

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

    entry.order = applyToggles(entry.order, toggles);
    promptManager?.render(false);
    persist();
    return true;
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

// Derived rather than tracked as a flag, so it survives a page reload:
// SillyTavern persists the live prompt order, and nothing touches the
// sub-preset until the user saves.
export function isDirty() {
    const sub = getActiveSub();
    if (!sub) {
        return false;
    }
    const live = readLiveToggles({ quiet: true });
    return !!live && !togglesEqual(live, sub.toggles);
}

export function saveActiveSubPreset() {
    const sub = getActiveSub();
    if (!sub) {
        return false;
    }
    const live = readLiveToggles();
    if (!live) {
        return false;
    }
    updateSubPresetToggles(getSettings(), getMasterName(), sub.id, live);
    persist();
    notifySelectionChanged();
    return true;
}

// Wraps promptManager.saveServiceSettings, which every mutation path in
// PromptManager goes through, so it is the one place that sees a toggle change.
//
// It writes nothing: saving is explicit. All it does is re-render the control
// row so the unsaved-changes marker keeps up. Text edits and reordering route
// through here too, which is harmless, since the marker only compares the
// enabled flags.
let changeHookInstalled = false;

function installChangeHook() {
    if (changeHookInstalled || !promptManager) {
        return;
    }
    const original = promptManager.saveServiceSettings.bind(promptManager);
    promptManager.saveServiceSettings = function () {
        notifySelectionChanged();
        return original();
    };
    changeHookInstalled = true;
    console.debug(`[${EXTENSION_NAME}] change hook installed`);
}
