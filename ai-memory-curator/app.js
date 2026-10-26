import { api, escapeHtml as esc, download, notice } from './ui.js';

const root = document.querySelector('main#app');
const statuses = ['active', 'archived'];
const confidences = ['confirmed', 'uncertain'];
let memories = [];
let version = null;
let dataset = 'private';
let selectedId = null;
let draft = null;
let dirty = false;
let busy = false;
let search = '';
let statusFilter = 'active';
let noticeText = '';
let noticeKind = 'muted';
let aiSuggestion = '';
let staleDataset = false;

const newId = () => globalThis.crypto?.randomUUID?.() || `memory-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const newMemory = () => ({ id: newId(), title: '', content: '', tags: [], source: '', confidence: 'confirmed', status: 'active', createdAt: Date.now(), updatedAt: Date.now() });
const selectedMemory = () => memories.find((memory) => memory.id === selectedId) || null;
const normalize = (text) => String(text || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const statusName = (status) => status === 'archived' ? 'Archived' : 'Active';
const confidenceName = (value) => value === 'uncertain' ? 'Uncertain' : 'Confirmed';

function setNotice(text = '', kind = 'muted') { noticeText = text; noticeKind = kind; }
function escaped(value) { return esc(String(value ?? '')); }
function filteredMemories() {
  const query = normalize(search);
  return memories.filter((item) => {
    if (statusFilter && item.status !== statusFilter) return false;
    return !query || [item.title, item.content, item.source, ...(item.tags || [])].some((part) => normalize(part).includes(query));
  }).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
}
function matchesFor(memory) {
  const target = normalize(memory?.content);
  if (!target) return [];
  return memories.filter((item) => item.id !== memory.id && normalize(item.content) === target);
}
function syncStatus(text, kind = 'muted') {
  setNotice(text, kind);
  const element = document.querySelector('#curator-status');
  if (element) { element.className = `curator-status ${kind}`; element.textContent = text; }
}

function render() {
  if (!root) return;
  const selected = selectedMemory();
  const editing = draft || selected || newMemory();
  const shown = filteredMemories();
  const duplicateMatches = matchesFor(editing);
  root.innerHTML = `
    <section class="curator-layout grid">
      <aside class="curator-list card" aria-label="Saved memories">
        <div class="toolbar curator-list-head"><div><h2>Memories</h2><span class="muted">${memories.length} ${memories.length === 1 ? 'memory' : 'memories'}</span></div><button type="button" class="primary" data-action="new" ${busy ? 'disabled' : ''}>Add memory</button></div>
        <label class="curator-control">Shared dataset alias<input id="dataset-input" type="text" maxlength="120" value="${escaped(dataset)}" placeholder="private" ${busy ? 'disabled' : ''}></label>
        <div class="toolbar curator-dataset-actions"><span class="muted">Current: <strong>${escaped(dataset)}</strong></span><div class="toolbar">${staleDataset ? `<button type="button" data-action="reload-dataset" ${busy ? 'disabled' : ''}>Reload latest</button>` : ''}<button type="button" data-action="switch-dataset" ${busy ? 'disabled' : ''}>Open dataset</button></div></div>
        <label class="curator-control">Search memories<input id="memory-search" type="search" value="${escaped(search)}" placeholder="Search title, content, tags…" autocomplete="off"></label>
        <label class="curator-control">Show<select id="status-filter"><option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Active</option><option value="archived" ${statusFilter === 'archived' ? 'selected' : ''}>Archived</option><option value="" ${!statusFilter ? 'selected' : ''}>All memories</option></select></label>
        <div class="curator-memory-list" role="list" aria-label="Memory results">
          ${shown.length ? shown.map((memory) => `<button type="button" class="curator-memory ${memory.id === selectedId ? 'selected' : ''}" role="listitem" data-action="select" data-id="${escaped(memory.id)}" aria-current="${memory.id === selectedId ? 'true' : 'false'}" ${busy ? 'disabled' : ''}><span class="curator-memory-title">${escaped(memory.title || 'Untitled memory')}</span><span class="curator-memory-preview">${escaped(memory.content || 'No content')}</span><span class="badge">${statusName(memory.status)}</span></button>`).join('') : `<div class="empty">${memories.length ? 'No memories match this view.' : 'No memories saved yet. Add one when you are ready.'}</div>`}
        </div>
        <div class="toolbar curator-export"><button type="button" data-action="export-markdown" ${!memories.some((m) => m.status === 'active') || busy ? 'disabled' : ''}>Export active Markdown</button><button type="button" data-action="export-json" ${(!memories.length && !(dirty && draft)) || busy ? 'disabled' : ''}>Export all JSON</button></div>
      </aside>
      <section class="curator-editor card" aria-label="Memory editor">
        <div class="toolbar curator-editor-head"><div><h2>${selected || draft ? escaped(editing.title || 'Untitled memory') : 'New memory'}</h2><span id="curator-status" class="curator-status ${noticeKind}" role="status" aria-live="polite">${escaped(noticeText || (dirty ? 'Unsaved changes' : selected ? 'Saved' : 'Ready for a new memory'))}</span></div><div class="toolbar curator-actions">${selected ? `<button type="button" data-action="duplicate" ${busy ? 'disabled' : ''}>Duplicate</button><button type="button" data-action="toggle-archive" ${busy ? 'disabled' : ''}>${selected.status === 'archived' ? 'Restore' : 'Archive'}</button><button type="button" class="danger" data-action="delete" ${busy ? 'disabled' : ''}>Delete</button>` : ''}</div></div>
        <div id="duplicate-suggestions">${duplicateMarkup(duplicateMatches)}</div>
        ${renderEditor(editing)}
        <section class="curator-assist" aria-labelledby="ai-heading"><div class="toolbar"><div><h3 id="ai-heading">AI suggestion</h3><p class="muted">Generate a draft from this memory, then review it before applying.</p></div><button type="button" data-action="suggest" ${busy || !editing.content.trim() ? 'disabled' : ''}>${busy && noticeText === 'Generating suggestion…' ? 'Generating…' : 'Suggest summary'}</button></div>${aiSuggestion ? `<div class="curator-suggestion"><pre>${escaped(aiSuggestion)}</pre><button type="button" data-action="apply-suggestion" ${busy ? 'disabled' : ''}>Use as content</button></div>` : ''}</section>
      </section>
    </section>`;
  bindEvents();
}

function renderEditor(memory) {
  return `<form id="memory-form" class="curator-form"><div class="curator-fields">
    <label class="curator-control curator-wide">Title<input name="title" type="text" maxlength="200" placeholder="A concise memory" value="${escaped(memory.title)}" ${busy ? 'disabled' : ''} required></label>
    <label class="curator-control curator-wide">Content<textarea name="content" rows="8" placeholder="Write the information to remember…" ${busy ? 'disabled' : ''} required>${escaped(memory.content)}</textarea></label>
    <label class="curator-control">Tags<input name="tags" type="text" value="${escaped((memory.tags || []).join(', '))}" placeholder="Comma-separated tags" ${busy ? 'disabled' : ''}></label>
    <label class="curator-control">Source<input name="source" type="text" maxlength="300" value="${escaped(memory.source)}" placeholder="Where this came from" ${busy ? 'disabled' : ''}></label>
    <label class="curator-control">Confidence<select name="confidence" ${busy ? 'disabled' : ''}>${confidences.map((confidence) => `<option value="${confidence}" ${(memory.confidence || 'confirmed') === confidence ? 'selected' : ''}>${confidenceName(confidence)}</option>`).join('')}</select></label>
  </div><div class="toolbar curator-savebar"><span class="muted">${dirty ? 'Changes not saved' : selectedMemory() ? 'All changes saved' : 'New memory'}</span><button type="submit" class="primary" ${busy || !dirty ? 'disabled' : ''}>${busy ? 'Saving…' : 'Save memory'}</button></div></form>`;
}
function duplicateMarkup(matches) {
  return matches.length ? `<div class="curator-duplicate" role="status"><strong>Possible duplicate:</strong> This content matches ${matches.map((item) => `<button type="button" data-action="select" data-id="${escaped(item.id)}">${escaped(item.title || 'Untitled memory')}</button>`).join(', ')}. Review it yourself; nothing has been merged.</div>` : '';
}

function readForm(form) {
  const data = new FormData(form);
  return { ...(draft || selectedMemory() || newMemory()), title: String(data.get('title') || '').trim(), content: String(data.get('content') || '').trim(), tags: String(data.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean), source: String(data.get('source') || '').trim(), confidence: confidences.includes(data.get('confidence')) ? data.get('confidence') : 'confirmed' };
}
function equivalent(a, b) {
  return ['title', 'content', 'source', 'confidence'].every((key) => (a[key] || '') === (b[key] || '')) && JSON.stringify(a.tags || []) === JSON.stringify(b.tags || []);
}
function syncDraft() {
  const form = document.querySelector('#memory-form'); if (!form) return;
  draft = readForm(form);
  dirty = !selectedMemory() || !equivalent(selectedMemory(), draft);
  const status = document.querySelector('#curator-status');
  if (status) { status.className = `curator-status ${dirty ? 'warning' : 'muted'}`; status.textContent = dirty ? 'Unsaved changes' : 'Saved'; }
  const duplicates = document.querySelector('#duplicate-suggestions');
  if (duplicates) { duplicates.innerHTML = duplicateMarkup(matchesFor(draft)); duplicates.querySelectorAll('[data-action="select"]').forEach((button) => button.addEventListener('click', () => perform('select', button.dataset.id))); }
  const submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = busy || !dirty;
  const saveNote = form.querySelector('.curator-savebar .muted'); if (saveNote) saveNote.textContent = dirty ? 'Changes not saved' : selectedMemory() ? 'All changes saved' : 'New memory';
}
function bindEvents() {
  const form = document.querySelector('#memory-form');
  form?.addEventListener('input', syncDraft); form?.addEventListener('change', syncDraft);
  form?.addEventListener('submit', (event) => { event.preventDefault(); saveMemory(); });
  document.querySelector('#memory-search')?.addEventListener('input', (event) => { search = event.target.value; const caret = event.target.selectionStart; render(); const input = document.querySelector('#memory-search'); input?.focus(); input?.setSelectionRange(caret, caret); });
  document.querySelector('#status-filter')?.addEventListener('change', (event) => { statusFilter = event.target.value; render(); });
  root?.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => perform(button.dataset.action, button.dataset.id)));
}
function mayLeave() { return !dirty || window.confirm('You have unsaved changes. Discard them and continue?'); }

async function perform(action, id) {
  if (busy) return;
  if (action === 'new') { if (!mayLeave()) return; selectedId = null; draft = newMemory(); dirty = false; aiSuggestion = ''; setNotice(); render(); return; }
  if (action === 'select') { if (id === selectedId || !mayLeave()) return; selectedId = id; draft = null; dirty = false; aiSuggestion = ''; setNotice(); render(); return; }
  if (action === 'switch-dataset') { await switchDataset(); return; }
  if (action === 'reload-dataset') { await reloadDataset(); return; }
  if (action === 'duplicate') {
    if (!mayLeave()) return;
    const source = selectedMemory(); if (!source) return;
    selectedId = null; draft = { ...source, id: newId(), title: `${source.title || 'Untitled memory'} (copy)`, tags: [...(source.tags || [])], status: 'active', createdAt: Date.now(), updatedAt: Date.now() }; dirty = true; aiSuggestion = ''; setNotice('Duplicate ready to save'); render(); return;
  }
  if (action === 'delete') { await deleteMemory(); return; }
  if (action === 'toggle-archive') { await archiveMemory(); return; }
  if (action === 'export-markdown') { exportMarkdown(); return; }
  if (action === 'export-json') { download(`memory-curator-${filename(dataset)}.json`, JSON.stringify({ dataset, memories, ...(dirty && draft ? { unsavedDraft: draft } : {}) }, null, 2), 'application/json;charset=utf-8'); return; }
  if (action === 'suggest') { await suggest(); return; }
  if (action === 'apply-suggestion') { applySuggestion(); }
}

async function switchDataset() {
  const input = document.querySelector('#dataset-input');
  const requested = String(input?.value || '').trim() || 'private';
  if (requested === dataset) { syncStatus('Already viewing this dataset.'); return; }
  if (!mayLeave()) { if (input) input.value = dataset; return; }
  busy = true; render();
  try {
    const result = await api('load', { dataset: requested });
    memories = Array.isArray(result?.value?.memories) ? result.value.memories : [];
    version = result?.version ?? null; dataset = requested; selectedId = null; draft = null; dirty = false; aiSuggestion = ''; staleDataset = false; busy = false; setNotice(`Opened dataset “${dataset}”.`); render();
  } catch (error) { busy = false; setNotice(error?.message || `Could not open dataset “${requested}”.`, 'error'); render(); notice(error?.message || 'Could not open that dataset.'); }
}
async function reloadDataset() {
  if (dirty && !window.confirm('Reloading will discard your unsaved changes. Continue?')) return;
  busy = true; render();
  try {
    const result = await api('load', { dataset });
    memories = Array.isArray(result?.value?.memories) ? result.value.memories : [];
    version = result?.version ?? null;
    selectedId = null; draft = null; dirty = false; staleDataset = false; aiSuggestion = ''; busy = false; setNotice('Loaded the latest dataset version.'); render();
  } catch (error) { busy = false; setNotice(error?.message || 'Could not reload this dataset.', 'error'); render(); }
}

async function saveMemory() {
  const form = document.querySelector('#memory-form'); if (!form || busy || !form.reportValidity()) return;
  const value = readForm(form);
  if (!value.title || !value.content) { syncStatus('Add a title and content before saving.', 'error'); return; }
  value.updatedAt = Date.now();
  if (!selectedMemory()) value.createdAt = value.createdAt || Date.now();
  const next = memories.some((item) => item.id === value.id) ? memories.map((item) => item.id === value.id ? value : item) : [...memories, value];
  busy = true; syncStatus('Saving…'); render();
  try {
    const result = await api('save', { value: { memories: next }, version, dataset });
    memories = Array.isArray(result?.value?.memories) ? result.value.memories : next; version = result?.version ?? version; selectedId = value.id; draft = null; dirty = false; staleDataset = false; busy = false; setNotice('Saved'); render();
  } catch (error) {
    busy = false; draft = value; dirty = true;
    const conflict = /conflict|version|modified/i.test(error?.message || '');
    staleDataset = conflict;
    setNotice(conflict ? 'Save conflict: this dataset changed elsewhere. Your edits are still here; reload before saving again.' : (error?.message || 'Could not save. Your edits are still here.'), 'error'); render();
  }
}
async function deleteMemory() {
  const memory = selectedMemory();
  if (!memory || !mayLeave() || !window.confirm(`Delete “${memory.title || 'Untitled memory'}”? This cannot be undone.`)) return;
  await commitList(memories.filter((item) => item.id !== memory.id), 'Memory deleted', null);
}
async function archiveMemory() {
  const memory = selectedMemory(); if (!memory || !mayLeave()) return;
  const archived = { ...memory, status: memory.status === 'archived' ? 'active' : 'archived', updatedAt: Date.now() };
  const next = memories.map((item) => item.id === memory.id ? archived : item);
  await commitList(next, archived.status === 'archived' ? 'Memory archived' : 'Memory restored', memory.id);
}
async function commitList(next, successText, keepId) {
  busy = true; render();
  try {
    const result = await api('save', { value: { memories: next }, version, dataset });
    memories = Array.isArray(result?.value?.memories) ? result.value.memories : next; version = result?.version ?? version; selectedId = keepId; draft = null; dirty = false; staleDataset = false; busy = false; setNotice(successText); render();
  } catch (error) { busy = false; staleDataset = /conflict|version|modified/i.test(error?.message || ''); setNotice(error?.message || 'Could not update this dataset.', 'error'); render(); }
}
async function suggest() {
  const form = document.querySelector('#memory-form'); if (!form || busy) return;
  const value = readForm(form); if (!value.content.trim()) return;
  busy = true; setNotice('Generating suggestion…'); render();
  try {
    const result = await api('suggest', { content: value.content, dataset });
    aiSuggestion = String(result?.text || '').trim(); busy = false; setNotice(aiSuggestion ? 'Suggestion ready for your review.' : 'No suggestion was returned.'); render();
  } catch (error) { busy = false; setNotice(error?.message || 'Could not generate a suggestion.', 'error'); render(); }
}
function applySuggestion() {
  if (!aiSuggestion) return;
  const form = document.querySelector('#memory-form'); const textarea = form?.elements.content;
  if (!textarea) return;
  textarea.value = aiSuggestion; textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.focus();
  setNotice('Suggestion placed in content. Review it before saving.'); render();
}
function exportMarkdown() {
  const active = memories.filter((item) => item.status === 'active'); if (!active.length) return;
  const body = active.map((item) => [`# ${item.title || 'Untitled memory'}`, '', item.content || '', '', `- **Tags:** ${(item.tags || []).join(', ') || '—'}`, `- **Source:** ${item.source || '—'}`, `- **Confidence:** ${confidenceName(item.confidence)}`, ''].join('\n')).join('\n---\n\n');
  download(`active-memories-${filename(dataset)}.md`, `${body.trim()}\n`, 'text/markdown;charset=utf-8');
}
function filename(value) { return String(value || 'private').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'private'; }

