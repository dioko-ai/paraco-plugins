import { api, escapeHtml as esc, download, notice } from './ui.js';

const root = document.querySelector('main#app');
const statuses = ['planned', 'in-progress', 'complete'];
let entries = [];
let version = null;
let selectedId = null;
let draft = null;
let dirty = false;
let busy = false;
let searchTerm = '';
let projectFilter = '';
let statusFilter = '';
let message = '';
let messageKind = 'muted';

const uid = () => globalThis.crypto?.randomUUID?.() || `experiment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const blankEntry = () => ({ id: uid(), title: '', project: '', tags: [], date: today(), hypothesis: '', method: '', observations: '', conclusion: '', status: 'planned', createdAt: Date.now(), updatedAt: Date.now() });
const currentEntry = () => entries.find((entry) => entry.id === selectedId) || null;
const setMessage = (text = '', kind = 'muted') => { message = text; messageKind = kind; };
const byDate = (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);

function announce(text, kind = 'muted') {
  setMessage(text, kind);
  const status = document.querySelector('#notebook-status');
  if (status) {
    status.className = `notebook-status ${kind}`;
    status.textContent = text;
  }
}

function visibleEntries() {
  const query = searchTerm.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (projectFilter && entry.project !== projectFilter) return false;
    if (statusFilter && entry.status !== statusFilter) return false;
    if (!query) return true;
    return [entry.title, entry.project, ...(entry.tags || []), entry.hypothesis, entry.method, entry.observations, entry.conclusion]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
  }).sort(byDate);
}

function render() {
  if (!root) return;
  const projects = [...new Set(entries.map((entry) => entry.project.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const shown = visibleEntries();
  const active = currentEntry();
  const editing = draft || active || blankEntry();
  root.innerHTML = `
    <section class="notebook-layout grid">
      <aside class="notebook-sidebar card" aria-label="Experiment list">
        <div class="toolbar notebook-list-toolbar">
          <div><h2>Experiments</h2><span class="muted">${entries.length} ${entries.length === 1 ? 'record' : 'records'}</span></div>
          <button class="primary" type="button" data-action="new" ${busy ? 'disabled' : ''}>New experiment</button>
        </div>
        <label class="notebook-control">Search experiments<input id="search" type="search" placeholder="Title, project, notes…" value="${esc(searchTerm)}" autocomplete="off"></label>
        <div class="notebook-filters">
          <label class="notebook-control">Project<select id="project-filter"><option value="">All projects</option>${projects.map((project) => `<option value="${esc(project)}" ${project === projectFilter ? 'selected' : ''}>${esc(project)}</option>`).join('')}</select></label>
          <label class="notebook-control">Status<select id="status-filter"><option value="">All statuses</option>${statuses.map((status) => `<option value="${status}" ${status === statusFilter ? 'selected' : ''}>${statusLabel(status)}</option>`).join('')}</select></label>
        </div>
        <div class="notebook-entry-list" role="list" aria-label="Filtered experiments">
          ${shown.length ? shown.map((entry) => `<button class="notebook-entry ${entry.id === selectedId ? 'selected' : ''}" type="button" role="listitem" data-action="select" data-id="${esc(entry.id)}" aria-current="${entry.id === selectedId ? 'true' : 'false'}" ${busy ? 'disabled' : ''}>
            <span class="notebook-entry-title">${esc(entry.title.trim() || 'Untitled experiment')}</span>
            <span class="notebook-entry-meta">${esc(entry.project || 'No project')} · ${esc(entry.date || '')}</span>
            <span class="badge status-${esc(entry.status)}">${statusLabel(entry.status)}</span>
          </button>`).join('') : `<div class="empty">${entries.length ? 'No experiments match these filters.' : 'No experiments yet. Create one to start recording your work.'}</div>`}
        </div>
        <div class="notebook-export toolbar">
          <button type="button" data-action="export-selected" ${!(draft || active) || busy ? 'disabled' : ''}>Export Markdown</button>
          <button type="button" data-action="export-json" ${(!entries.length && !(draft && dirty)) || busy ? 'disabled' : ''}>Export all JSON</button>
        </div>
      </aside>
      <section class="notebook-editor card" aria-label="Experiment editor">
        <div class="toolbar notebook-editor-toolbar">
          <div><h2>${active || draft ? (editing.title.trim() ? esc(editing.title) : 'Untitled experiment') : 'New experiment'}</h2><span class="notebook-status ${messageKind}" id="notebook-status" role="status" aria-live="polite">${esc(message || (dirty ? 'Unsaved changes' : active ? 'Saved' : 'Ready for a new experiment'))}</span></div>
          ${active ? `<div class="toolbar notebook-actions"><button type="button" data-action="duplicate" ${busy ? 'disabled' : ''}>Duplicate</button><button class="danger" type="button" data-action="delete" ${busy ? 'disabled' : ''}>Delete</button></div>` : ''}
        </div>
        ${renderForm(editing)}
      </section>
    </section>`;
  bindEvents();
}

function statusLabel(status) {
  return ({ planned: 'Planned', 'in-progress': 'In progress', complete: 'Complete' })[status] || 'Planned';
}

function renderForm(entry) {
  const tags = (entry.tags || []).join(', ');
  const persisted = entries.some((item) => item.id === entry.id);
  return `<form id="experiment-form" class="notebook-form">
    <div class="notebook-fields-grid">
      <label class="notebook-control notebook-span-2">Experiment title<input name="title" type="text" maxlength="200" placeholder="Give this experiment a clear name" value="${esc(entry.title || '')}" ${busy ? 'disabled' : ''} required></label>
      <label class="notebook-control">Project<input name="project" type="text" maxlength="120" placeholder="Project or study" value="${esc(entry.project || '')}" ${busy ? 'disabled' : ''}></label>
      <label class="notebook-control">Date<input name="date" type="date" value="${esc(entry.date || '')}" ${busy ? 'disabled' : ''}></label>
      <label class="notebook-control">Status<select name="status" ${busy ? 'disabled' : ''}>${statuses.map((status) => `<option value="${status}" ${entry.status === status ? 'selected' : ''}>${statusLabel(status)}</option>`).join('')}</select></label>
      <label class="notebook-control">Tags<input name="tags" type="text" placeholder="Separate tags with commas" value="${esc(tags)}" ${busy ? 'disabled' : ''}></label>
      <label class="notebook-control notebook-span-2">Hypothesis<textarea name="hypothesis" rows="3" placeholder="What do you expect to happen?" ${busy ? 'disabled' : ''}>${esc(entry.hypothesis || '')}</textarea></label>
      <label class="notebook-control notebook-span-2">Method<textarea name="method" rows="4" placeholder="Record materials, setup, and procedure…" ${busy ? 'disabled' : ''}>${esc(entry.method || '')}</textarea></label>
      <label class="notebook-control notebook-span-2">Observations<textarea name="observations" rows="5" placeholder="Record results and observations…" ${busy ? 'disabled' : ''}>${esc(entry.observations || '')}</textarea></label>
      <label class="notebook-control notebook-span-2">Conclusion<textarea name="conclusion" rows="3" placeholder="What did you learn? What comes next?" ${busy ? 'disabled' : ''}>${esc(entry.conclusion || '')}</textarea></label>
    </div>
    <div class="toolbar notebook-savebar"><span class="muted">${dirty ? 'Changes not saved' : persisted ? 'All changes saved' : 'New experiment'}</span><button class="primary" type="submit" ${busy || !dirty ? 'disabled' : ''}>${busy ? 'Saving…' : 'Save experiment'}</button></div>
  </form>`;
}

function readForm(form) {
  const data = new FormData(form);
  return {
    ...(draft || currentEntry() || blankEntry()),
    title: String(data.get('title') || '').trim(),
    project: String(data.get('project') || '').trim(),
    date: String(data.get('date') || ''),
    status: statuses.includes(data.get('status')) ? data.get('status') : 'planned',
    tags: String(data.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    hypothesis: String(data.get('hypothesis') || '').trim(),
    method: String(data.get('method') || '').trim(),
    observations: String(data.get('observations') || '').trim(),
    conclusion: String(data.get('conclusion') || '').trim()
  };
}

function syncDraft() {
  const form = document.querySelector('#experiment-form');
  if (!form) return;
  const next = readForm(form);
  const base = currentEntry();
  draft = next;
  dirty = !base || !sameContent(base, next);
  const status = document.querySelector('#notebook-status');
  if (status) {
    status.textContent = dirty ? 'Unsaved changes' : 'Saved';
    status.className = `notebook-status ${dirty ? 'warning' : 'muted'}`;
  }
  const saveButton = form.querySelector('[type="submit"]');
  if (saveButton) saveButton.disabled = busy || !dirty;
  const saveText = form.querySelector('.notebook-savebar .muted');
  if (saveText) saveText.textContent = dirty ? 'Changes not saved' : base ? 'All changes saved' : 'New experiment';
}

function sameContent(a, b) {
  return ['title', 'project', 'date', 'status', 'hypothesis', 'method', 'observations', 'conclusion'].every((key) => (a[key] || '') === (b[key] || '')) && JSON.stringify(a.tags || []) === JSON.stringify(b.tags || []);
}

function bindEvents() {
  const form = document.querySelector('#experiment-form');
  form?.addEventListener('input', syncDraft);
  form?.addEventListener('change', syncDraft);
  form?.addEventListener('submit', (event) => { event.preventDefault(); saveCurrent(); });
  document.querySelector('#search')?.addEventListener('input', (event) => { searchTerm = event.target.value; const position = event.target.selectionStart; render(); const input = document.querySelector('#search'); input?.focus(); input?.setSelectionRange(position, position); });
  document.querySelector('#project-filter')?.addEventListener('change', (event) => { projectFilter = event.target.value; render(); });
  document.querySelector('#status-filter')?.addEventListener('change', (event) => { statusFilter = event.target.value; render(); });
  root?.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => handleAction(button.dataset.action, button.dataset.id)));
}

async function handleAction(action, id) {
  if (busy) return;
  if (action === 'new') {
    if (!canLeave()) return;
    selectedId = null; draft = blankEntry(); dirty = false; setMessage(); render();
  } else if (action === 'select') {
    if (id === selectedId) return;
    if (!canLeave()) return;
    selectedId = id; draft = null; dirty = false; setMessage(); render();
  } else if (action === 'duplicate') {
    if (!canLeave()) return;
    const source = currentEntry();
    if (!source) return;
    selectedId = null;
    draft = { ...source, id: uid(), title: `${source.title || 'Untitled experiment'} (copy)`, tags: [...(source.tags || [])], createdAt: Date.now(), updatedAt: Date.now() };
    dirty = true; setMessage('Duplicate ready to save'); render();
  } else if (action === 'delete') {
    if (!canLeave()) return;
    const entry = currentEntry();
    if (!entry || !window.confirm(`Delete “${entry.title || 'Untitled experiment'}”? This cannot be undone.`)) return;
    busy = true; render();
    try {
      const remaining = entries.filter((item) => item.id !== entry.id);
      const result = await api('save', { value: { entries: remaining }, version });
      entries = Array.isArray(result?.value?.entries) ? result.value.entries : remaining;
      version = result?.version ?? version;
      selectedId = null; draft = null; dirty = false; busy = false; announce('Experiment deleted'); render();
    } catch (error) { busy = false; announce(error?.message || 'Could not delete the experiment. Try again.', 'error'); render(); }
  } else if (action === 'export-selected') {
    const entry = draft || currentEntry(); if (entry) download(`${safeFilename(entry.title || 'experiment')}.md`, toMarkdown(entry), 'text/markdown;charset=utf-8');
  } else if (action === 'export-json') {
    if (entries.length || (draft && dirty)) {
      const exportedEntries = dirty && draft
        ? (entries.some((entry) => entry.id === draft.id) ? entries.map((entry) => entry.id === draft.id ? draft : entry) : [...entries, draft])
        : entries;
      download('scientific-lab-notebook.json', JSON.stringify({ entries: exportedEntries }, null, 2), 'application/json;charset=utf-8');
    }
  }
}

function canLeave() {
  if (!dirty) return true;
  return window.confirm('You have unsaved changes. Discard them and continue?');
}

async function saveCurrent() {
  const form = document.querySelector('#experiment-form');
  if (!form || busy) return;
  if (!form.reportValidity()) return;
  const value = readForm(form);
  if (!value.title) { announce('Add a title before saving.', 'error'); form.elements.title.focus(); return; }
  value.updatedAt = Date.now();
  if (!currentEntry()) value.createdAt = value.createdAt || Date.now();
  const updated = entries.some((entry) => entry.id === value.id)
    ? entries.map((entry) => entry.id === value.id ? value : entry)
    : [...entries, value];
  busy = true; announce('Saving…'); render();
  try {
    const result = await api('save', { value: { entries: updated }, version });
    entries = Array.isArray(result?.value?.entries) ? result.value.entries : updated;
    version = result?.version ?? version;
    selectedId = value.id; draft = null; dirty = false; busy = false; announce('Saved'); render();
  } catch (error) {
    busy = false;
    const conflict = /conflict|version|modified/i.test(error?.message || '');
    announce(conflict ? 'Save conflict: this notebook changed elsewhere. Your edits are still here; reload before saving again.' : (error?.message || 'Could not save. Your edits are still here.'), 'error');
    draft = value; dirty = true; render();
  }
}

function safeFilename(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'experiment'; }
function toMarkdown(entry) {
  const lines = [`# ${entry.title || 'Untitled experiment'}`, '', `- **Project:** ${entry.project || '—'}`, `- **Date:** ${entry.date || '—'}`, `- **Status:** ${statusLabel(entry.status)}`, `- **Tags:** ${(entry.tags || []).join(', ') || '—'}`];
  for (const [heading, field] of [['Hypothesis', 'hypothesis'], ['Method', 'method'], ['Observations', 'observations'], ['Conclusion', 'conclusion']]) lines.push('', `## ${heading}`, '', entry[field] || '');
  return `${lines.join('\n').trim()}\n`;
}

