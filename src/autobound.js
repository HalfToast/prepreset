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
        return {
            toastText: `Applied preset: <b>${name}</b>`,
            badgeText: name,
        };
    }
    const countText = overrideCount === 1 ? '1 override' : `${overrideCount} overrides`;
    return {
        toastText: `Applied preset: <b>${name}</b> (${countText})`,
        badgeText: `${name} (${overrideCount})`,
    };
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

export function renderChatBadge(badgeText, tooltipText) {
    if (typeof document === 'undefined') {
        return;
    }

    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
        badge = document.createElement('span');
        badge.id = BADGE_ID;
        badge.classList.add('prepreset_chat_badge');
        badge.addEventListener('click', () => {
            const drawerIcon = document.getElementById('leftNavDrawerIcon');
            if (drawerIcon) {
                drawerIcon.click();
            }
        });
        const container = document.getElementById('top-bar')
            || document.getElementById('sheldheader')
            || document.getElementById('sheld');
        if (container) {
            container.append(badge);
        }
    }

    if (!api || api.getMode() !== 'autobound' || !api.getCurrentChatId()) {
        badge.style.display = 'none';
        return;
    }

    badge.style.display = 'inline-flex';
    badge.title = tooltipText || '';
    badge.innerHTML = `<i class="fa-solid fa-sliders"></i> <span>${api.escapeHtml ? api.escapeHtml(badgeText) : badgeText}</span>`;
}

export function hideChatBadge() {
    if (typeof document === 'undefined') {
        return;
    }
    const badge = document.getElementById(BADGE_ID);
    if (badge) {
        badge.style.display = 'none';
    }
}

export async function handleChatChanged() {
    if (!api || api.getMode() !== 'autobound' || !api.getCurrentChatId()) {
        hideChatBadge();
        return;
    }

    const chatMetadata = api.getChatMetadata();
    if (!chatMetadata) {
        hideChatBadge();
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
            const { toastText, badgeText } = formatIndicatorText(api.getMasterName(), overrideCount);
            if (api.toastInfo) {
                api.toastInfo(toastText, 'Prepreset');
            }
            renderChatBadge(badgeText, `Prepreset (Auto-bound): ${overrideCount} overrides active`);
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
            const { toastText, badgeText } = formatIndicatorText(api.getMasterName(), 0);
            if (api.toastInfo) {
                api.toastInfo(toastText, 'Prepreset');
            }
            renderChatBadge(badgeText, 'Prepreset (Auto-bound): clean master preset active');
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

    const count = countOverrides(diff);
    const { badgeText } = formatIndicatorText(api.getMasterName(), count);
    renderChatBadge(badgeText, `Prepreset (Auto-bound): ${count} overrides active`);
}
