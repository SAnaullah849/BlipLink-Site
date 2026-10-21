const assert = require('node:assert/strict');
const { test } = require('node:test');
const engine = require('../dashboard/card-theme.js');

test('theme input is normalized to safe color, font, layout, and numeric choices', () => {
    const theme = engine.normalize({ accentColor: 'url(https://example.com/track)', font: 'evil; color:red', radius: 500,
        coverHeight: -10, layout: '<script>', showQr: 'false', showPhoto: false, customCss: 'body { display: none }' });
    assert.equal(theme.accentColor, engine.defaults.accentColor);
    assert.equal(theme.font, engine.defaults.font);
    assert.equal(theme.radius, 36); assert.equal(theme.coverHeight, 100);
    assert.equal(theme.layout, engine.defaults.layout); assert.equal(theme.showQr, true); assert.equal(theme.showPhoto, false);
    assert.equal(Object.hasOwn(theme, 'customCss'), false);
});
test('valid custom settings round-trip and all presets are valid', () => {
    for (const preset of Object.values(engine.presets)) assert.deepEqual(engine.normalize(preset), preset);
    const custom = { ...engine.defaults, accentColor: '#ff22aa', layout: 'left', avatarSize: 130, showQr: false };
    assert.deepEqual(engine.normalize(JSON.parse(JSON.stringify(custom))), custom);
    assert.deepEqual(engine.normalize(null), engine.defaults);
    assert.deepEqual(engine.normalize([]), engine.defaults);
});
test('button text contrast adapts to dark and light custom colors', () => {
    assert.equal(engine.contrastColor('#000000'), '#ffffff');
    assert.equal(engine.contrastColor('#ffffff'), '#101828');
});
