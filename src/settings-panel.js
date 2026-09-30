/**
 * The Prepreset drawer in the Extensions panel: the operating mode, and which
 * fields that mode manages. Uses textContent throughout, so nothing needs
 * escaping. SillyTavern opens and closes .inline-drawer (public/script.js:12193).
 */

const PANEL_ID = 'prepreset_settings';

// { getCatalogue, getMode, setMode, onModeChanged, getEnabledFields,
//   setEnabledFields, onChanged }
let api = null;

// Safe to call repeatedly.
export function injectSettingsPanel(panelApi) {
    api = panelApi;

    if (document.getElementById(PANEL_ID)) {
        renderSettingsPanel();
        return;
    }

    const host = document.getElementById('extensions_settings');
    if (!host) {
        console.warn('[Prepreset] #extensions_settings not found; settings panel not injected');
        return;
    }

    const drawer = document.createElement('div');
    drawer.id = PANEL_ID;
    drawer.classList.add('inline-drawer');
    drawer.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Prepreset</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="prepreset_mode_container"></div>
            <small class="prepreset_fields_note"></small>
            <div class="prepreset_fields"></div>
        </div>
    `;
    host.append(drawer);

    const fields = drawer.querySelector('.prepreset_fields');
    fields.addEventListener('change', onFieldChanged);
    fields.addEventListener('click', onGroupAction);

    renderSettingsPanel();
}

const MODE_NOTES = {
    manual: 'Use the sub-preset dropdown under the master preset to pick, save and manage sub-presets.',
    autobound: 'Each chat remembers its own master preset, prompt toggles and parameter overrides.',
};

const FIELD_NOTES = {
    manual: 'Sub-presets can only store checked fields. Unchecked fields are left alone when you switch sub-presets. Unchecking a field the active sub-preset changed puts the master\'s value back.',
    autobound: 'Chats can only store checked fields. Unchecked fields follow the master preset. Unchecking a field a chat changed puts the master\'s value back.',
};

function radioRow(value, label, checked) {
    const row = document.createElement('label');
    row.classList.add('radio_label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'prepreset_mode';
    input.value = value;
    input.checked = checked;
    const text = document.createElement('span');
    text.textContent = label;
    row.append(input, text);
    return row;
}

function onModeChanged(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.name !== 'prepreset_mode') {
        return;
    }
    api.setMode(input.value);
    api.onModeChanged(input.value);
    renderSettingsPanel();
}

function renderModeSection() {
    const container = document.querySelector(`#${PANEL_ID} .prepreset_mode_container`);
    if (!container || !api) {
        return;
    }

    const mode = api.getMode();

    const title = document.createElement('b');
    title.textContent = 'Operating mode';

    const radioGroup = document.createElement('div');
    radioGroup.classList.add('radio_group');
    radioGroup.append(
        radioRow('manual', 'Manual (sub-presets)', mode === 'manual'),
        radioRow('autobound', 'Auto-bound (per-chat)', mode === 'autobound'),
    );
    radioGroup.addEventListener('change', onModeChanged);

    const note = document.createElement('small');
    note.classList.add('prepreset_mode_note');
    note.textContent = MODE_NOTES[mode];

    const group = document.createElement('div');
    group.classList.add('prepreset_mode_group');
    group.append(title, radioGroup, note);
    container.replaceChildren(group);

    const fieldsNote = document.querySelector(`#${PANEL_ID} .prepreset_fields_note`);
    if (fieldsNote) {
        fieldsNote.textContent = FIELD_NOTES[mode];
    }
}

export function renderSettingsPanel() {
    renderModeSection();

    const container = document.querySelector(`#${PANEL_ID} .prepreset_fields`);
    if (!container || !api) {
        return;
    }

    const enabled = api.getEnabledFields();
    const enabledParams = new Set(enabled.params);

    container.replaceChildren(checkboxRow('toggles', 'Prompt toggles', enabled.toggles));

    const byGroup = new Map();
    for (const field of api.getCatalogue()) {
        if (!byGroup.has(field.group)) {
            byGroup.set(field.group, []);
        }
        byGroup.get(field.group).push(field);
    }

    for (const [group, fields] of byGroup) {
        const section = document.createElement('div');
        section.classList.add('prepreset_group');

        const header = document.createElement('div');
        header.classList.add('prepreset_group_header');
        const title = document.createElement('b');
        title.textContent = group;
        header.append(title, groupButton('all', group, 'All'), groupButton('none', group, 'None'));
        section.append(header);

        for (const field of fields) {
            section.append(checkboxRow(field.key, field.label, enabledParams.has(field.key)));
        }
        container.append(section);
    }
}

function checkboxRow(field, label, checked) {
    const row = document.createElement('label');
    row.classList.add('checkbox_label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.field = field;
    input.checked = checked;
    const text = document.createElement('span');
    text.textContent = label;
    row.append(input, text);
    return row;
}

function groupButton(action, group, text) {
    const button = document.createElement('div');
    button.classList.add('menu_button', 'prepreset_group_button');
    button.dataset.action = action;
    button.dataset.group = group;
    button.textContent = text;
    return button;
}

// Start from the stored list so enabled keys this SillyTavern doesn't know survive.
function onFieldChanged(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.field) {
        return;
    }
    const enabled = api.getEnabledFields();
    if (input.dataset.field === 'toggles') {
        api.setEnabledFields({ ...enabled, toggles: input.checked });
    } else {
        const params = new Set(enabled.params);
        if (input.checked) {
            params.add(input.dataset.field);
        } else {
            params.delete(input.dataset.field);
        }
        api.setEnabledFields({ ...enabled, params: [...params] });
    }
    api.onChanged();
}

function onGroupAction(event) {
    const button = event.target instanceof Element ? event.target.closest('.prepreset_group_button') : null;
    if (!button) {
        return;
    }
    const groupKeys = api.getCatalogue()
        .filter(field => field.group === button.dataset.group)
        .map(field => field.key);
    const enabled = api.getEnabledFields();
    const params = new Set(enabled.params);
    for (const key of groupKeys) {
        if (button.dataset.action === 'all') {
            params.add(key);
        } else {
            params.delete(key);
        }
    }
    api.setEnabledFields({ ...enabled, params: [...params] });
    api.onChanged();
    renderSettingsPanel();
}
