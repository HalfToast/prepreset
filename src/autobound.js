/**
 * Autobound Mode: Automatically binds and applies master presets and
 * prompt/parameter overrides per chat using SillyTavern's chat_metadata.
 */

import { effectiveParams, effectiveToggles } from './overlay.js';

const BADGE_ID = 'prepreset_chat_badge';

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

export function resolveEffectiveChatValues(masterValues, chatOverrides, enabledParamKeys) {
    const master = masterValues ?? {};
    const overrides = chatOverrides ?? {};
    const params = effectiveParams(master.params, overrides.params, enabledParamKeys);
    const toggles = master.toggles === null
        ? null
        : effectiveToggles(master.toggles, overrides.toggles);
    return { params, toggles };
}

let api = null;
let isApplying = false;

export function getIsApplying() {
    return isApplying;
}

export function setIsApplying(value) {
    isApplying = !!value;
}

export function initAutobound(autoboundApi) {
    api = autoboundApi;
}

export function hideChatBadge() {
    if (typeof document === 'undefined') {
        return;
    }
    const badge = document.getElementById(BADGE_ID);
    if (badge) {
        badge.remove();
    }
}

export async function handleChatChanged() {
    hideChatBadge();

    if (!api || api.getMode() !== 'autobound' || !api.getCurrentChatId()) {
        return;
    }

    const chatMetadata = api.getChatMetadata();
    if (!chatMetadata) {
        return;
    }

    const chatPreset = chatMetadata.prepreset;
    if (chatPreset && typeof chatPreset === 'object' && chatPreset.master) {
        if (chatPreset.master !== api.getMasterName()) {
            isApplying = true;
            try {
                const switched = await api.selectMasterPreset(chatPreset.master);
                if (!switched && api.toastWarning) {
                    api.toastWarning(`Master preset "${chatPreset.master}" not found; keeping "${api.getMasterName()}"`, 'Prepreset');
                }
            } finally {
                isApplying = false;
            }
        }

        isApplying = true;
        try {
            const masterValues = api.readMasterValues({ quiet: true });
            const effective = resolveEffectiveChatValues(masterValues, chatPreset, api.enabledParamKeys());
            api.applyValuesToLive(effective);
            const overrideCount = countOverrides(chatPreset);
            const message = formatIndicatorText(api.getMasterName(), overrideCount);
            if (api.toastInfo) {
                api.toastInfo(message, 'Prepreset');
            }
        } finally {
            isApplying = false;
        }
    } else {
        isApplying = true;
        try {
            const masterValues = api.readMasterValues({ quiet: true });
            if (masterValues) {
                api.applyValuesToLive(masterValues);
            }
            chatMetadata.prepreset = {
                master: api.getMasterName(),
                params: {},
                toggles: {},
            };
            if (api.saveMetadataDebounced) {
                api.saveMetadataDebounced();
            }
            const message = formatIndicatorText(api.getMasterName(), 0);
            if (api.toastInfo) {
                api.toastInfo(message, 'Prepreset');
            }
        } finally {
            isApplying = false;
        }
    }
}

export function handleLiveValuesEdited() {
    if (isApplying || !api || api.getMode() !== 'autobound' || !api.getCurrentChatId()) {
        return;
    }

    const diff = api.diffLiveAgainstMaster();
    if (!diff) {
        return;
    }

    const chatMetadata = api.getChatMetadata();
    if (!chatMetadata) {
        return;
    }

    chatMetadata.prepreset = {
        master: api.getMasterName(),
        params: diff.params ?? {},
        toggles: diff.toggles ?? {},
    };

    if (api.saveMetadataDebounced) {
        api.saveMetadataDebounced();
    }
}
