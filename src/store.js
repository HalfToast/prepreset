/**
 * Storage schema and sub-preset CRUD.
 *
 * No SillyTavern, no DOM, and no globals beyond crypto and structuredClone, so
 * the tests can run it under plain Node. Callers pass the settings object in.
 *
 * Accessors hand back live references into settings, so don't mutate what you
 * get back. createSubPreset and updateSubPresetOverrides copy on the way in, so
 * mutating your own maps afterwards is safe.
 *
 * Shape (v2):
 * {
 *   version: 2,
 *   enabledFields: { toggles: boolean, params: string[] },
 *   masters: { [name]: { activeSubId, subPresets: [{ id, name, params, toggles }] } },
 * }
 *
 * params and toggles hold only what differs from the master.
 */

export const SCHEMA_VERSION = 2;

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

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Prompt toggles on, no parameters: identical to 1.1 until the user opts in.
function sanitizeEnabledFields(fields) {
    const raw = isPlainObject(fields) ? fields : {};
    const params = Array.isArray(raw.params)
        ? [...new Set(raw.params.filter(key => typeof key === 'string' && key.length > 0))]
        : [];
    return {
        toggles: typeof raw.toggles === 'boolean' ? raw.toggles : true,
        params,
    };
}

// Parameter values are copied deeply; nothing guarantees they stay primitives.
function copyParams(params) {
    const result = {};
    if (!isPlainObject(params)) {
        return result;
    }
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
            result[key] = structuredClone(value);
        }
    }
    return result;
}

function copyToggles(toggles) {
    return isPlainObject(toggles) ? { ...toggles } : {};
}

export function createDefaultSettings() {
    return { version: SCHEMA_VERSION, enabledFields: sanitizeEnabledFields(undefined), masters: {} };
}

function isValidSubPreset(sub) {
    return isPlainObject(sub)
        && typeof sub.id === 'string' && sub.id.length > 0
        && typeof sub.name === 'string'
        && isPlainObject(sub.toggles);
}

// Coerces anything into valid v2 settings. Malformed masters and sub-presets are
// dropped rather than repaired, and an activeSubId that no longer resolves is
// cleared.
//
// v1 sub-presets get an empty params map and keep their full toggle map, so
// they behave as they did in 1.1 until the next save rewrites toggles as a
// diff. v2 only adds to v1, so both go through the same code.
//
// A v3 that changes the shape needs to branch on `version` first, or older data
// will be lost here.
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
                params: copyParams(sub.params),
                toggles: copyToggles(sub.toggles),
            }))
            : [];

        const activeSubId = subPresets.some(sub => sub.id === master.activeSubId)
            ? master.activeSubId
            : null;

        masters[name] = { activeSubId, subPresets };
    }

    return {
        version: SCHEMA_VERSION,
        enabledFields: sanitizeEnabledFields(settings.enabledFields),
        masters,
    };
}

// Creates the defaults if they're missing.
export function getEnabledFields(settings) {
    if (!isPlainObject(settings.enabledFields)) {
        settings.enabledFields = sanitizeEnabledFields(undefined);
    }
    return settings.enabledFields;
}

export function setEnabledFields(settings, fields) {
    settings.enabledFields = sanitizeEnabledFields(fields);
    return settings.enabledFields;
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

export function createSubPreset(settings, masterName, name, overrides) {
    const sub = {
        id: newId(),
        name: String(name),
        params: copyParams(overrides?.params),
        toggles: copyToggles(overrides?.toggles),
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
    return createSubPreset(settings, masterName, `${sub.name} (copy)`, { params: sub.params, toggles: sub.toggles });
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

export function updateSubPresetOverrides(settings, masterName, subId, overrides) {
    const sub = findSubPreset(settings, masterName, subId);
    if (!sub) {
        return null;
    }
    sub.params = copyParams(overrides?.params);
    sub.toggles = copyToggles(overrides?.toggles);
    return sub;
}
