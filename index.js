/**
 * Prepreset: named sub-presets that overlay chat completion parameters and
 * prompt toggles on top of a master preset.
 *
 * The only module that touches SillyTavern globals. The logic lives in
 * src/overlay.js, src/fields.js, src/store.js and src/toggles.js, which are
 * unit-tested under plain Node.
 */

import { saveSettingsDebounced, eventSource, event_types, chat_metadata, getCurrentChatId } from '/script.js';
import { extension_settings, saveMetadataDebounced } from '/scripts/extensions.js';
import { oai_settings, promptManager, settingsToUpdate, openai_setting_names } from '/scripts/openai.js';
import { getPresetManager } from '/scripts/preset-manager.js';
import {
    migrate, getActiveSubPreset, setActiveSubPreset, updateSubPresetOverrides, getEnabledFields,
    setEnabledFields, getMode, setMode, MODES,
} from './src/store.js';
import { findOrderEntry, readToggles, applyToggles } from './src/toggles.js';
import { buildCatalogue } from './src/fields.js';
import {
    effectiveParams, effectiveToggles, diffParams, diffToggles, mergeParams, mergeToggles,
    paramsDirty, togglesDirty, releasedOverrides,
} from './src/overlay.js';
import { injectControlRow, renderControlRow, setRowVisible } from './src/ui.js';
import { installMasterSaveGuard } from './src/guard.js';
import { injectSettingsPanel } from './src/settings-panel.js';
import {
    initAutobound, handleChatChanged, handleLiveValuesEdited,
    getIsApplying, hideChatBadge,
} from './src/autobound.js';
import { escapeHtml } from './src/escape.js';

export const EXTENSION_KEY = 'prepreset';
export const EXTENSION_NAME = 'Prepreset';

let initCalled = false;

export function getSettings() {
    return extension_settings[EXTENSION_KEY];
}

// Queues a write of settings.json. That covers extension_settings, where the
// sub-presets live, and the oai_settings values applyValuesToLive changes.
export function persist() {
    saveSettingsDebounced();
}

export async function selectMasterPreset(presetName) {
    const presetManager = getPresetManager('openai');
    if (!presetManager) {
        return false;
    }
    const presetValue = presetManager.findPreset(presetName);
    if (!presetValue) {
        return false;
    }
    await presetManager.selectPreset(presetValue);
    return true;
}

// Entry point, called via the 'activate' manifest hook.
export async function init() {
    if (initCalled) {
        return;
    }
    initCalled = true;

    extension_settings[EXTENSION_KEY] = migrate(extension_settings[EXTENSION_KEY]);

    initAutobound({
        getMode: () => getMode(getSettings()),
        getMasterName,
        selectMasterPreset,
        readMasterValues,
        applyValuesToLive,
        diffLiveAgainstMaster,
        enabledParamKeys,
        getCurrentChatId,
        getChatMetadata: () => chat_metadata,
        saveMetadataDebounced,
        toastInfo: (text, title) => toastr.info(text, title, { timeOut: 3000, extendedTimeOut: 1000 }),
        toastWarning: (text, title) => toastr.warning(text, title),
        escapeHtml,
    });

    installChangeHook();
    installParamChangeListener();

    injectControlRow({
        getSettings,
        getMasterName,
        getActiveSub,
        selectSubPreset,
        diffLiveAgainstMaster,
        isDirty,
        saveActiveSubPreset,
        persist,
    });

    installMasterSaveGuard({
        getMode: () => getMode(getSettings()),
        hasActiveChat: () => Boolean(getCurrentChatId()),
        getActiveSub,
        isDirty,
        readLiveValues,
        readMasterValues,
        applyValuesToLive,
    });

    // Enabling a field applies nothing, so ticking a box never moves a slider.
    // If the live value disagrees with the sub-preset, the unsaved marker shows it.
    injectSettingsPanel({
        getCatalogue,
        getMode: () => getMode(getSettings()),
        setMode: (mode) => {
            setMode(getSettings(), mode);
            persist();
        },
        onModeChanged: (mode) => {
            setRowVisible(mode === MODES.MANUAL);
            if (mode === MODES.AUTOBOUND) {
                handleChatChanged();
            } else {
                hideChatBadge();
                renderControlRow();
            }
        },
        getEnabledFields: () => getEnabledFields(getSettings()),
        setEnabledFields: (fields) => {
            const current = getEnabledFields(getSettings());
            const previous = { toggles: current.toggles, params: [...current.params] };
            const next = setEnabledFields(getSettings(), fields);
            releaseDisabledOverrides(previous, next);
            return next;
        },
        onChanged: () => {
            persist();
            notifySelectionChanged();
            if (getMode(getSettings()) === MODES.AUTOBOUND && !getIsApplying()) {
                handleLiveValuesEdited();
            }
        },
    });

    onSelectionChanged(renderControlRow);

    setRowVisible(getMode(getSettings()) === MODES.MANUAL);
    if (getMode(getSettings()) === MODES.AUTOBOUND) {
        handleChatChanged();
    }

    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (getMode(getSettings()) === MODES.AUTOBOUND) {
            handleChatChanged();
        }
    });

    eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
        installChangeHook();
        // The new preset file has just been applied, so live values already equal
        // the new master's own. Reset the selection rather than silently
        // re-applying a remembered sub-preset.
        setActiveSubPreset(getSettings(), getMasterName(), null);
        persist();
        notifySelectionChanged();
        if (getMode(getSettings()) === MODES.AUTOBOUND && !getIsApplying()) {
            handleLiveValuesEdited();
        }
    });

    // preset-manager.js awaits this before renamePreset() runs, and renamePreset
    // saves the renamed preset from live oai_settings as its first act, before any
    // click the guard could intercept. With a sub-preset active that save would
    // bake its values into the master file under the new name, so put the
    // master's own values back first.
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
        const masterValues = readMasterValues();
        if (!masterValues) {
            return;
        }
        applyValuesToLive(masterValues);
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

