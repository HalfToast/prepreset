/**
 * The parameters a sub-preset can override, built at runtime from SillyTavern's
 * settingsToUpdate (public/scripts/openai.js:305). Entries there look like
 * [selector, settingsKey, isCheckbox, isConnection].
 *
 * Connection fields are skipped, as are prompts, prompt_order (toggles are
 * handled separately) and extensions. A parameter added by a future SillyTavern
 * shows up in Other under its raw key until it gets a label here.
 */

export const GROUPS = Object.freeze([
    'Sampling',
    'Context & length',
    'Reasoning & tools',
    'Prompt formatting',
    'Media',
    'Other',
]);

export const EXCLUDED_KEYS = Object.freeze(['prompts', 'prompt_order', 'extensions']);

// [preset key, group, label], in display order within each group.
export const KNOWN_FIELDS = Object.freeze([
    ['temperature', 'Sampling', 'Temperature'],
    ['frequency_penalty', 'Sampling', 'Frequency penalty'],
    ['presence_penalty', 'Sampling', 'Presence penalty'],
    ['top_p', 'Sampling', 'Top P'],
    ['top_k', 'Sampling', 'Top K'],
    ['top_a', 'Sampling', 'Top A'],
    ['min_p', 'Sampling', 'Min P'],
    ['repetition_penalty', 'Sampling', 'Repetition penalty'],
    ['seed', 'Sampling', 'Seed'],
    ['n', 'Sampling', 'Number of responses'],

    ['openai_max_context', 'Context & length', 'Context size'],
    ['openai_max_tokens', 'Context & length', 'Max response tokens'],
    ['max_context_unlocked', 'Context & length', 'Unlocked context size'],

    ['reasoning_effort', 'Reasoning & tools', 'Reasoning effort'],
    ['show_thoughts', 'Reasoning & tools', 'Request model reasoning'],
    ['verbosity', 'Reasoning & tools', 'Verbosity'],
    ['function_calling', 'Reasoning & tools', 'Function calling'],
    ['tool_call_recurse_limit', 'Reasoning & tools', 'Tool call recursion limit'],
    ['tool_reasoning_mode', 'Reasoning & tools', 'Interleaved thinking'],
    ['enable_web_search', 'Reasoning & tools', 'Web search'],

    ['names_behavior', 'Prompt formatting', 'Character names behavior'],
    ['send_if_empty', 'Prompt formatting', 'Replace empty message'],
    ['impersonation_prompt', 'Prompt formatting', 'Impersonation prompt'],
    ['new_chat_prompt', 'Prompt formatting', 'New chat prompt'],
    ['new_group_chat_prompt', 'Prompt formatting', 'New group chat prompt'],
    ['new_example_chat_prompt', 'Prompt formatting', 'New example chat prompt'],
    ['continue_nudge_prompt', 'Prompt formatting', 'Continue nudge'],
    ['group_nudge_prompt', 'Prompt formatting', 'Group nudge prompt'],
    ['wi_format', 'Prompt formatting', 'World Info format'],
    ['scenario_format', 'Prompt formatting', 'Scenario format'],
    ['personality_format', 'Prompt formatting', 'Personality format'],
    ['assistant_prefill', 'Prompt formatting', 'Assistant prefill'],
    ['assistant_impersonation', 'Prompt formatting', 'Assistant impersonation prefill'],
    ['continue_prefill', 'Prompt formatting', 'Continue prefill'],
    ['continue_postfix', 'Prompt formatting', 'Continue postfix'],
    ['use_sysprompt', 'Prompt formatting', 'Use system prompt'],
    ['squash_system_messages', 'Prompt formatting', 'Squash system messages'],

    ['media_inlining', 'Media', 'Send inline media'],
    ['inline_image_quality', 'Media', 'Inline image quality'],
    ['request_images', 'Media', 'Request images'],
    ['request_image_aspect_ratio', 'Media', 'Image aspect ratio'],
    ['request_image_resolution', 'Media', 'Image resolution'],

    ['stream_openai', 'Other', 'Streaming'],
    ['bias_preset_selected', 'Other', 'Logit bias preset'],
]);

export function buildCatalogue(settingsToUpdate) {
    const known = new Map(KNOWN_FIELDS.map(([key, group, label], rank) => [key, { group, label, rank }]));
    const fields = [];
    let unknownRank = KNOWN_FIELDS.length;

    for (const [key, entry] of Object.entries(settingsToUpdate ?? {})) {
        if (!Array.isArray(entry)) {
            continue;
        }
        const [selector, settingKey, isCheckbox, isConnection] = entry;
        if (isConnection || EXCLUDED_KEYS.includes(key)) {
            continue;
        }
        // An empty selector breaks the joined listener selector in index.js.
        if (typeof selector !== 'string' || selector.length === 0 || typeof settingKey !== 'string') {
            continue;
        }
        const meta = known.get(key);
        fields.push({
            key,
            selector,
            settingKey,
            isCheckbox: !!isCheckbox,
            group: meta ? meta.group : 'Other',
            label: meta ? meta.label : key,
            rank: meta ? meta.rank : unknownRank++,
        });
    }

    fields.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.rank - b.rank);
    return fields.map(({ rank, ...field }) => field);
}
