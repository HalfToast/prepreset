const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;',
};

// For text going into an innerHTML-rendered string. Not idempotent: escaping
// twice double-escapes.
export function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