let catalogue = null;

export function getCatalogue() {
    if (!catalogue) {
        catalogue = buildCatalogue(settingsToUpdate);
    }
    return catalogue;
}

// Enabled fields this SillyTavern has controls for. An enabled key it doesn't
// know stays in settings but counts as disabled here, so a save won't drop its
// stored override.
function enabledParamFields() {
    const enabled = new Set(getEnabledFields(getSettings()).params);
    return getCatalogue().filter(field => enabled.has(field.key));
}

function enabledParamKeys() {
    return enabledParamFields().map(field => field.key);
}

function togglesEnabled() {
    return getEnabledFields(getSettings()).toggles;
}

// The master preset as stored in SillyTavern's preset list, so "no sub-preset"
// reflects the master as saved rather than a cached copy.
function getMasterPreset({ quiet = false } = {}) {
    // getCompletionPresetByName logs an error itself for a missing name, and this
    // runs every render, so check the name first.
    if (openai_setting_names?.[getMasterName()] === undefined) {
        if (!quiet) {
            toastr.error(`Could not read the master preset "${getMasterName()}"`, EXTENSION_NAME);
        }
        return null;
    }
    const preset = getPresetManager('openai')?.getCompletionPresetByName(getMasterName());
    if (!preset && !quiet) {
        toastr.error(`Could not read the master preset "${getMasterName()}"`, EXTENSION_NAME);
    }
    return preset ?? null;
}

// Null if the Prompt Manager isn't ready. Pass quiet for callers that run on
// every render, like isDirty(), where a warning per frame would be a stream.
export function readLiveToggles({ quiet = false } = {}) {
    const dummyId = getDummyId();
    if (dummyId === null) {
        if (!quiet) {
            console.warn(`[${EXTENSION_NAME}] Prompt Manager not ready`);
        }
        return null;
    }
    const entry = findOrderEntry(oai_settings.prompt_order, dummyId);
    if (!entry) {
        if (!quiet) {
            const message = `No prompt order for dummy id ${dummyId}`;
            console.warn(`[${EXTENSION_NAME}] ${message}`);
            toastr.warning(message, EXTENSION_NAME);
        }
        return null;
    }
    return readToggles(entry.order);
}

export function readMasterToggles({ quiet = false } = {}) {
    const dummyId = getDummyId();
    if (dummyId === null) {
        return null;
    }
    const preset = getMasterPreset({ quiet });
    if (!preset) {
        return null;
    }
    const entry = findOrderEntry(preset.prompt_order, dummyId);
    if (!entry) {
        if (!quiet) {
            const message = `Master preset "${getMasterName()}" has no prompt order for dummy id ${dummyId}`;
            console.warn(`[${EXTENSION_NAME}] ${message}`);
            toastr.warning(message, EXTENSION_NAME);
        }
        return null;
    }
    return readToggles(entry.order);
}

// { params, toggles } for enabled fields. Null if either half can't be read;
// toggles is null (not a failure) when prompt toggles are disabled.
//
// Reads oai_settings directly because getChatCompletionPreset clones every
// field, prompt text included, and this runs on every render.
export function readLiveValues({ quiet = false } = {}) {
    let toggles = null;
    if (togglesEnabled()) {
        toggles = readLiveToggles({ quiet });
        if (!toggles) {
            return null;
        }
    }
    const params = {};
    for (const field of enabledParamFields()) {
        const value = oai_settings[field.settingKey];
        if (value !== undefined) {
            params[field.key] = value;
        }
    }
    return { params, toggles };
}

