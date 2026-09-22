/**
 * Guards the master preset's "Update preset" button.
 *
 * With a sub-preset active the live values are the sub-preset's, not the
 * master's, so saving the master in that state would bake them into the master
 * preset file. This intercepts the click and asks which set to save. Only the
 * fields sub-presets manage are swapped; everything else is saved as it is.
 *
 * Renaming a master used to leak the same way, but that write happens inside
 * preset-manager.js before any click listener sees an event. It's handled by
 * the PRESET_RENAMED_BEFORE listener in index.js instead.
 */

import { Popup, POPUP_TYPE, POPUP_RESULT } from '/scripts/popup.js';
import { escapeHtml } from './escape.js';

const BUTTON_SELECTOR = '#update_oai_preset';

// Set while re-dispatching our own click, so we don't intercept it again.
let bypass = false;
let installed = false;

// api: { getActiveSub, isDirty, readLiveValues, readMasterValues, applyValuesToLive }
export function installMasterSaveGuard(api) {
    if (installed) {
        return;
    }
    installed = true;

    document.addEventListener('click', async (event) => {
        if (bypass) {
            return;
        }

        const button = event.target instanceof Element
            ? event.target.closest(BUTTON_SELECTOR)
            : null;
        if (!button) {
            return;
        }

        const isAutobound = api.getMode && api.getMode() === 'autobound';
        const hasActiveChat = api.hasActiveChat ? api.hasActiveChat() : true;
        const active = api.getActiveSub();
        const dirty = api.isDirty();

        if (!active && !(isAutobound && hasActiveChat && dirty)) {
            return;
        }

        event.stopImmediatePropagation();

        // Restore what's on screen afterwards, not what's stored, or unsaved
        // edits would be lost.
        const liveValues = api.readLiveValues();

        let body;
        let customButtonLabel;

        if (isAutobound) {
            body = 'This chat has local preset overrides active, so the live values differ from the master preset.<br><br>Which values should be saved into the master preset?';
            customButtonLabel = 'Current chat values';
        } else {
            const safeName = escapeHtml(active ? active.name : '');
            body = dirty
                ? `The sub-preset <b>${safeName}</b> is active and has unsaved changes, so the live values are neither the master preset's nor what <b>${safeName}</b> has stored.<br><br>Which values should be saved into the master preset?`
                : `The sub-preset <b>${safeName}</b> is active, so the live values are its values, not the master preset's.<br><br>Which values should be saved into the master preset?`;
            customButtonLabel = dirty ? 'Current values' : `"${active.name}" values`;
        }

        const result = await new Popup(
            body,
            POPUP_TYPE.TEXT,
            '',
            {
                okButton: 'Master\'s own values',
                cancelButton: 'Cancel',
                // Rendered with textContent (popup.js:308), so this one must NOT be
                // escaped or the entities show up literally.
                customButtons: [customButtonLabel],
            },
        ).show();

        // A string custom button resolves to `index + 2` (popup.js:290), so the
        // single one here is 2. Cancel gives null or 0 and falls through.
        if (result === POPUP_RESULT.AFFIRMATIVE) {
            if (!liveValues) {
                // Nothing to restore afterwards, so don't start.
                toastr.error('Could not read the current values; save aborted', 'Prepreset');
                return;
            }
            const masterValues = api.readMasterValues();
            if (!masterValues) {
                return;
            }
            if (!api.applyValuesToLive(masterValues)) {
                // Live values are still the sub-preset's, so redispatching would
                // save exactly what the user just chose against.
                toastr.error('Could not apply the master\'s values; save aborted', 'Prepreset');
                return;
            }
            redispatch(button);
            // Put the user back exactly where they were, unsaved edits included.
            api.applyValuesToLive(liveValues);
            return;
        }

        if (result === 2) {
            redispatch(button);
        }
    }, true);
}

// Fires a real click that reaches SillyTavern's own handler.
function redispatch(button) {
    bypass = true;
    try {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } finally {
        bypass = false;
    }
}
