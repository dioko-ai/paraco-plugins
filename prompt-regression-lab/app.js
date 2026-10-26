import { api, escapeHtml as esc, download, notice } from './ui.js';

const app = document.querySelector('main#app');
app.innerHTML = `
  <section class="card">
    <div class="toolbar"><h2>Test suite</h2><span class="badge">Sequential evaluation</span></div>
    <div class="grid">
      <section><div class="toolbar"><h2>Test cases</h2><button id="add-case">Add case</button></div><div id="case-list" class="empty">Loading test cases…</div></section>
      <section>
        <h2 id="editor-title">New test case</h2>
        <form id="case-form">
          <label>Case name<input id="case-name" required maxlength="100" placeholder="e.g. Answer includes a date"></label>
          <label>Prompt<textarea id="case-prompt" required rows="7" placeholder="Write the prompt to evaluate…"></textarea></label>
          <label>Check rule<select id="case-kind"><option value="contains">Contains text</option><option value="exact">Exact match</option><option value="json">Valid JSON</option></select></label>
          <label id="expected-label">Expected text<input id="case-expected" placeholder="Text the response must contain"></label>
          <p id="rule-help" class="muted">Passes when the response includes this text. Matching is case-sensitive.</p>
          <div class="row"><button class="primary" type="submit">Save case</button><button id="cancel-edit" type="button">Cancel</button></div>
        </form>
      </section>
    </div>
    <div class="toolbar" style="margin-top:24px"><h2>Run settings</h2><div class="row"><button id="run-suite" class="primary">Run suite</button><button id="stop-run" class="danger" disabled>Stop after current check</button></div></div>
    <div class="grid">
      <label>Provider <small>Leave blank to use the host default</small><input id="provider" placeholder="Host default"></label>
      <label>Model <small>Leave blank to use the host default</small><input id="model" placeholder="Host default"></label>
    </div>
    <div id="run-status" class="muted" role="status" aria-live="polite"></div>
  </section>
  <section class="card">
    <div class="toolbar"><div><h2>Results</h2><p class="muted">Changes compare pass/fail outcomes for each case.</p></div><div class="row"><label style="margin:0;min-width:220px">Compare with baseline<select id="baseline"></select></label><button id="export">Export JSON</button></div></div>
    <div id="results" class="empty">Run a suite to create its first result. Previous results will appear here.</div>
  </section>`;