export function readMasterValues({ quiet = false } = {}) {
    const preset = getMasterPreset({ quiet });
    if (!preset) {
        return null;
    }
    let toggles = null;
    if (togglesEnabled()) {
        toggles = readMasterToggles({ quiet });
        if (!toggles) {
            return null;
        }
    }
    const params = {};
    for (const field of enabledParamFields()) {
        if (preset[field.key] !== undefined) {
            params[field.key] = preset[field.key];
        }
    }
    return { params, toggles };
}

// Clone objects so live settings never share a reference with a stored
// override or the in-memory master preset.
function copyValue(value) {
    return typeof value === 'object' && value !== null ? structuredClone(value) : value;
}

// Same steps as onSettingsPresetChange (openai.js:5045-5064): set the control,
// fire input so counters and labels update, then assign oai_settings directly,
// because a range input clamps .val() to its bounds.
//
// Deliberately emits no preset events. OAI_PRESET_CHANGED_AFTER resets the
// selection, which would undo this apply. Readiness is checked up front so a
// failure can't leave half the values applied.
export function applyValuesToLive(values) {
    if (!values) {
        return false;
    }
    installChangeHook();

    let entry = null;
    if (values.toggles) {
        const dummyId = getDummyId();
        entry = dummyId === null ? null : findOrderEntry(oai_settings.prompt_order, dummyId);
        if (!entry) {
            console.warn(`[${EXTENSION_NAME}] Prompt Manager not ready; nothing applied`);
            return false;
        }
    }

    const params = values.params ?? {};
    let biasApplied = false;
    for (const field of getCatalogue()) {
        if (!Object.hasOwn(params, field.key) || params[field.key] === undefined) {
            continue;
        }
        const value = copyValue(params[field.key]);
        const $control = $(field.selector);
        if (field.isCheckbox) {
            $control.prop('checked', value).trigger('input', { source: 'preset' });
        } else {
            $control.val(value).trigger('input', { source: 'preset' });
        }
        oai_settings[field.settingKey] = value;
        if (field.key === 'bias_preset_selected') {
            biasApplied = true;
        }
    }
    if (biasApplied) {
        $('#openai_logit_bias_preset').trigger('change');
    }

    if (entry) {
        entry.order = applyToggles(entry.order, values.toggles);
        promptManager?.render(false);
    }

    persist();
    return true;
}

const selectionListeners = [];

export function onSelectionChanged(callback) {
    selectionListeners.push(callback);
}

export function notifySelectionChanged() {
    for (const callback of selectionListeners) {
        callback();
    }
}

// Null when the master is selected.
export function getActiveSub() {
    return getActiveSubPreset(getSettings(), getMasterName());
}

function effectiveValuesFor(masterValues, sub) {
    const keys = enabledParamKeys();
    return {
        params: effectiveParams(masterValues.params, sub.params, keys),
        toggles: masterValues.toggles === null ? null : effectiveToggles(masterValues.toggles, sub.toggles),
    };
}

// Null selects the master. Every enabled field the target doesn't override gets
// the master's value, so switching from A to B doesn't leave A's overrides
// behind. If the master can't be read, the selection still moves but nothing is
// applied (readMasterValues already warned).
export function selectSubPreset(subId) {
    const masterName = getMasterName();
    const storedId = setActiveSubPreset(getSettings(), masterName, subId);
    const sub = storedId ? getActiveSub() : null;
    const masterValues = readMasterValues();

    if (masterValues) {
        applyValuesToLive(sub ? effectiveValuesFor(masterValues, sub) : masterValues);
    }

    persist();
    notifySelectionChanged();
}

// Derived rather than tracked as a flag, so it survives a page reload:
// SillyTavern persists live settings, and nothing touches the sub-preset until
// the user saves. Enabled fields only.
export function isDirty() {
    if (getMode(getSettings()) === MODES.AUTOBOUND) {
        if (!getCurrentChatId()) {
            return false;
        }
        const live = readLiveValues({ quiet: true });
        const master = readMasterValues({ quiet: true });
        if (!live || !master) {
            return false;
        }
        if (paramsDirty(live.params, master.params, enabledParamKeys())) {
            return true;
        }
        return live.toggles !== null && master.toggles !== null && togglesDirty(live.toggles, master.toggles);
    }
    const sub = getActiveSub();
    if (!sub) {
        return false;
    }
    const live = readLiveValues({ quiet: true });
    const master = readMasterValues({ quiet: true });
    if (!live || !master) {
        return false;
    }
    const effective = effectiveValuesFor(master, sub);
    if (paramsDirty(live.params, effective.params, enabledParamKeys())) {
        return true;
    }
    return live.toggles !== null && togglesDirty(live.toggles, effective.toggles);
}

