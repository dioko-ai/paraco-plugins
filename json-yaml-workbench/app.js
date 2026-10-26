import { parseDocument, stringify } from './yaml.js';
import { escapeHtml as esc, download, notice } from './ui.js';

const MAX_BYTES = 1024 * 1024;
const STORAGE_KEY = 'json-yaml-workbench:text';
const app = document.querySelector('#app');

app.innerHTML = `
  <section class="card workbench">
    <header class="toolbar wb-head">
      <h2>Data editor</h2>
      <span class="badge" id="save-state" aria-live="polite">Ready</span>
    </header>
    <div class="toolbar wb-controls">
      <label class="row wb-label">Input format
        <select id="input-format" aria-label="Input format"><option value="auto">Auto detect</option><option value="json">JSON</option><option value="yaml">YAML</option></select>
      </label>
      <label class="row wb-label">Output format
        <select id="output-format" aria-label="Output format"><option value="json">JSON</option><option value="yaml">YAML</option></select>
      </label>
      <label class="row wb-check"><input id="minify" type="checkbox"> Minify JSON</label>
      <button class="primary" id="format">Format</button>
      <button id="convert">Convert</button>
      <button id="copy">Copy</button>
      <button id="download">Download</button>
      <label class="button wb-file">Import file<input id="file" type="file" accept=".json,.yaml,.yml,application/json,text/yaml,text/plain" hidden></label>
      <button class="danger" id="clear">Clear</button>
    </div>
    <div class="toolbar wb-status"><span id="metrics" class="muted">0 lines · 0 bytes</span><span id="message" role="status" aria-live="polite"></span></div>
    <div class="grid wb-grid">
      <section class="wb-pane"><label for="source" class="wb-title">Editor <span class="muted">Paste or type JSON / YAML</span></label>
        <textarea id="source" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="JSON or YAML editor" placeholder="Paste JSON or YAML here…"></textarea>
      </section>
      <section class="wb-pane wb-tree-pane"><div class="row wb-title"><label for="search">Parsed tree</label><input id="search" type="search" placeholder="Search keys and values" aria-label="Search parsed keys and values"></div>
        <div id="tree" class="wb-tree empty" aria-live="polite">Your parsed structure will appear here.</div>
      </section>
    </div>
  </section>`;

const $ = (s) => app.querySelector(s);
const source = $('#source'), inputFormat = $('#input-format'), outputFormat = $('#output-format');
const tree = $('#tree'), message = $('#message'), saveState = $('#save-state');
let parsed, parsedFormat = null, saveTimer;

