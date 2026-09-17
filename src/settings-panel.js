/**
 * The Prepreset drawer in the Extensions panel, for picking which fields
 * sub-presets manage. Uses textContent throughout, so nothing needs escaping.
 * SillyTavern handles opening and closing .inline-drawer (public/script.js:12193).
 */

const PANEL_ID = 'prepreset_settings';

// { getCatalogue, getEnabledFields, setEnabledFields, onChanged }
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
            <small>Sub-presets can only store checked fields. Unchecked fields are left alone when you switch sub-presets. Unchecking a field the active sub-preset changed puts the master's value back.</small>
            <div class="prepreset_fields"></div>
        </div>
    `;
    host.append(drawer);

    const fields = drawer.querySelector('.prepreset_fields');
    fields.addEventListener('change', onFieldChanged);
    fields.addEventListener('click', onGroupAction);

    renderSettingsPanel();
}

export function renderSettingsPanel() {
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
