/**
 * A sub-preset stores only the values that differ from its master. These
 * functions work out what that means for applying, saving and the unsaved
 * marker. None of them mutate their inputs.
 *
 * params maps are keyed by preset key (temperature, openai_max_context).
 * toggles maps are prompt identifier to enabled.
 */

// Deep equality for JSON-like values, in case a future field isn't a primitive.
// NaN equals NaN so a cleared number box doesn't stay dirty forever.
export function valuesEqual(a, b) {
    if (a === b) {
        return true;
    }
    if (typeof a === 'number' && typeof b === 'number') {
        return Number.isNaN(a) && Number.isNaN(b);
    }
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
        return false;
    }
    if (Array.isArray(a) !== Array.isArray(b)) {
        return false;
    }
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) {
        return false;
    }
    return aKeys.every(key => Object.hasOwn(b, key) && valuesEqual(a[key], b[key]));
}

// Override if there is one, otherwise the master's value. Keys neither side
// defines are left out, so the live value stays put, same as SillyTavern does
// for keys a preset omits.
export function effectiveParams(masterParams, overrides, enabledKeys) {
    const master = masterParams ?? {};
    const stored = overrides ?? {};
    const result = {};
    for (const key of enabledKeys) {
        if (Object.hasOwn(stored, key) && stored[key] !== undefined) {
            result[key] = stored[key];
        } else if (master[key] !== undefined) {
            result[key] = master[key];
        }
    }
    return result;
}

// Enabled keys whose live value differs from the master's. Keys the master
// doesn't define are never stored.
export function diffParams(liveParams, masterParams, enabledKeys) {
    const live = liveParams ?? {};
    const master = masterParams ?? {};
    const result = {};
    for (const key of enabledKeys) {
        if (master[key] === undefined || live[key] === undefined) {
            continue;
        }
        if (!valuesEqual(live[key], master[key])) {
            result[key] = live[key];
        }
    }
    return result;
}

// Keeps stored overrides for disabled keys, so switching a field off and saving
// doesn't delete them.
export function mergeParams(storedParams, freshParams, enabledKeys) {
    const enabled = new Set(enabledKeys);
    const result = {};
    for (const [key, value] of Object.entries(storedParams ?? {})) {
        if (!enabled.has(key)) {
            result[key] = value;
        }
    }
    return { ...result, ...(freshParams ?? {}) };
}

export function effectiveToggles(masterToggles, overrides) {
    return { ...(masterToggles ?? {}), ...(overrides ?? {}) };
}

// Only prompts the master has, same rule as diffParams.
export function diffToggles(liveToggles, masterToggles) {
    const live = liveToggles ?? {};
    const master = masterToggles ?? {};
    const result = {};
    for (const [id, enabled] of Object.entries(live)) {
        if (Object.hasOwn(master, id) && !!enabled !== !!master[id]) {
            result[id] = !!enabled;
        }
    }
    return result;
}

// Keeps stored toggles for prompts not on screen, so a temporary edit to the
// master doesn't get them pruned on save.
export function mergeToggles(storedToggles, freshToggles, liveToggles) {
    const live = liveToggles ?? {};
    const result = {};
    for (const [id, enabled] of Object.entries(storedToggles ?? {})) {
        if (!Object.hasOwn(live, id)) {
            result[id] = enabled;
        }
    }
    return { ...result, ...(freshToggles ?? {}) };
}

export function paramsDirty(liveParams, effective, enabledKeys) {
    const live = liveParams ?? {};
    const target = effective ?? {};
    return enabledKeys.some(key => target[key] !== undefined && !valuesEqual(live[key], target[key]));
}

// Only prompts that are on screen and in the effective map count.
export function togglesDirty(liveToggles, effective) {
    const live = liveToggles ?? {};
    const target = effective ?? {};
    return Object.entries(live).some(([id, enabled]) => Object.hasOwn(target, id) && !!enabled !== !!target[id]);
}

// Overrides that stop being managed when enabled fields go from previous to
// next: newly disabled param keys the sub-preset overrides, plus all its toggles
// if prompt toggles were switched off.
export function releasedOverrides(previous, next, sub) {
    const stillEnabled = new Set(next?.params ?? []);
    const params = sub?.params ?? {};
    const paramKeys = (previous?.params ?? [])
        .filter(key => !stillEnabled.has(key) && Object.hasOwn(params, key));
    const toggleIds = previous?.toggles && !next?.toggles
        ? Object.keys(sub?.toggles ?? {})
        : [];
    return { paramKeys, toggleIds };
}
