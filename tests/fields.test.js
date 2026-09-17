import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue, GROUPS, EXCLUDED_KEYS, KNOWN_FIELDS } from '../src/fields.js';

// Every non-connection entry of settingsToUpdate in SillyTavern 1.19.0, in
// source order (public/scripts/openai.js:305).
const ST_1_19_PARAMETER_KEYS = [
    'temperature', 'frequency_penalty', 'presence_penalty', 'top_p', 'top_k', 'top_a',
    'min_p', 'repetition_penalty', 'max_context_unlocked', 'tool_reasoning_mode',
    'openai_max_context', 'openai_max_tokens', 'names_behavior', 'send_if_empty',
    'impersonation_prompt', 'new_chat_prompt', 'new_group_chat_prompt',
    'new_example_chat_prompt', 'continue_nudge_prompt', 'bias_preset_selected', 'wi_format',
    'scenario_format', 'personality_format', 'group_nudge_prompt', 'stream_openai', 'prompts',
    'prompt_order', 'assistant_prefill', 'assistant_impersonation', 'use_sysprompt',
    'squash_system_messages', 'media_inlining', 'inline_image_quality', 'continue_prefill',
    'continue_postfix', 'function_calling', 'tool_call_recurse_limit', 'show_thoughts',
    'reasoning_effort', 'verbosity', 'enable_web_search', 'seed', 'n', 'request_images',
    'request_image_aspect_ratio', 'request_image_resolution', 'extensions',
];

// Shapes entries like the real tuple: [selector, settingsKey, isCheckbox, isConnection].
function fakeSettingsToUpdate(keys, { connection = [] } = {}) {
    const result = {};
    for (const key of keys) {
        result[key] = [`#${key}_control`, `${key}_setting`, key === 'stream_openai', false];
    }
    for (const key of connection) {
        result[key] = [`#${key}_control`, key, false, true];
    }
    return result;
}

test('every SillyTavern 1.19.0 parameter gets a known group and label', () => {
    const catalogue = buildCatalogue(fakeSettingsToUpdate(ST_1_19_PARAMETER_KEYS));
    assert.equal(catalogue.length, 44);
    for (const field of catalogue) {
        assert.notEqual(field.label, field.key, `${field.key} has no friendly label`);
    }
    const other = catalogue.filter(field => field.group === 'Other').map(field => field.key);
    assert.deepEqual(other, ['stream_openai', 'bias_preset_selected']);
});

test('connection fields are excluded', () => {
    const catalogue = buildCatalogue(fakeSettingsToUpdate(['temperature'], {
        connection: ['chat_completion_source', 'openai_model', 'proxy_password'],
    }));
    assert.deepEqual(catalogue.map(field => field.key), ['temperature']);
});

test('prompts, prompt_order and extensions are excluded', () => {
    assert.deepEqual([...EXCLUDED_KEYS], ['prompts', 'prompt_order', 'extensions']);
    const catalogue = buildCatalogue(fakeSettingsToUpdate(['prompts', 'prompt_order', 'extensions', 'seed']));
    assert.deepEqual(catalogue.map(field => field.key), ['seed']);
});

test('unknown keys go at the end of Other under their raw key', () => {
    const catalogue = buildCatalogue(fakeSettingsToUpdate(['brand_new_param', 'bias_preset_selected', 'stream_openai']));
    assert.deepEqual(catalogue.map(field => field.key), ['stream_openai', 'bias_preset_selected', 'brand_new_param']);
    const unknown = catalogue.find(field => field.key === 'brand_new_param');
    assert.equal(unknown.group, 'Other');
    assert.equal(unknown.label, 'brand_new_param');
});

test('fields are sorted by group, then table order', () => {
    const forward = buildCatalogue(fakeSettingsToUpdate(ST_1_19_PARAMETER_KEYS)).map(field => field.key);
    const reversed = buildCatalogue(fakeSettingsToUpdate([...ST_1_19_PARAMETER_KEYS].reverse())).map(field => field.key);
    assert.deepEqual(reversed, forward);
    assert.deepEqual(forward.slice(0, 3), ['temperature', 'frequency_penalty', 'presence_penalty']);
    const groups = buildCatalogue(fakeSettingsToUpdate(ST_1_19_PARAMETER_KEYS)).map(field => field.group);
    const groupIndexes = groups.map(group => GROUPS.indexOf(group));
    assert.deepEqual(groupIndexes, [...groupIndexes].sort((a, b) => a - b));
});

test('entries keep their selector, settings key and checkbox flag', () => {
    const [field] = buildCatalogue({ stream_openai: ['#stream_toggle', 'stream_openai', true, false] });
    assert.deepEqual(field, {
        key: 'stream_openai',
        selector: '#stream_toggle',
        settingKey: 'stream_openai',
        isCheckbox: true,
        group: 'Other',
        label: 'Streaming',
    });
});

test('malformed entries are skipped', () => {
    const catalogue = buildCatalogue({
        temperature: ['#temp_openai', 'temp_openai', false, false],
        not_a_tuple: 'nope',
        missing_selector: [null, 'x', false, false],
        missing_setting: ['#x', 42, false, false],
    });
    assert.deepEqual(catalogue.map(field => field.key), ['temperature']);
});

test('KNOWN_FIELDS uses only declared groups and has no duplicate keys', () => {
    assert.equal(KNOWN_FIELDS.length, 44);
    const keys = KNOWN_FIELDS.map(([key]) => key);
    assert.equal(new Set(keys).size, keys.length);
    for (const [, group] of KNOWN_FIELDS) {
        assert.ok(GROUPS.includes(group), `${group} is not a declared group`);
    }
});

test('buildCatalogue tolerates a missing settingsToUpdate', () => {
    assert.deepEqual(buildCatalogue(undefined), []);
    assert.deepEqual(buildCatalogue(null), []);
});

test('an entry with an empty selector is skipped', () => {
    const catalogue = buildCatalogue({
        temperature: ['#temp_openai', 'temp_openai', false, false],
        future_field: ['', 'future_field', false, false],
    });
    assert.deepEqual(catalogue.map(field => field.key), ['temperature']);
});
