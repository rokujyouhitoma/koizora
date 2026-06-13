const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

test.describe('Yuzora Parser Unit Tests', () => {
    let window;
    let activeIntervals = [];
    let activeTimeouts = [];

    test.before(() => {
        // Setup JSDOM
        const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div><div id="welcome-screen"></div><div id="reader-screen"></div><div id="drop-zone"></div><input id="file-input" type="file" /><div id="reader-viewport"></div><div id="reader-content"></div><div id="book-title"></div><button id="btn-back"></button><button id="btn-settings"></button><button id="btn-first-page"></button><button id="btn-close-settings"></button><div id="settings-drawer"></div><div id="drawer-overlay"></div><div id="page-nav-left"></div><div id="page-nav-right"></div><div class="reader-header"></div><div class="reader-footer"></div><div class="progress-bar-container"></div><div id="progress-bar"></div><div id="reading-percentage"></div><div id="reading-index"></div><div id="developer-books-grid"></div><div id="reader-books-grid"></div><button id="btn-open-debug"></button><div id="debug-modal"></div><button id="btnCloseDebug"></button><div id="debug-modal-overlay"></div><div id="debug-monitor"></div><button id="btn-clear-bookmarks"></button><button id="btn-clear-config"></button><button id="btn-clear-all"></button></body></html>', {
            url: "http://localhost",
            runScripts: "dangerously",
            resources: "usable"
        });
        window = dom.window;
        global.document = window.document;
        global.window = window;

        // Mock setInterval to avoid hanging timers in Node process
        const originalSetInterval = window.setInterval;
        window.setInterval = (fn, delay) => {
            const id = originalSetInterval(fn, delay);
            activeIntervals.push(id);
            return id;
        };

        // Mock setTimeout
        const originalSetTimeout = window.setTimeout;
        window.setTimeout = (fn, delay) => {
            const id = originalSetTimeout(fn, delay);
            activeTimeouts.push(id);
            return id;
        };

        // Load app.js code
        const appJsCode = fs.readFileSync(path.resolve(__dirname, '../../src/js/app.js'), 'utf8');
        const scriptEl = window.document.createElement('script');
        scriptEl.textContent = appJsCode;
        window.document.body.appendChild(scriptEl);

        // Fire DOMContentLoaded
        const event = new window.Event('DOMContentLoaded');
        window.document.dispatchEvent(event);
    });

    test.after(() => {
        if (window) {
            // Clear all registered JSDOM timers to allow Node to exit cleanly
            activeIntervals.forEach(id => window.clearInterval(id));
            activeTimeouts.forEach(id => window.clearTimeout(id));
            window.close();
        }
    });

    test('should expose Yuzora object on window', () => {
        assert.ok(window.Yuzora);
        assert.strictEqual(typeof window.Yuzora.parseAozoraText, 'function');
        assert.strictEqual(typeof window.Yuzora.formatAozoraMarkup, 'function');
    });

    test('should correctly format ruby with delimiter', () => {
        const result = window.Yuzora.formatAozoraMarkup('｜漢字《かんじ》');
        assert.strictEqual(result, '<ruby>漢字<rt>かんじ</rt></ruby>');
    });

    test('should correctly format ruby without delimiter', () => {
        const result = window.Yuzora.formatAozoraMarkup('漢字《かんじ》');
        assert.strictEqual(result, '<ruby>漢字<rt>かんじ</rt></ruby>');
    });

    test('should escape HTML syntax to prevent XSS', () => {
        const result = window.Yuzora.formatAozoraMarkup('<script>alert("xss")</script>');
        assert.strictEqual(result, '&lt;script&gt;alert("xss")&lt;/script&gt;');
    });

    test('should parse page break marker', () => {
        const result = window.Yuzora.parseAozoraText('タイトル\n著者\n-------------------------------------------------------\n本文第一段\n［＃改ページ］\n本文第二段');
        assert.ok(result.body.includes('<div class="page-break"></div>'));
    });
});
