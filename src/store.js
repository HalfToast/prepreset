/**
 * Storage schema and sub-preset CRUD.
 *
 * Nothing here touches SillyTavern, the DOM, or globals (except `crypto`, and
 * only through newId), so the tests can run it under plain Node. Callers pass
 * the settings object in; this module never reaches for one itself.
 *
 * Accessors hand back live references into settings, so don't mutate what you
 * get back. createSubPreset and updateSubPresetToggles copy the toggles on the
 * way in, so mutating your own toggles object afterwards is safe.
 *
 * Shape: { version, masters: { [name]: { activeSubId, subPresets: [{ id, name, toggles }] } } }
 */

export const SCHEMA_VERSION = 1;

// crypto.randomUUID only exists in a secure context, so it's undefined when
// SillyTavern is reached over plain http from a phone on the LAN. SillyTavern's
// own uuidv4() guards the same way (public/scripts/utils.js:1961); this is a
// local copy to keep the module free of SillyTavern imports.
export function newId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function createDefaultSettings() {
    return { version: SCHEMA_VERSION, masters: {} };
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isValidSubPreset(sub) {
    return isPlainObject(sub)
        && typeof sub.id === 'string' && sub.id.length > 0
        && typeof sub.name === 'string'
        && isPlainObject(sub.toggles);
}

// Coerces anything into a valid settings object. Malformed masters and
// sub-presets are dropped rather than repaired, and an activeSubId that no
// longer resolves is cleared.
//
// If there is ever a v2, check `version` here first. Without that check an old
// v1 object falls through to createDefaultSettings() and the user silently
// loses every sub-preset.
export function migrate(settings) {
    if (!isPlainObject(settings) || !isPlainObject(settings.masters)) {
        return createDefaultSettings();
    }

    const masters = {};

    for (const [name, master] of Object.entries(settings.masters)) {
        if (!isPlainObject(master)) {
            continue;
        }

        const subPresets = Array.isArray(master.subPresets)
            ? master.subPresets.filter(isValidSubPreset).map(sub => ({
                id: sub.id,
                name: sub.name,
                toggles: { ...sub.toggles },
            }))
            : [];

        const activeSubId = subPresets.some(sub => sub.id === master.activeSubId)
            ? master.activeSubId
            : null;

        masters[name] = { activeSubId, subPresets };
    }

    return { version: SCHEMA_VERSION, masters };
}

// Creates the entry if the master doesn't have one yet.
export function getMaster(settings, masterName) {
    if (!isPlainObject(settings.masters[masterName])) {
        settings.masters[masterName] = { activeSubId: null, subPresets: [] };
    }
    return settings.masters[masterName];
}

export function listSubPresets(settings, masterName) {
    return getMaster(settings, masterName).subPresets;
}

export function findSubPreset(settings, masterName, subId) {
    return getMaster(settings, masterName).subPresets.find(sub => sub.id === subId) ?? null;
}

// Null when the master itself is selected.
export function getActiveSubPreset(settings, masterName) {
    const master = getMaster(settings, masterName);
    return master.activeSubId ? findSubPreset(settings, masterName, master.activeSubId) : null;
}

// Pass null to select the master. An id that doesn't resolve does the same
// thing rather than being stored. Returns the id actually stored.
export function setActiveSubPreset(settings, masterName, subId) {
    const master = getMaster(settings, masterName);
    master.activeSubId = master.subPresets.some(sub => sub.id === subId) ? subId : null;
    return master.activeSubId;
}

export function createSubPreset(settings, masterName, name, toggles) {
    const sub = {
        id: newId(),
        name: String(name),
        toggles: { ...toggles },
    };
    getMaster(settings, masterName).subPresets.push(sub);
    return sub;
}

export function renameSubPreset(settings, masterName, subId, newName) {
    const sub = findSubPreset(settings, masterName, subId);
    if (!sub) {
        return null;
    }
    sub.name = String(newName);
    return sub;
}

export function duplicateSubPreset(settings, masterName, subId) {
    const sub = findSubPreset(settings, masterName, subId);
    if (!sub) {
        return null;
    }
    return createSubPreset(settings, masterName, `${sub.name} (copy)`, sub.toggles);
}

export function deleteSubPreset(settings, masterName, subId) {
    const master = getMaster(settings, masterName);
    const index = master.subPresets.findIndex(sub => sub.id === subId);
    if (index === -1) {
        return false;
    }
    master.subPresets.splice(index, 1);
    if (master.activeSubId === subId) {
        master.activeSubId = null;
    }
    return true;
}

export function updateSubPresetToggles(settings, masterName, subId, toggles) {
    const sub = findSubPreset(settings, masterName, subId);
    if (!sub) {
        return null;
    }
    sub.toggles = { ...toggles };
    return sub;
}
