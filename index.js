/**
 * Prepreset: named sub-presets that overlay chat completion parameters and
 * prompt toggles on top of a master preset.
 *
 * The only module that touches SillyTavern globals. The logic lives in
 * src/overlay.js, src/autobound.js, src/fields.js, src/store.js and
 * src/toggles.js, which are unit-tested under plain Node.
 */

import {
    saveSettingsDebounced, eventSource, event_types, chat_metadata, getCurrentChatId, saveMetadata,
} from '/script.js';
import { extension_settings, saveMetadataDebounced } from '/scripts/extensions.js';
import {
    oai_settings, promptManager, settingsToUpdate, openai_setting_names, getPresetApplicationPromise,
} from '/scripts/openai.js';
import { getPresetManager } from '/scripts/preset-manager.js';
import {
    migrate, getActiveSubPreset, setActiveSubPreset, updateSubPresetOverrides, getEnabledFields,
    setEnabledFields, getMode, setMode, MODES,
} from './src/store.js';
import { findOrderEntry, readToggles, applyToggles } from './src/toggles.js';
import { buildCatalogue } from './src/fields.js';
import {
    diffParams, diffToggles, mergeParams, mergeToggles,
    paramsDirty, togglesDirty, releasedOverrides, effectiveValues,
} from './src/overlay.js';
import { injectControlRow, renderControlRow, setRowVisible } from './src/ui.js';
import { installMasterSaveGuard } from './src/guard.js';
import { injectSettingsPanel } from './src/settings-panel.js';
import {
    initAutobound, handleChatChanged, handleLiveValuesEdited, releaseChatOverrides,
    handleMasterRenameBefore, handleMasterRenamed, handleMasterSaved,
} from './src/autobound.js';

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
        readLiveValues,
        applyValuesToLive,
        applyMasterValuesFor,
        enabledParamKeys,
        getCurrentChatId,
        getChatMetadata: () => chat_metadata,
        saveMetadataDebounced,
        saveMetadata,
        toastInfo: (text, title) => toastr.info(text, title, { timeOut: 3000, extendedTimeOut: 1000 }),
        toastWarning: (text, title) => toastr.warning(text, title),
        nextTask: () => new Promise(resolve => setTimeout(resolve, 0)),
        waitForPresetApplication: () => getPresetApplicationPromise(),
        waitUntil,
        setTimer: (run, ms) => setTimeout(run, ms),
        clearTimer: (handle) => clearTimeout(handle),
        isMasterReady,
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
        onAutoboundMasterSave: () => {
            handleMasterSaved().catch(error => console.error(`[${EXTENSION_NAME}] folding chat overrides after save failed`, error));
        },
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
        // Hand whatever the old mode had live back to the master, or it sits
        // there unmanaged and the next master save writes it into the file.
        onModeChanged: (mode) => {
            setRowVisible(mode === MODES.MANUAL);
            if (mode === MODES.AUTOBOUND) {
                releaseActiveSubPreset();
                handleChatChanged();
            } else {
                releaseChatOverrides();
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
        // In Auto-bound, re-apply the open chat rather than recording: a field
        // ticked back on gets its stored override back, where recording the
        // master's value now on screen would delete it.
        onChanged: () => {
            persist();
            notifySelectionChanged();
            if (getMode(getSettings()) === MODES.AUTOBOUND) {
                handleChatChanged({ silent: true });
            }
        },
    });

    // The row only exists in Manual; in Auto-bound it's hidden, and rebuilding it
    // (with a full isDirty read) every slider frame would be wasted.
    onSelectionChanged(() => {
        if (getMode(getSettings()) === MODES.MANUAL) {
            renderControlRow();
        }
    });

    setRowVisible(getMode(getSettings()) === MODES.MANUAL);
    if (getMode(getSettings()) === MODES.AUTOBOUND) {
        // A Manual selection left over from an earlier version isn't live here,
        // and would show as a stale choice on switching back to Manual.
        setActiveSubPreset(getSettings(), getMasterName(), null);
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
        // Picking another master inside a chat rebinds that chat.
        handleLiveValuesEdited({ immediate: true });
    });

    // preset-manager.js awaits this before renamePreset() runs. For Chat
    // Completion, renamePreset stores an empty preset (getPresetSettings has no
    // 'openai' case); the real contents come from the Update preset click
    // SillyTavern fires straight after (preset-manager.js:1077), which reads the
    // live values and never reaches the guard. With a sub-preset or a chat's
    // overrides live, that would bake them into the renamed master, so put the
    // master's own values back first.
    //
    // Nothing re-applies the sub-preset afterwards, on purpose: the rename changes
    // the master's name, so the OAI_PRESET_CHANGED_AFTER handler above resets the
    // selection to Master anyway.
    eventSource.on(event_types.PRESET_RENAMED_BEFORE, ({ apiId, oldName, newName } = {}) => {
        if (apiId !== 'openai') {
            return;
        }
        if (getMode(getSettings()) === MODES.AUTOBOUND) {
            handleMasterRenameBefore(oldName, newName);
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

    // The open chat follows the rename and gets its overrides back. Deliberately
    // not returned: emit awaits every listener, and the overrides have to stay
    // off until SillyTavern's second save (see handleMasterRenamed).
    eventSource.on(event_types.PRESET_RENAMED, ({ apiId, oldName, newName } = {}) => {
        if (apiId !== 'openai' || getMode(getSettings()) !== MODES.AUTOBOUND) {
            return;
        }
        handleMasterRenamed(oldName, newName)
            .catch(error => console.error(`[${EXTENSION_NAME}] re-applying chat preset after rename failed`, error));
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
    return effectiveValues(masterValues, sub, enabledParamKeys());
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

// Manual only: Auto-bound has no unsaved state, since chat edits are recorded
// as they happen. Derived rather than tracked as a flag, so it survives a page
// reload, and over enabled fields only.
export function isDirty() {
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

// Puts the master's own values back for exactly these fields and prompts,
// whether or not they're currently enabled. Used to hand back overrides nothing
// will manage any more; every master save path reads live values, so leaving
// them in place would write them into the preset file.
export function applyMasterValuesFor({ paramKeys = [], toggleIds = [] } = {}) {
    if (paramKeys.length === 0 && toggleIds.length === 0) {
        return true;
    }
    const preset = getMasterPreset();
    if (!preset) {
        return false;
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
    return applyValuesToLive({ params, toggles });
}

// When a field is switched off, the override for it stays live with nothing
// managing it. Put the master's value back for those overrides only; the user's
// other edits are left alone.
function releaseDisabledOverrides(previous, next) {
    const isAutobound = getMode(getSettings()) === MODES.AUTOBOUND;
    const sub = isAutobound ? (chat_metadata?.prepreset ?? null) : getActiveSub();
    if (!sub) {
        return;
    }
    applyMasterValuesFor(releasedOverrides(previous, next, sub));
}

// Leaving Manual: hand the sub-preset's overrides back and clear the selection,
// so coming back starts from Master instead of showing a sub-preset whose values
// aren't live. Only the fields Manual manages were ever applied.
function releaseActiveSubPreset() {
    const sub = getActiveSub();
    if (!sub) {
        return;
    }
    const manualFields = getEnabledFields(getSettings(), MODES.MANUAL);
    const enabled = new Set(manualFields.params);
    applyMasterValuesFor({
        paramKeys: Object.keys(sub.params).filter(key => enabled.has(key)),
        toggleIds: manualFields.toggles ? Object.keys(sub.toggles) : [],
    });
    setActiveSubPreset(getSettings(), getMasterName(), null);
    persist();
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
        // Toggle clicks are discrete, so the chat is saved at once. Prompt text
        // edits pass through here too but change nothing the chat stores, so
        // they don't write the chat file.
        handleLiveValuesEdited({ immediate: true });
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
        handleLiveValuesEdited();
    });
}

// These two are stored in hidden inputs but edited through radio buttons that
// never touch the hidden input (openai.js:7119-7170).
const INDIRECT_PARAM_CONTROLS = [
    'input[name="character_names"]',
    'input[name="continue_postfix"]',
];

// `input` fires continuously during a slider drag, so it only schedules a
// render (and a debounced record). `change` fires once the edit is finished, on
// slider release, select and checkbox, so it records and saves the chat at once.
function installParamChangeListener() {
    const selectors = [...getCatalogue().map(field => field.selector), ...INDIRECT_PARAM_CONTROLS].join(', ');
    $(document).on('input change', selectors, scheduleRender);
    $(document).on('change', selectors, () => handleLiveValuesEdited({ immediate: true }));
}

// Polls until `condition` holds or `timeout` passes. Used where SillyTavern
// finishes something (a preset save) without emitting an event for it.
function waitUntil(condition, { timeout = 10000, interval = 100 } = {}) {
    return new Promise((resolve) => {
        const started = Date.now();
        const check = () => {
            let met = false;
            try {
                met = !!condition();
            } catch {
                // Live settings can be mid-change; try again.
            }
            if (met) {
                resolve(true);
            } else if (Date.now() - started >= timeout) {
                resolve(false);
            } else {
                setTimeout(check, interval);
            }
        };
        check();
    });
}

// A renamed Chat Completion preset stays empty until the follow-up save fills it
// in place (openai.js saveOpenAIPreset), so it's ready once it holds any field
// Prepreset manages.
function isMasterReady() {
    const preset = getMasterPreset({ quiet: true });
    if (!preset) {
        return false;
    }
    return Object.hasOwn(preset, 'prompt_order') || getCatalogue().some(field => Object.hasOwn(preset, field.key));
}
