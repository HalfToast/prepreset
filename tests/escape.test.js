import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../src/escape.js';

test('escapeHtml escapes the special characters', () => {
    assert.equal(escapeHtml('&'), '&amp;');
    assert.equal(escapeHtml('<'), '&lt;');
    assert.equal(escapeHtml('>'), '&gt;');
    assert.equal(escapeHtml('"'), '&quot;');
    assert.equal(escapeHtml('\''), '&#39;');
});

test('escapeHtml escapes a mixed string', () => {
    assert.equal(
        escapeHtml('<b>Tom & Jerry\'s "great" show</b>'),
        '&lt;b&gt;Tom &amp; Jerry&#39;s &quot;great&quot; show&lt;/b&gt;',
    );
});

test('escapeHtml leaves plain text alone', () => {
    assert.equal(escapeHtml('plain text 123'), 'plain text 123');
});

test('escapeHtml handles an empty string', () => {
    assert.equal(escapeHtml(''), '');
});

test('escapeHtml is not idempotent', () => {
    const once = escapeHtml('&');
    const twice = escapeHtml(once);
    assert.equal(once, '&amp;');
    assert.equal(twice, '&amp;amp;');
    assert.notEqual(twice, once);
});
