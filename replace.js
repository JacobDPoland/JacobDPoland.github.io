const $ = sel => document.querySelector(sel);
const inputEl = $('#input');
const findEl = $('#find');
const replaceEl = $('#replace');
const outputEl = $('#output');
const runBtn = $('#runBtn');
const swapBtn = $('#swapBtn');
const copyBtn = $('#copyBtn');
const countEl = $('#count');
const errEl = $('#err');
const copyHint = $('#copyHint');

function escapeRegExp(str) {
    // Escape regex special chars so we do a literal find.
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceAllLiteral(haystack, needle, replacement) {
    if (needle === '') return { text: haystack, count: 0 };
    const re = new RegExp(escapeRegExp(needle), 'g');
    let count = 0;
    const text = haystack.replace(re, () => { count++; return replacement; });
    return { text, count };
}

function run() {
    errEl.textContent = '';
    copyHint.textContent = '';
    const src = inputEl.value;
    const find = findEl.value;
    const repl = replaceEl.value;

    if (find.length === 0) {
    errEl.textContent = '“Find” cannot be empty.';
    outputEl.value = src;
    countEl.textContent = '0';
    return;
    }

    const { text, count } = replaceAllLiteral(src, find, repl);
    outputEl.value = text;
    countEl.textContent = String(count);
}

async function copyOutput() {
    const text = outputEl.value;
    if (!text) {
    copyHint.textContent = 'Nothing to copy.';
    return;
    }
    try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
    } else {
        // Fallback
        outputEl.select();
        document.execCommand('copy');
        outputEl.setSelectionRange(0, 0); // clear selection
    }
    copyHint.textContent = 'Copied!';
    } catch (e) {
    copyHint.textContent = 'Copy failed. Select and copy manually.';
    }
    // Clear the confirmation after a moment
    setTimeout(() => { copyHint.textContent = ''; }, 2000);
}

function swapFindReplace() {
    const a = findEl.value;
    findEl.value = replaceEl.value;
    replaceEl.value = a;
    run(); // re-run to preview new result immediately
}

// Wire up events
runBtn.addEventListener('click', run);
swapBtn.addEventListener('click', swapFindReplace);
copyBtn.addEventListener('click', copyOutput);

// Convenience: pressing Enter in Find/Replace runs the action
[findEl, replaceEl].forEach(el => {
    el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        run();
    }
    });
});

// Initialize output as mirror of input until first run
inputEl.addEventListener('input', () => {
    if (countEl.textContent === '0') outputEl.value = inputEl.value;
});

// Set initial mirror
outputEl.value = '';