const $ = selector => app.querySelector(selector);
let cases = [], runs = [], version = null, editingId = null, running = false, stopRequested = false, loaded = false;
const uid = () => globalThis.crypto?.randomUUID?.() || `case-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const setRunStatus = (text, error = false) => { const el = $('#run-status'); el.textContent = text; el.className = error ? 'notice error' : 'muted'; };
const kindHelp = {
  contains: ['Expected text', 'Passes when the response includes this text. Matching is case-sensitive.'],
  exact: ['Expected response', 'Passes when the response matches this text after outer whitespace is trimmed.'],
  json: ['', 'Passes when the response is valid JSON. The check validates syntax; it does not compare against a target value.']
};

function renderCases() {
  const box = $('#case-list');
  if (!cases.length) { box.className = 'empty'; box.textContent = 'No test cases yet. Add a case to define a prompt and a deterministic check.'; return; }
  box.className = '';
  box.innerHTML = cases.map(item => `<article class="list-item"><div class="toolbar"><strong>${esc(item.name)}</strong><span class="badge">${esc(item.kind)}</span></div><p class="muted">${esc(item.prompt.length > 160 ? `${item.prompt.slice(0, 160)}…` : item.prompt)}</p><div class="row"><button type="button" data-edit="${esc(item.id)}">Edit</button><button type="button" class="danger" data-delete="${esc(item.id)}">Delete</button></div></article>`).join('');
}
function clearForm() {
  editingId = null; $('#case-form').reset(); $('#editor-title').textContent = 'New test case'; $('#case-form button[type="submit"]').textContent = 'Save case'; updateRuleHelp();
}
function updateRuleHelp() {
  const [label, help] = kindHelp[$('#case-kind').value];
  $('#expected-label').firstChild.textContent = label ? `${label} ` : '';
  $('#case-expected').required = $('#case-kind').value === 'contains';
  $('#case-expected').placeholder = $('#case-kind').value === 'json' ? 'Optional JSON value to compare' : 'Enter expected text';
  $('#rule-help').textContent = help;
  $('#expected-label').hidden = $('#case-kind').value === 'json';
}
async function persistCases(next) {
  if (!loaded) { notice('Cases are not loaded yet. Try again shortly.', true); return false; }
  try {
    const saved = await api('save', { value: { cases: next, runs }, version });
    cases = Array.isArray(saved.value?.cases) ? saved.value.cases : next;
    runs = Array.isArray(saved.value?.runs) ? saved.value.runs : runs;
    version = saved.version; renderCases(); renderRuns(); notice('Test cases saved.'); return true;
  } catch (error) {
    notice(`${error.message || 'Could not save cases.'} Your edits were kept in the editor; reload before saving again.`, true);
    await reloadState(); return false;
  }
}
async function reloadState() {
  try {
    const data = await api('load');
    cases = Array.isArray(data.value?.cases) ? data.value.cases : [];
    runs = Array.isArray(data.value?.runs) ? data.value.runs : [];
    version = data.version; loaded = true; renderCases(); renderRuns();
  } catch (error) { notice(error.message || 'Could not load saved cases.', true); }
}
function resultFor(run, caseId) { return run?.results?.find(item => item.caseId === caseId); }
function comparison(current, baseline) {
  if (!baseline) return 'uncompared';
  if (current.passed === baseline.passed) return 'unchanged';
  return current.passed ? 'improved' : 'regressed';
}
function renderRuns() {
  const baselineSelect = $('#baseline'), prior = baselineSelect.value;
  baselineSelect.innerHTML = `<option value="">No baseline</option>${runs.slice(1).map(run => `<option value="${esc(run.id)}">${esc(new Date(run.createdAt).toLocaleString())}</option>`).join('')}`;
  if (runs.slice(1).some(run => run.id === prior)) baselineSelect.value = prior;
  else if (runs.length > 1) baselineSelect.value = runs[1].id;
  const box = $('#results');
  if (!runs.length) { box.className = 'empty'; box.textContent = 'Run a suite to create its first result. Previous results will appear here.'; return; }
  const latest = runs[0];
  const base = runs.find(run => run.id === baselineSelect.value) || null;
  box.className = '';
  const rows = latest.results.map((result, index) => {
    const old = base?.id === latest.id ? null : resultFor(base, result.caseId);
    const state = comparison(result, old);
    return `<article class="list-item"><div class="toolbar"><div><strong>${esc(result.name)}</strong> <span class="badge ${result.passed ? '' : 'bad'}">${result.passed ? 'Passed' : 'Failed'}</span> <span class="badge">${esc(state)}</span></div><span class="muted">${Number.isFinite(result.latencyMs) ? `${esc(result.latencyMs)} ms` : '—'}</span></div><p class="muted">${result.selection ? `Provider: ${esc(result.selection.provider || 'default')} · Model: ${esc(result.selection.model || 'default')}` : ''}${result.error ? ` · Error: ${esc(result.error)}` : ''}</p><details><summary>View full output</summary><pre>${esc(result.text ?? '(no output)')}</pre></details>${old ? `<details><summary>Compare baseline output</summary><pre>${esc(old.text ?? '(no output)')}</pre></details>` : ''}</article>`;
  }).join('');
  box.innerHTML = `<p class="muted">Latest run · ${esc(new Date(latest.createdAt).toLocaleString())}${base && base.id !== latest.id ? ` · compared with ${esc(new Date(base.createdAt).toLocaleString())}` : ' · no earlier baseline selected'}</p>${rows}`;
}
function runControls(isRunning) {
  running = isRunning;
  $('#run-suite').disabled = isRunning;
  $('#stop-run').disabled = !isRunning;
  for (const button of app.querySelectorAll('[data-edit],[data-delete],#add-case')) button.disabled = isRunning;
  for (const control of app.querySelectorAll('#case-form input,#case-form textarea,#case-form select,#case-form button,#provider,#model')) control.disabled = isRunning;
}
async function runSuite() {
  if (running) return;
  if (!cases.length) { setRunStatus('Add at least one test case before running the suite.', true); return; }
  stopRequested = false; runControls(true);
  const run = { id: uid(), createdAt: Date.now(), results: [] };
  const provider = $('#provider').value.trim(), model = $('#model').value.trim();
  try {
    for (let index = 0; index < cases.length; index++) {
      if (stopRequested) break;
      const item = cases[index];
      setRunStatus(`Running ${index + 1} of ${cases.length}: ${item.name}`);
      try {
        const response = await api('evaluate', {
          prompt: item.prompt,
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
          rule: { kind: item.kind, expected: item.expected }
        });
        run.results.push({ caseId: item.id, name: item.name, text: String(response.text ?? ''), passed: !!response.passed, latencyMs: response.latencyMs, selection: response.selection || {} });
      } catch (error) {
        run.results.push({ caseId: item.id, name: item.name, text: '', passed: false, latencyMs: null, selection: {}, error: error.message || 'Evaluation failed.' });
      }
    }
    if (run.results.length) {
      runs = [run, ...runs].slice(0, 10);
      try {
        const saved = await api('save', { value: { cases, runs }, version });
        runs = Array.isArray(saved.value?.runs) ? saved.value.runs : runs;
        cases = Array.isArray(saved.value?.cases) ? saved.value.cases : cases;
        version = saved.version; renderRuns(); renderCases();
        setRunStatus(stopRequested ? `Stopped after ${run.results.length} of ${cases.length} checks. Partial run saved.` : `Finished ${run.results.length} checks. Results saved.`);
      } catch (error) {
        // Keep the run visible and exportable, but never retry over a changed version.
        await reloadState();
        if (!runs.some(entry => entry.id === run.id)) runs = [run, ...runs].slice(0, 10);
        renderRuns();
        setRunStatus(`${error.message || 'Could not save results.'} This run remains visible here but was not saved.`, true);
      }
    } else setRunStatus('Stopped before any checks started.');
  } finally { runControls(false); }
}

$('#case-kind').addEventListener('change', updateRuleHelp);
$('#add-case').addEventListener('click', clearForm);
$('#cancel-edit').addEventListener('click', clearForm);
$('#case-form').addEventListener('submit', async event => {
  event.preventDefault();
  const item = { id: editingId || uid(), name: $('#case-name').value.trim(), prompt: $('#case-prompt').value, kind: $('#case-kind').value, expected: $('#case-expected').value };
  if (!item.name || !item.prompt.trim()) return;
  const next = editingId ? cases.map(entry => entry.id === editingId ? item : entry) : [...cases, item];
  if (await persistCases(next)) clearForm();
});
$('#case-list').addEventListener('click', async event => {
  const edit = event.target.closest('[data-edit]'), remove = event.target.closest('[data-delete]');
  if (edit) {
    const item = cases.find(entry => entry.id === edit.dataset.edit); if (!item) return;
    editingId = item.id; $('#editor-title').textContent = 'Edit test case'; $('#case-form button[type="submit"]').textContent = 'Save changes';
    $('#case-name').value = item.name; $('#case-prompt').value = item.prompt; $('#case-kind').value = item.kind; $('#case-expected').value = item.expected || ''; updateRuleHelp();
  } else if (remove) {
    const item = cases.find(entry => entry.id === remove.dataset.delete); if (!item) return;
    if (window.confirm(`Delete “${item.name}”?`)) await persistCases(cases.filter(entry => entry.id !== item.id));
  }
});
$('#run-suite').addEventListener('click', runSuite);
$('#stop-run').addEventListener('click', () => { stopRequested = true; $('#stop-run').disabled = true; setRunStatus('Stop requested. The current check will finish first.'); });
$('#baseline').addEventListener('change', renderRuns);
$('#export').addEventListener('click', () => download(`prompt-regression-results-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(runs, null, 2), 'application/json'));

updateRuleHelp();
await reloadState();
