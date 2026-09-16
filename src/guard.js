/**
 * Guards the master preset's "Update preset" button.
 *
 * With a sub-preset active the live prompt toggles are the sub-preset's, not
 * the master's, so saving the master in that state would bake them into the
 * master preset file. This intercepts the click and asks which set to save.
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

// api: { getActiveSub, readMasterToggles, applyTogglesToLive }
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

        const active = api.getActiveSub();
        if (!active) {
            return;
        }

        event.stopImmediatePropagation();

        const safeName = escapeHtml(active.name);
        const result = await new Popup(
            `The sub-preset <b>${safeName}</b> is active, so the live prompt toggles are its toggles, not the master preset's.<br><br>Which toggles should be saved into the master preset?`,
            POPUP_TYPE.TEXT,
            '',
            {
                okButton: 'Master\'s own toggles',
                cancelButton: 'Cancel',
                // Rendered with textContent (popup.js:308), so this one must NOT be
                // escaped or the entities show up literally.
                customButtons: [`"${active.name}" toggles`],
            },
        ).show();

        // A string custom button resolves to `index + 2` (popup.js:290), so the
        // single one here is 2. Cancel gives null or 0 and falls through.
        if (result === POPUP_RESULT.AFFIRMATIVE) {
            const masterToggles = api.readMasterToggles();
            if (!masterToggles) {
                return;
            }
            if (!api.applyTogglesToLive(masterToggles)) {
                // Live toggles are still the sub-preset's, so redispatching would
                // save exactly what the user just chose against.
                toastr.error('Could not apply the master\'s toggles; save aborted', 'Prepreset');
                return;
            }
            redispatch(button);
            // Put the user back where they were, sub-preset still active.
            api.applyTogglesToLive(active.toggles);
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