function byteSize(value) { return new TextEncoder().encode(value).length; }
function updateMetrics() {
  const text = source.value;
  const lines = text ? text.split(/\r\n|\r|\n/).length : 0;
  $('#metrics').textContent = `${lines} ${lines === 1 ? 'line' : 'lines'} · ${byteSize(text).toLocaleString()} bytes`;
}
function tell(text, isError = false) {
  message.textContent = text;
  message.className = isError ? 'wb-error' : 'muted';
}
function identifyFormat(text) {
  if (inputFormat.value !== 'auto') return inputFormat.value;
  const t = text.trim();
  return /^[\[{]/.test(t) ? 'json' : 'yaml';
}
function locationForError(error, text) {
  const position = error?.linePos?.[0];
  if (position && Number.isFinite(position.line)) return { line: position.line, column: position.col || 1 };
  const mark = error?.mark;
  if (mark && Number.isFinite(mark.line)) return { line: mark.line + 1, column: (mark.column || 0) + 1 };
  const msg = String(error?.message || '');
  const m = msg.match(/(?:line|at)\s+(\d+)(?:[, :]+(?:column|col)\s+(\d+))?/i);
  if (m) return { line: Number(m[1]), column: Number(m[2] || 1) };
  const pos = msg.match(/position\s+(\d+)/i);
  if (pos) {
    const before = text.slice(0, Number(pos[1]));
    const lines = before.split(/\r\n|\r|\n/);
    return { line: lines.length, column: lines[lines.length - 1].length + 1 };
  }
  return null;
}
function parse(text = source.value) {
  if (!text.trim()) throw new Error('Enter JSON or YAML to parse.');
  const format = identifyFormat(text);
  if (format === 'json') return { value: JSON.parse(text), format };
  const doc = parseDocument(text, { uniqueKeys: true, maxAliasCount: 50 });
  if (doc.errors?.length) throw doc.errors[0];
  return { value: doc.toJS({ maxAliasCount: 50 }), format };
}
function renderTree(value, query = '') {
  const q = query.trim().toLocaleLowerCase();
  tree.replaceChildren();
  tree.classList.remove('empty');
  if (value === undefined) { tree.textContent = 'Your parsed structure will appear here.'; tree.classList.add('empty'); return; }
  let matches = 0;
  const container = document.createElement('div');
  const make = (val, key, depth, ancestors = new Set()) => {
    const isObj = val !== null && typeof val === 'object';
    if (isObj && ancestors.has(val)) {
      const cycle = document.createElement('div'); cycle.className = 'wb-node'; cycle.textContent = `${key ?? 'root'} · circular alias`; return cycle;
    }
    const entries = isObj ? (Array.isArray(val) ? val.map((v, i) => [String(i), v]) : Object.entries(val)) : [];
    const label = key === null ? 'root' : key;
    const scalar = isObj ? (Array.isArray(val) ? `Array(${entries.length})` : `Object(${entries.length})`) : (val === null ? 'null' : String(val));
    const searchable = `${label} ${scalar}`.toLocaleLowerCase();
    const nextAncestors = new Set(ancestors);
    if (isObj) nextAncestors.add(val);
    const childHits = q && isObj ? entries.some(([k, v]) => subtreeHas(k, v, q, new WeakSet())) : false;
    const ownHit = !q || searchable.includes(q);
    if (q && !ownHit && !childHits) return null;
    if (ownHit && q) matches++;
    const details = document.createElement('details');
    details.className = 'wb-node'; details.open = depth < 1 || !!q;
    details.style.setProperty('--depth', Math.min(depth, 12));
    const summary = document.createElement('summary');
    const keyEl = document.createElement('span'); keyEl.className = 'wb-key'; keyEl.textContent = label;
    const valueEl = document.createElement('span'); valueEl.className = isObj ? 'wb-type' : 'wb-value'; valueEl.textContent = scalar;
    summary.append(keyEl, valueEl); details.append(summary);
    if (isObj) {
      const children = document.createElement('div'); children.className = 'wb-children';
      for (const [k, v] of entries) { const child = make(v, k, depth + 1, nextAncestors); if (child) children.append(child); }
      details.append(children);
    }
    return details;
  };
  function subtreeHas(key, val, needle, seen) {
    if (String(key).toLocaleLowerCase().includes(needle) || String(val).toLocaleLowerCase().includes(needle)) return true;
    if (val && typeof val === 'object') {
      if (seen.has(val)) return false;
      seen.add(val);
      return Object.entries(val).some(([k, v]) => subtreeHas(k, v, needle, seen));
    }
    return false;
  }
  const root = make(value, null, 0);
  if (root) container.append(root);
  tree.append(container);
  if (!root) { tree.textContent = 'No matching keys or values.'; tree.classList.add('empty'); }
  else if (q) { const note = document.createElement('p'); note.className = 'muted wb-match-count'; note.textContent = `${matches} matching ${matches === 1 ? 'entry' : 'entries'}`; tree.prepend(note); }
}
function validateAndShow() {
  updateMetrics();
  if (!source.value.trim()) { parsed = undefined; parsedFormat = null; renderTree(undefined); tell(''); return false; }
  try {
    const result = parse(); parsed = result.value; parsedFormat = result.format;
    renderTree(parsed, $('#search').value); tell(`Valid ${parsedFormat.toUpperCase()}`); return true;
  } catch (e) {
    parsed = undefined; parsedFormat = null; renderTree(undefined);
    const loc = locationForError(e, source.value);
    tell(`${e.message || 'Could not parse input'}${loc ? ` (line ${loc.line}, column ${loc.column})` : ''}`, true);
    return false;
  }
}
function serialize(value, format) {
  if (format === 'yaml') return stringify(value);
  return JSON.stringify(value, null, $('#minify').checked ? 0 : 2);
}
function transform() {
  if (!validateAndShow()) return;
  try { source.value = serialize(parsed, outputFormat.value); inputFormat.value = outputFormat.value; validateAndShow(); persist(); tell(`Converted to ${outputFormat.value.toUpperCase()}`); }
  catch (e) { tell(e.message || 'Could not convert this value.', true); }
}
function persist() {
  clearTimeout(saveTimer); saveState.textContent = 'Saving locally…';
  saveTimer = setTimeout(() => {
    try {
      if (byteSize(source.value) <= MAX_BYTES) { localStorage.setItem(STORAGE_KEY, source.value); saveState.textContent = 'Saved on this device'; }
      else { localStorage.removeItem(STORAGE_KEY); saveState.textContent = 'Over 1 MiB · not saved'; }
    } catch { saveState.textContent = 'Local save unavailable'; }
  }, 350);
}
source.addEventListener('input', () => { validateAndShow(); persist(); });
inputFormat.addEventListener('change', validateAndShow);
$('#search').addEventListener('input', () => { if (parsed !== undefined) renderTree(parsed, $('#search').value); });
$('#format').addEventListener('click', () => {
  if (!validateAndShow()) return;
  try { source.value = serialize(parsed, parsedFormat); validateAndShow(); tell(`Formatted ${parsedFormat.toUpperCase()}`); persist(); }
  catch (e) { tell(e.message || 'Could not format input.', true); }
});
$('#convert').addEventListener('click', transform);
$('#minify').addEventListener('change', () => { if (parsed !== undefined && outputFormat.value === 'json') transform(); });
$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(source.value); tell('Copied to clipboard.'); }
  catch { tell('Clipboard access is unavailable in this browser.', true); }
});
$('#download').addEventListener('click', () => {
  const format = outputFormat.value, ext = format === 'yaml' ? 'yaml' : 'json';
  if (!validateAndShow()) return;
  try {download(`workbench.${ext}`, serialize(parsed,format), format === 'yaml' ? 'text/yaml' : 'application/json'); tell('Download started.');} catch (e) {tell(e.message,true);}
});
$('#file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  if (file.size > MAX_BYTES) { tell('Choose a file smaller than 1 MiB.', true); return; }
  try { source.value = await file.text(); inputFormat.value = /\.ya?ml$/i.test(file.name) ? 'yaml' : /\.json$/i.test(file.name) ? 'json' : 'auto'; validateAndShow(); persist(); }
  catch { tell('Could not read that file.', true); }
});
$('#clear').addEventListener('click', () => {
  if (source.value && !window.confirm('Clear the editor and remove its local saved copy?')) return;
  clearTimeout(saveTimer); source.value = ''; try {localStorage.removeItem(STORAGE_KEY);} catch {}; saveState.textContent = 'Cleared'; validateAndShow(); tell('');
});
source.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#format').click(); } });
try { const saved = localStorage.getItem(STORAGE_KEY); if (saved && byteSize(saved) <= MAX_BYTES) { source.value = saved; saveState.textContent = 'Restored from this device'; } }
catch { saveState.textContent = 'Local save unavailable'; }
validateAndShow();
