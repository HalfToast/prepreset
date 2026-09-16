/**
 * Pure helpers over SillyTavern's prompt_order.
 *
 * prompt_order is an array of { character_id, order }, where order is an array
 * of { identifier, enabled }. Only one entry is ever used in practice, the one
 * keyed by the Prompt Manager's dummy character id.
 */

// Ids are compared as strings because the stored type isn't consistent, and
// SillyTavern compares them the same way (PromptManager.js:1208).
export function findOrderEntry(promptOrder, dummyId) {
    if (!Array.isArray(promptOrder)) {
        return null;
    }
    return promptOrder.find(entry => !!entry && String(entry.character_id) === String(dummyId)) ?? null;
}

export function readToggles(order) {
    const toggles = {};
    if (!Array.isArray(order)) {
        return toggles;
    }
    for (const entry of order) {
        if (!entry || typeof entry.identifier !== 'string') {
            continue;
        }
        toggles[entry.identifier] = !!entry.enabled;
    }
    return toggles;
}

// Copies the order with enabled states taken from the toggle map. Never adds,
// removes or reorders entries, and never mutates the input.
//
// Identifiers missing from the map keep the state they had. That's what lets a
// prompt added to the master after a sub-preset was saved sit at the master's
// setting instead of switching itself off. Toggles naming an identifier that no
// longer exists are ignored rather than pruned, so they survive a temporary
// edit to the master preset.
export function applyToggles(order, toggles) {
    if (!Array.isArray(order)) {
        return [];
    }
    const map = toggles ?? {};
    return order.map(entry => {
        if (!entry || typeof entry.identifier !== 'string') {
            return { ...entry };
        }
        return Object.hasOwn(map, entry.identifier)
            ? { ...entry, enabled: !!map[entry.identifier] }
            : { ...entry };
    });
}

// Key sets and truthiness, not strict equality.
export function togglesEqual(a, b) {
    const left = a ?? {};
    const right = b ?? {};
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) {
        return false;
    }
    return leftKeys.every(key => Object.hasOwn(right, key) && !!left[key] === !!right[key]);
}