// How the live values differ from the master, for enabled fields. Used by New.
export function diffLiveAgainstMaster() {
    const live = readLiveValues();
    const master = readMasterValues();
    if (!live || !master) {
        return null;
    }
    return {
        params: diffParams(live.params, master.params, enabledParamKeys()),
        toggles: live.toggles === null ? {} : diffToggles(live.toggles, master.toggles),
    };
}

// Stores only what differs from the master. Overrides for disabled fields are
// kept, so disabling a field and saving doesn't delete anything.
export function saveActiveSubPreset() {
    const sub = getActiveSub();
    if (!sub) {
        return false;
    }
    const live = readLiveValues();
    const master = readMasterValues();
    if (!live || !master) {
        return false;
    }
    const keys = enabledParamKeys();
    updateSubPresetOverrides(getSettings(), getMasterName(), sub.id, {
        params: mergeParams(sub.params, diffParams(live.params, master.params, keys), keys),
        toggles: live.toggles === null
            ? sub.toggles
            : mergeToggles(sub.toggles, diffToggles(live.toggles, master.toggles), live.toggles),
    });
    persist();
    notifySelectionChanged();
    return true;
}

// When a field is switched off, the sub-preset's override stays live with
// nothing managing it. Every master save path only swaps managed fields, so that
// value would end up in the master preset file. Put the master's value back for
// those overrides only; the user's other edits are left alone.
function releaseDisabledOverrides(previous, next) {
    const isAutobound = getMode(getSettings()) === MODES.AUTOBOUND;
    const sub = isAutobound ? (chat_metadata?.prepreset ?? null) : getActiveSub();
    if (!sub) {
        return;
    }
    const { paramKeys, toggleIds } = releasedOverrides(previous, next, sub);
    if (paramKeys.length === 0 && toggleIds.length === 0) {
        return;
    }
    const preset = getMasterPreset();
    if (!preset) {
        return;
    }
    const params = {};
    for (const key of paramKeys) {
        if (preset[key] !== undefined) {
            params[key] = preset[key];
        }
    }
    let toggles = null;
    if (toggleIds.length > 0) {
        const masterToggles = readMasterToggles();
        if (masterToggles) {
            toggles = {};
            for (const id of toggleIds) {
                if (Object.hasOwn(masterToggles, id)) {
                    toggles[id] = masterToggles[id];
                }
            }
        }
    }
    applyValuesToLive({ params, toggles });
}

// Every PromptManager mutation goes through saveServiceSettings, so wrapping it
// catches every toggle change. It only re-renders the row for the unsaved marker.
let changeHookInstalled = false;

function installChangeHook() {
    if (changeHookInstalled || !promptManager) {
        return;
    }
    const original = promptManager.saveServiceSettings.bind(promptManager);
    promptManager.saveServiceSettings = function () {
        notifySelectionChanged();
        if (getMode(getSettings()) === MODES.AUTOBOUND && !getIsApplying()) {
            handleLiveValuesEdited();
        }
        return original();
    };
    changeHookInstalled = true;
    console.debug(`[${EXTENSION_NAME}] change hook installed`);
}

// Parameter controls save through their own handlers, so the change hook never
// sees them. This has to be jQuery delegation: the counter boxes update sliders
// with .trigger('input'), which doesn't fire a native event. Renders are
// batched per animation frame since a dragged slider fires constantly.
let renderScheduled = false;

function scheduleRender() {
    if (renderScheduled) {
        return;
    }
    renderScheduled = true;
    requestAnimationFrame(() => {
        renderScheduled = false;
        notifySelectionChanged();
        if (getMode(getSettings()) === MODES.AUTOBOUND && !getIsApplying()) {
            handleLiveValuesEdited();
        }
    });
}

// These two are stored in hidden inputs but edited through radio buttons that
// never touch the hidden input (openai.js:7119-7170).
const INDIRECT_PARAM_CONTROLS = [
    'input[name="character_names"]',
    'input[name="continue_postfix"]',
];

function installParamChangeListener() {
    const selectors = [...getCatalogue().map(field => field.selector), ...INDIRECT_PARAM_CONTROLS].join(', ');
    $(document).on('input change', selectors, scheduleRender);
}