async function load() {
  if (!root) return;
  root.innerHTML = '<section class="card"><p class="muted" role="status">Loading notebook…</p></section>';
  try {
    const result = await api('load');
    entries = Array.isArray(result?.value?.entries) ? result.value.entries : [];
    version = result?.version ?? null;
    selectedId = entries.slice().sort(byDate)[0]?.id || null;
    render();
  } catch (error) {
    root.innerHTML = `<section class="card"><p class="notebook-status error" role="alert">${esc(error?.message || 'Could not load the notebook.')}</p><button class="primary" type="button" id="retry-load">Try again</button></section>`;
    document.querySelector('#retry-load')?.addEventListener('click', load);
    notice(error?.message || 'Could not load the notebook.');
  }
}

// Small layout rules keep the notebook usable within the app's shared card and form styles.
const style = document.createElement('style');
style.textContent = `
.notebook-layout{display:grid;grid-template-columns:minmax(250px,320px) minmax(0,1fr);gap:1rem;align-items:start}
.notebook-sidebar,.notebook-editor{padding:1rem;min-width:0}
.notebook-list-toolbar,.notebook-editor-toolbar{justify-content:space-between;align-items:center;gap:.8rem;margin-bottom:1rem}
.notebook-list-toolbar h2,.notebook-editor-toolbar h2{margin:0 0 .2rem;font-size:1.15rem}
.notebook-control{display:flex;flex-direction:column;gap:.4rem;font-weight:600;font-size:.9rem;min-width:0}
.notebook-control input,.notebook-control select,.notebook-control textarea{width:100%;box-sizing:border-box;font:inherit;font-weight:400;padding:.65rem .7rem;border:1px solid var(--border-color,#d3d7dd);border-radius:.5rem;background:var(--surface,#fff);color:inherit}
.notebook-control textarea{resize:vertical;line-height:1.5}
.notebook-filters{display:grid;grid-template-columns:1fr 1fr;gap:.65rem;margin:.8rem 0}
.notebook-entry-list{display:flex;flex-direction:column;gap:.5rem;max-height:55vh;overflow:auto;margin:.85rem 0}
.notebook-entry{display:grid;gap:.3rem;text-align:left;padding:.7rem;border:1px solid var(--border-color,#d3d7dd);border-radius:.6rem;background:transparent;color:inherit;cursor:pointer}
.notebook-entry.selected{border-color:var(--accent,#4469e8);box-shadow:0 0 0 1px var(--accent,#4469e8)}
.notebook-entry-title{font-weight:700;overflow-wrap:anywhere}.notebook-entry-meta{font-size:.82rem;opacity:.75}
.notebook-export{justify-content:space-between;gap:.5rem;flex-wrap:wrap;padding-top:.75rem;border-top:1px solid var(--border-color,#d3d7dd)}
.notebook-export button,.notebook-actions button{font:inherit;padding:.5rem .65rem;border:1px solid var(--border-color,#d3d7dd);border-radius:.45rem;background:transparent;color:inherit;cursor:pointer}
.notebook-actions{gap:.5rem;flex-wrap:wrap}.notebook-actions .danger{color:#a52828;border-color:#d5a4a4}
.notebook-form{display:block}.notebook-fields-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.9rem}
.notebook-span-2{grid-column:1/-1}.notebook-savebar{justify-content:space-between;align-items:center;border-top:1px solid var(--border-color,#d3d7dd);margin-top:1rem;padding-top:1rem}
.notebook-status{font-size:.88rem}.notebook-status.error{color:#a52828}.notebook-status.warning{color:#8a5a00}.notebook-status.muted{opacity:.72}
.notebook-entry-list .empty{padding:1rem .4rem}.notebook-editor-toolbar{flex-wrap:wrap}
:is([data-theme="dark"],.dark,.theme-dark) .notebook-status.error{color:#ffb2bd}:is([data-theme="dark"],.dark,.theme-dark) .notebook-status.warning{color:#ffd293}
@media(prefers-color-scheme:dark){.notebook-status.error{color:#ffb2bd}.notebook-status.warning{color:#ffd293}}
.notebook-layout button:disabled{opacity:.55;cursor:not-allowed}
@media(max-width:800px){.notebook-layout{grid-template-columns:1fr}.notebook-entry-list{max-height:34vh}}
@media(max-width:520px){.notebook-fields-grid,.notebook-filters{grid-template-columns:1fr}.notebook-span-2{grid-column:auto}.notebook-list-toolbar{align-items:flex-start;flex-direction:column}}
`;
document.head.append(style);

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

load();