const style = document.createElement('style');
style.textContent = `
.curator-layout{display:grid;grid-template-columns:minmax(250px,320px) minmax(0,1fr);gap:1rem;align-items:start}.curator-list,.curator-editor{padding:1rem;min-width:0}
.curator-list-head,.curator-editor-head{justify-content:space-between;align-items:center;gap:.8rem;margin-bottom:1rem}.curator-list-head h2,.curator-editor-head h2{margin:0 0 .2rem;font-size:1.15rem}
.curator-control{display:flex;flex-direction:column;gap:.4rem;font-size:.9rem;font-weight:600;min-width:0}.curator-control input,.curator-control select,.curator-control textarea{box-sizing:border-box;width:100%;padding:.65rem .7rem;border:1px solid var(--border-color,#d3d7dd);border-radius:.5rem;background:var(--surface,#fff);color:inherit;font:inherit;font-weight:400}.curator-control textarea{resize:vertical;line-height:1.5}
.curator-dataset-actions{justify-content:space-between;align-items:center;gap:.5rem;margin:.4rem 0 1rem}.curator-dataset-actions button,.curator-export button,.curator-actions button{padding:.5rem .65rem;border:1px solid var(--border-color,#d3d7dd);border-radius:.45rem;background:transparent;color:inherit;font:inherit;cursor:pointer}.curator-list>.curator-control{margin:.75rem 0}
.curator-memory-list{display:flex;flex-direction:column;gap:.5rem;max-height:50vh;overflow:auto;margin:.8rem 0}.curator-memory{display:grid;gap:.35rem;width:100%;padding:.7rem;border:1px solid var(--border-color,#d3d7dd);border-radius:.6rem;background:transparent;color:inherit;text-align:left;cursor:pointer}.curator-memory.selected{border-color:var(--accent,#4469e8);box-shadow:0 0 0 1px var(--accent,#4469e8)}.curator-memory-title{font-weight:700;overflow-wrap:anywhere}.curator-memory-preview{font-size:.82rem;opacity:.76;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.curator-export{justify-content:space-between;gap:.5rem;flex-wrap:wrap;padding-top:.75rem;border-top:1px solid var(--border-color,#d3d7dd)}
.curator-actions{gap:.45rem;flex-wrap:wrap}.curator-actions .danger{color:#a52828;border-color:#d5a4a4}.curator-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem}.curator-wide{grid-column:1/-1}.curator-savebar{justify-content:space-between;align-items:center;padding-top:1rem;margin-top:1rem;border-top:1px solid var(--border-color,#d3d7dd)}.curator-status{font-size:.88rem}.curator-status.error{color:#a52828}.curator-status.warning{color:#8a5a00}.curator-status.muted{opacity:.72}.curator-duplicate{padding:.75rem;margin:0 0 1rem;border:1px solid #d8bc75;border-radius:.5rem;background:#fff8e6;color:#624b16;line-height:1.5}.curator-duplicate button{margin-left:.3rem;border:0;background:none;color:inherit;text-decoration:underline;cursor:pointer;font:inherit}
.curator-assist{margin-top:1.3rem;padding-top:1rem;border-top:1px solid var(--border-color,#d3d7dd)}.curator-assist h3{margin:0}.curator-assist p{margin:.25rem 0}.curator-assist>.toolbar{justify-content:space-between;gap:.8rem}.curator-suggestion{margin-top:.7rem;padding:.8rem;border:1px solid var(--border-color,#d3d7dd);border-radius:.5rem}.curator-suggestion pre{margin:0 0 .75rem;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.5}.curator-layout button:disabled{opacity:.55;cursor:not-allowed}
:is([data-theme="dark"],.dark,.theme-dark) .curator-status.error{color:#ffb2bd}:is([data-theme="dark"],.dark,.theme-dark) .curator-status.warning{color:#ffd293}
@media(prefers-color-scheme:dark){.curator-status.error{color:#ffb2bd}.curator-status.warning{color:#ffd293}}
@media(max-width:800px){.curator-layout{grid-template-columns:1fr}.curator-memory-list{max-height:32vh}}@media(max-width:520px){.curator-fields{grid-template-columns:1fr}.curator-wide{grid-column:auto}.curator-list-head{align-items:flex-start;flex-direction:column}}
`;
document.head.append(style);

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

(async function loadCurrent() {
  if (!root) return;
  root.innerHTML = '<section class="card"><p class="muted" role="status">Loading memories…</p></section>';
  try {
    const result = await api('load', { dataset });
    memories = Array.isArray(result?.value?.memories) ? result.value.memories : [];
    version = result?.version ?? null;
    render();
  } catch (error) {
    root.innerHTML = `<section class="card"><p class="curator-status error" role="alert">${escaped(error?.message || 'Could not load memories.')}</p><button type="button" class="primary" id="retry-load">Try again</button></section>`;
    document.querySelector('#retry-load')?.addEventListener('click', loadCurrent);
    notice(error?.message || 'Could not load memories.');
  }
})();
