/**
 * The control row: a sub-preset dropdown plus new/rename/duplicate/delete
 * buttons, injected above the Prompt Manager. Owns no state of its own;
 * everything arrives through the `api` object passed to injectControlRow.
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

// { getSettings, getMasterName, getActiveSub, selectSubPreset, readLiveToggles, persist }
let api = null;

// Safe to call repeatedly.
export function injectControlRow(uiApi) {
    api = uiApi;

    if (document.getElementById(ROW_ID)) {
        renderControlRow();
        return;
    }

    const anchor = document.getElementById('completion_prompt_manager');
    if (!anchor) {
        console.warn('[Prepreset] #completion_prompt_manager not found; control row not injected');
        return;
    }

    const row = document.createElement('div');
    row.id = ROW_ID;
    row.classList.add('flex-container');
    row.innerHTML = `
        <select id="${SELECT_ID}" class="text_pole" title="Sub-preset"></select>
        <div id="prepreset_new" class="menu_button menu_button_icon" title="New sub-preset from current toggles">
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

    anchor.insertAdjacentElement('beforebegin', row);

    document.getElementById(SELECT_ID).addEventListener('change', onSelectChanged);
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

    select.innerHTML = '';

    const masterOption = document.createElement('option');
    masterOption.value = MASTER_VALUE;
    masterOption.textContent = '- Master (no sub-preset) -';
    select.append(masterOption);

    for (const sub of subPresets) {
        const option = document.createElement('option');
        option.value = sub.id;
        option.textContent = sub.name;
        select.append(option);
    }

    select.value = active ? active.id : MASTER_VALUE;

    const disabled = !active;
    for (const id of ['prepreset_rename', 'prepreset_duplicate', 'prepreset_delete']) {
        document.getElementById(id)?.classList.toggle('disabled', disabled);
    }
}

function onSelectChanged(event) {
    const value = event.target.value;
    api.selectSubPreset(value === MASTER_VALUE ? null : value);
}

async function onNewClicked() {
    const toggles = api.readLiveToggles();
    if (!toggles) {
        toastr.warning('Prompt Manager is not ready yet', 'Prepreset');
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
    const sub = createSubPreset(api.getSettings(), api.getMasterName(), name, toggles);
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

function onDuplicateClicked() {
    const active = api.getActiveSub();
    if (!active) {
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
