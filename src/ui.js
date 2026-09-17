/**
 * The control row: a sub-preset dropdown plus save/new/rename/duplicate/delete
 * buttons, under the master preset dropdown. Owns no state; everything arrives
 * through the `api` object passed to injectControlRow.
 */

import { Popup } from '/scripts/popup.js';
import {
    listSubPresets, createSubPreset, renameSubPreset, duplicateSubPreset,
    deleteSubPreset,
} from './store.js';
import { escapeHtml } from './escape.js';

const ROW_ID = 'prepreset_row';
const SELECT_ID = 'prepreset_select';
const MASTER_VALUE = '';

// { getSettings, getMasterName, getActiveSub, selectSubPreset, diffLiveAgainstMaster,
//   isDirty, saveActiveSubPreset, persist }
let api = null;

// Safe to call repeatedly.
export function injectControlRow(uiApi) {
    api = uiApi;

    if (document.getElementById(ROW_ID)) {
        renderControlRow();
        return;
    }

    // The master preset dropdown's row (public/index.html:198). Being inside the
    // Chat Completion block means we hide with it when another API is selected.
    const anchor = document.getElementById('settings_preset_openai')?.parentElement;
    if (!anchor) {
        console.warn('[Prepreset] #settings_preset_openai not found; control row not injected');
        return;
    }

    const row = document.createElement('div');
    row.id = ROW_ID;
    row.classList.add('flex-container');
    row.innerHTML = `
        <select id="${SELECT_ID}" class="text_pole" title="Sub-preset"></select>
        <div id="prepreset_save" class="menu_button menu_button_icon" title="Save values into this sub-preset">
            <i class="fa-fw fa-solid fa-save"></i>
        </div>
        <div id="prepreset_new" class="menu_button menu_button_icon" title="New sub-preset from current values">
            <i class="fa-fw fa-solid fa-plus"></i>
        </div>
        <div id="prepreset_rename" class="menu_button menu_button_icon" title="Rename sub-preset">
            <i class="fa-fw fa-solid fa-pencil"></i>
        </div>
        <div id="prepreset_duplicate" class="menu_button menu_button_icon" title="Duplicate sub-preset">
            <i class="fa-fw fa-solid fa-copy"></i>
        </div>
        <div id="prepreset_delete" class="menu_button menu_button_icon" title="Delete sub-preset">
            <i class="fa-fw fa-solid fa-trash-can"></i>
        </div>
    `;

    anchor.insertAdjacentElement('afterend', row);

    document.getElementById(SELECT_ID).addEventListener('change', onSelectChanged);
    document.getElementById('prepreset_save').addEventListener('click', onSaveClicked);
    document.getElementById('prepreset_new').addEventListener('click', onNewClicked);
    document.getElementById('prepreset_rename').addEventListener('click', onRenameClicked);
    document.getElementById('prepreset_duplicate').addEventListener('click', onDuplicateClicked);
    document.getElementById('prepreset_delete').addEventListener('click', onDeleteClicked);

    renderControlRow();
}

// Repopulates the dropdown from the current master and updates button states.
export function renderControlRow() {
    const select = document.getElementById(SELECT_ID);
    if (!select || !api) {
        return;
    }

    const subPresets = listSubPresets(api.getSettings(), api.getMasterName());
    const active = api.getActiveSub();
    const dirty = api.isDirty();

    select.innerHTML = '';

    const masterOption = document.createElement('option');
    masterOption.value = MASTER_VALUE;
    masterOption.textContent = '- Master (no sub-preset) -';
    select.append(masterOption);

    for (const sub of subPresets) {
        const option = document.createElement('option');
        option.value = sub.id;
        // Bullet marks unsaved changes, so it shows without having to watch
        // the Save button.
        option.textContent = (active && sub.id === active.id && dirty) ? `${sub.name} \u2022` : sub.name;
        select.append(option);
    }

    select.value = active ? active.id : MASTER_VALUE;

    for (const id of ['prepreset_rename', 'prepreset_duplicate', 'prepreset_delete']) {
        document.getElementById(id)?.classList.toggle('disabled', !active);
    }
    document.getElementById('prepreset_save')?.classList.toggle('disabled', !active || !dirty);
}

// Every path that changes the selection goes through here first. Deleting is
// exempt: it already confirms, and warning about unsaved edits to something
// being thrown away is noise.
async function confirmDiscardIfDirty() {
    if (!api.isDirty()) {
        return true;
    }
    const active = api.getActiveSub();
    const safeName = escapeHtml(active ? active.name : '');
    return !!await Popup.show.confirm(
        'Unsaved changes',
        `"${safeName}" has unsaved changes. Discard them?`,
    );
}

function onSaveClicked() {
    const active = api.getActiveSub();
    if (!active || !api.isDirty()) {
        return;
    }
    if (api.saveActiveSubPreset()) {
        toastr.success(`Saved "${active.name}"`, 'Prepreset');
    }
}

async function onSelectChanged(event) {
    const value = event.target.value;
    if (!await confirmDiscardIfDirty()) {
        // Put the dropdown back where it was; the selection never moved.
        renderControlRow();
        return;
    }
    api.selectSubPreset(value === MASTER_VALUE ? null : value);
}

async function onNewClicked() {
    if (!await confirmDiscardIfDirty()) {
        return;
    }
    // Only store what differs, so it keeps following the master for the rest.
    const overrides = api.diffLiveAgainstMaster();
    if (!overrides) {
        toastr.warning('Could not read the current or master values', 'Prepreset');
        return;
    }
    const name = await Popup.show.input('New sub-preset', 'Name:', '');
    if (name === '') {
        toastr.warning('Sub-preset name cannot be empty', 'Prepreset');
        return;
    }
    if (!name) {
        return;
    }
    const sub = createSubPreset(api.getSettings(), api.getMasterName(), name, overrides);
    api.selectSubPreset(sub.id);
}

async function onRenameClicked() {
    const active = api.getActiveSub();
    if (!active) {
        return;
    }
    const name = await Popup.show.input('Rename sub-preset', 'Name:', active.name);
    if (name === '') {
        toastr.warning('Sub-preset name cannot be empty', 'Prepreset');
        return;
    }
    if (!name) {
        return;
    }
    renameSubPreset(api.getSettings(), api.getMasterName(), active.id, name);
    api.persist();
    renderControlRow();
}

async function onDuplicateClicked() {
    const active = api.getActiveSub();
    if (!active) {
        return;
    }
    // Duplicate copies what is stored, not what is live, so unsaved toggles
    // would be lost from both the original and the copy.
    if (!await confirmDiscardIfDirty()) {
        return;
    }
    const copy = duplicateSubPreset(api.getSettings(), api.getMasterName(), active.id);
    api.selectSubPreset(copy.id);
}

async function onDeleteClicked() {
    const active = api.getActiveSub();
    if (!active) {
        return;
    }
    const safeName = escapeHtml(active.name);
    const confirmed = await Popup.show.confirm('Delete sub-preset', `Delete "${safeName}"? This cannot be undone.`);
    if (!confirmed) {
        return;
    }
    deleteSubPreset(api.getSettings(), api.getMasterName(), active.id);
    api.selectSubPreset(null);
}
