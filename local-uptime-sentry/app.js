import { api, escapeHtml as esc, notice } from './ui.js';

const root = document.querySelector('main#app');
let jobs = [];
let history = [];
let notifications = [];
let selectedJobId = null;
let loading = false;
let busyJobs = new Set();
let createOpen = false;
let createError = '';
let createValues = { name: '', url: '', interval: '5', expectedStatus: '200' };
let feedError = '';
let notificationBusy = new Set();
let logCache = new Map();
let pollTimer = null;
let pollActive = false;
let expandedRunIds = new Set();

const h = (value) => esc(String(value ?? ''));
const jobHistory = (jobId) => history.filter((run) => run.job_id === jobId).sort((a, b) => dateMs(b.started) - dateMs(a.started));
const dateMs = (value) => { const result = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(result) ? result : 0; };
const dateText = (value) => value ? new Date(value).toLocaleString() : '—';
const resultStatus = (run) => String(run?.status || '').toLowerCase().replace(/[- ]/g, '_');
function statusLabel(status) {
  if (!status) return 'Unknown';
  return ({ succeeded: 'Succeeded', success: 'Succeeded', failed: 'Failed', timed_out: 'Timed out', timeout: 'Timed out', pending: 'Pending', running: 'Running', skipped: 'Skipped', cancelled: 'Cancelled', canceled: 'Cancelled' })[status] || status.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
}
function statusTone(status) {
  if (['succeeded', 'success'].includes(status)) return 'success';
  if (['failed', 'timed_out', 'timeout'].includes(status)) return 'error';
  if (['pending', 'running'].includes(status)) return 'pending';
  return 'neutral';
}
function expectedLatency(run) {
  const lines = String(logCache.get(run?.id)?.logs || run?.logs || '').split(/\r?\n/);
  for (const line of lines) {
    const marker = 'PARACO_RESULT:';
    const index = line.indexOf(marker);
    if (index < 0) continue;
    try {
      const payload = JSON.parse(line.slice(index + marker.length));
      if (Number.isFinite(payload.latencyMs) && payload.latencyMs >= 0) return payload.latencyMs;
    } catch { /* Ignore malformed result lines. */ }
  }
  return null;
}
function uptime(jobId) {
  const completed = jobHistory(jobId).filter((run) => ['succeeded', 'success', 'failed', 'timed_out', 'timeout'].includes(resultStatus(run)));
  if (!completed.length) return 'No observed checks';
  const ok = completed.filter((run) => ['succeeded', 'success'].includes(resultStatus(run))).length;
  return `${(ok / completed.length * 100).toFixed(1)}% observed checks (${ok}/${completed.length})`;
}
function summarizeJob(job) {
  const latest = jobHistory(job.id)[0];
  return latest || null;
}
function recentStrip(job) {
  const runs = jobHistory(job.id).slice(0, 8).reverse();
  if (!runs.length) return '<span class="sentry-strip-empty muted">No checks recorded</span>';
  return runs.map((run) => {
    const status = resultStatus(run);
    return `<span class="sentry-check ${statusTone(status)}" title="${h(`${statusLabel(status)} · ${dateText(run.started)}`)}" aria-label="${h(`${statusLabel(status)} at ${dateText(run.started)}`)}"></span>`;
  }).join('');
}
function render() {
  if (!root) return;
  const activeJobs = jobs.filter((job) => !job.archived);
  const selected = jobs.find((job) => job.id === selectedJobId) || null;
  const latestSelected = selected ? jobHistory(selected.id) : [];
  const unread = notifications.filter((item) => !item.read);
  root.innerHTML = `
    <section class="sentry-dashboard">
      <div class="sentry-topbar toolbar"><div><h2>Uptime monitors</h2><p class="muted">Checks run on the configured schedule while the local host runtime is on.</p></div><button class="primary" type="button" data-action="open-create">Start monitoring</button></div>
      <div class="sentry-summary grid" aria-label="Monitor summary"><article class="card"><span class="muted">Monitored services</span><strong>${activeJobs.length}</strong></article><article class="card"><span class="muted">Latest result</span><strong>${latestOverall()}</strong></article><article class="card"><span class="muted">Unread notifications</span><strong>${unread.length}</strong></article></div>
      ${feedError ? `<p class="sentry-error" role="alert">${h(feedError)} <button type="button" data-action="refresh">Retry</button></p>` : ''}
      ${createOpen ? renderCreateForm() : ''}
      <section class="card sentry-services"><div class="toolbar sentry-section-head"><div><h2>Services</h2><p class="muted">Recent check results</p></div><button type="button" data-action="refresh" ${loading ? 'disabled' : ''}>${loading ? 'Refreshing…' : 'Refresh'}</button></div>
        ${jobs.length ? `<div class="sentry-service-grid">${jobs.map((job) => renderJobCard(job)).join('')}</div>` : '<div class="empty">No monitors yet. Start monitoring a URL to see its check history here.</div>'}
      </section>
      <section class="card sentry-history"><div class="toolbar sentry-section-head"><div><h2>Check history</h2><p class="muted">${selected ? `Selected: ${h(selected.name)}` : 'Select a service to view its checks.'}</p></div><label class="sentry-inline-control">Service<select id="history-job" aria-label="Select service for check history"><option value="">Choose a service</option>${jobs.map((job) => `<option value="${h(job.id)}" ${job.id === selectedJobId ? 'selected' : ''}>${h(job.name)}</option>`).join('')}</select></label></div>
        ${selected ? renderHistory(selected, latestSelected) : '<div class="empty">No service selected.</div>'}
      </section>
      <section class="card sentry-notifications"><div class="sentry-section-head"><h2>Notifications</h2><p class="muted">Monitor events and results</p></div>
        ${notifications.length ? `<ul class="sentry-notification-list">${notifications.map((item) => `<li class="sentry-notification ${item.read ? 'read' : 'unread'}"><span class="sentry-notification-dot" aria-hidden="true"></span><span class="sentry-notification-text">${h(item.message)}</span><time>${h(dateText(item.created))}</time>${item.read ? '<span class="muted">Read</span>' : `<button type="button" data-action="read-notification" data-id="${h(item.id)}" ${notificationBusy.has(item.id) ? 'disabled' : ''}>${notificationBusy.has(item.id) ? 'Marking…' : 'Mark read'}</button>`}</li>`).join('')}</ul>` : '<div class="empty">No notifications yet.</div>'}
      </section>
    </section>`;
  bindEvents();
}
function latestOverall() {
  const all = history.slice().sort((a, b) => dateMs(b.started) - dateMs(a.started));
  return all.length ? statusLabel(resultStatus(all[0])) : 'Unknown';
}
function renderJobCard(job) {
  const latest = summarizeJob(job);
  const status = latest ? resultStatus(latest) : 'unknown';
  const latency = latest ? expectedLatency(latest) : null;
  const isBusy = busyJobs.has(job.id);
  return `<article class="sentry-service card ${job.archived ? 'archived' : ''}">
    <div class="toolbar sentry-service-title"><div><h3>${h(job.name)}</h3><span class="muted sentry-url">${h(job.url || '')}</span></div><span class="badge sentry-badge ${job.archived ? 'neutral' : statusTone(status)}">${job.archived ? 'Paused' : statusLabel(status)}</span></div>
    <div class="sentry-service-stats"><div><span class="muted">Observed uptime</span><strong>${h(uptime(job.id))}</strong></div><div><span class="muted">Latest HTTP latency</span><strong>${latency === null ? 'Not reported' : `${latency} ms`}</strong></div><div><span class="muted">Next check</span><strong>${job.archived ? 'Paused' : h(dateText(job.next_at))}</strong></div></div>
    <div class="sentry-recent" aria-label="Recent checks"><span class="muted">Recent checks</span><div class="sentry-strip">${recentStrip(job)}</div></div>
    <div class="toolbar sentry-service-actions"><button type="button" data-action="run" data-id="${h(job.id)}" ${isBusy || job.archived ? 'disabled' : ''}>${isBusy ? 'Running…' : 'Run now'}</button><button type="button" data-action="archive" data-id="${h(job.id)}" ${isBusy ? 'disabled' : ''}>${job.archived ? 'Resume' : 'Pause'}</button><button type="button" data-action="select-job" data-id="${h(job.id)}">View history</button></div>
  </article>`;
}
function renderCreateForm() {
  return `<form id="create-monitor" class="card sentry-create" aria-labelledby="create-heading"><div class="toolbar sentry-create-head"><div><h2 id="create-heading">Start monitoring a URL</h2><p class="muted">The configured schedule runs while the local host runtime is on. The host must permit the URL hostname.</p></div><button type="button" data-action="close-create" aria-label="Close form">Close</button></div>
  ${createError ? `<p class="sentry-error" role="alert">${h(createError)}</p>` : ''}<div class="sentry-create-grid">
    <label class="sentry-field">Monitor name<input name="name" type="text" required maxlength="120" placeholder="Production status page" value="${h(createValues.name)}"></label>
    <label class="sentry-field sentry-span-2">URL<input name="url" type="url" required placeholder="https://example.com/health" value="${h(createValues.url)}"></label>
    <label class="sentry-field">Check interval<select name="interval">${[1, 5, 15, 30, 60].map((minutes) => `<option value="${minutes}" ${String(minutes) === createValues.interval ? 'selected' : ''}>Every ${minutes} minute${minutes === 1 ? '' : 's'}</option>`).join('')}</select></label>
    <label class="sentry-field">Expected HTTP status<input name="expectedStatus" type="number" min="100" max="599" step="1" value="${h(createValues.expectedStatus)}" required></label>
  </div><p class="muted sentry-help">Checks count as successful when the response matches the expected status. A denied hostname appears as a plain error.</p><div class="toolbar sentry-create-actions"><button type="button" data-action="close-create">Cancel</button><button type="submit" class="primary" ${loading ? 'disabled' : ''}>Start monitoring</button></div></form>`;
}
function renderHistory(job, runs) {
  if (!runs.length) return '<div class="empty">No checks recorded for this service.</div>';
  return `<div class="sentry-table-wrap"><table class="sentry-table"><thead><tr><th scope="col">Started</th><th scope="col">Result</th><th scope="col">HTTP latency</th><th scope="col">Details</th></tr></thead><tbody>${runs.map((run) => {
    const status = resultStatus(run);
    const latency = expectedLatency(run);
    const expanded = expandedRunIds.has(run.id);
    const cached = logCache.get(run.id);
    const inlineLogs = cached ? cached.logs : run.logs;
    const diagnostic = cached ? cached.diagnostic : run.diagnostic;
    return `<tr><td>${h(dateText(run.started))}</td><td><span class="badge sentry-badge ${statusTone(status)}">${h(statusLabel(status))}</span></td><td>${latency === null ? 'Not reported' : `${latency} ms`}</td><td><details data-run-id="${h(run.id)}" ${expanded ? 'open' : ''}><summary>${expanded ? 'Hide logs' : 'View logs'}</summary><div class="sentry-log-block">${diagnostic ? `<p><strong>Diagnostic:</strong> ${h(diagnostic)}</p>` : ''}<pre>${h(inlineLogs || 'No log output available.')}</pre>${cached?.truncated ? '<p class="muted">Log output was truncated.</p>' : ''}</div></details></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function bindEvents() {
  document.querySelector('#history-job')?.addEventListener('change', (event) => { selectedJobId = event.target.value || null; expandedRunIds.clear(); render(); });
  root?.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => action(button.dataset.action, button.dataset.id)));
  document.querySelector('#create-monitor')?.addEventListener('submit', createMonitor);
  root?.querySelectorAll('details[data-run-id]').forEach((details) => details.addEventListener('toggle', () => {
    const runId = details.dataset.runId;
    if (details.open) { expandedRunIds.add(runId); if (!logCache.has(runId)) loadLogs(runId); }
    else expandedRunIds.delete(runId);
  }));
}
async function action(name, id) {
  if (name === 'open-create') { createOpen = true; createError = ''; render(); document.querySelector('#create-monitor [name="name"]')?.focus(); }
  else if (name === 'close-create') { createOpen = false; createError = ''; render(); }
  else if (name === 'refresh') await refresh();
  else if (name === 'select-job') { selectedJobId = id; render(); document.querySelector('#history-job')?.focus(); }
  else if (name === 'run') await runJob(id);
  else if (name === 'archive') await toggleArchive(id);
  else if (name === 'read-notification') await markRead(id);
}
async function createMonitor(event) {
  event.preventDefault(); if (loading) return;
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const body = { name: String(data.get('name') || '').trim(), url: String(data.get('url') || '').trim(), interval: Number(data.get('interval')), expectedStatus: Number(data.get('expectedStatus')) };
  createValues = { name: body.name, url: body.url, interval: String(body.interval), expectedStatus: String(body.expectedStatus) };
  createError = ''; loading = true; render();
  try {
    const result = await api('create', body);
    const job = result?.job || result;
    if (job?.id) { jobs = [job, ...jobs.filter((item) => item.id !== job.id)]; selectedJobId = job.id; }
    createOpen = false; createValues = { name: '', url: '', interval: '5', expectedStatus: '200' }; loading = false; await refresh(false); notice('Monitoring started.');
  } catch (error) { loading = false; createOpen = true; createError = error?.message || 'Could not start monitoring.'; render(); }
}
async function runJob(id) {
  if (!id || busyJobs.has(id)) return;
  busyJobs.add(id); render();
  try { await api('run', { job_id: id }); await refresh(false); }
  catch (error) { busyJobs.delete(id); render(); notice(error?.message || 'Could not run this monitor.'); }
  finally { busyJobs.delete(id); render(); }
}
async function toggleArchive(id) {
  const job = jobs.find((item) => item.id === id); if (!job || busyJobs.has(id)) return;
  busyJobs.add(id); render();
  try {
    await api(job.archived ? 'unarchive' : 'archive', { job_id: id });
    await refresh(false);
  } catch (error) { notice(error?.message || `Could not ${job.archived ? 'resume' : 'pause'} this monitor.`); }
  finally { busyJobs.delete(id); render(); }
}
async function markRead(id) {
  if (!id || notificationBusy.has(id)) return;
  notificationBusy.add(id); render();
  try { await api('read_notification', { id }); notifications = notifications.map((item) => item.id === id ? { ...item, read: true } : item); }
  catch (error) { notice(error?.message || 'Could not mark notification as read.'); }
  finally { notificationBusy.delete(id); render(); }
}
async function loadLogs(runId) {
  try {
    const result = await api('logs', { run_id: runId });
    logCache.set(runId, { logs: String(result?.logs || ''), truncated: Boolean(result?.truncated), diagnostic: result?.diagnostic || '' });
    render();
  } catch (error) { logCache.set(runId, { logs: '', diagnostic: error?.message || 'Could not load logs.' }); render(); }
}
async function refresh(showBusy = true) {
  if (pollActive) return;
  pollActive = true; if (showBusy) { loading = true; render(); }
  try {
    const result = await api('monitors');
    jobs = Array.isArray(result?.jobs) ? result.jobs : [];
    history = Array.isArray(result?.history) ? result.history : [];
    notifications = Array.isArray(result?.notifications) ? result.notifications : [];
    feedError = '';
    if (!jobs.some((job) => job.id === selectedJobId)) selectedJobId = jobs[0]?.id || null;
    const validRunIds = new Set(history.map((run) => run.id));
    for (const id of logCache.keys()) if (!validRunIds.has(id)) logCache.delete(id);
  } catch (error) { feedError = error?.message || 'Could not refresh monitor data.'; }
  finally { pollActive = false; loading = false; render(); }
}
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible' && !pollActive) refresh(false); }, 10000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(false); });

const style = document.createElement('style');
style.textContent = `
.sentry-dashboard{display:grid;gap:1rem}.sentry-topbar{justify-content:space-between;align-items:center;gap:1rem}.sentry-topbar h2,.sentry-section-head h2{margin:0}.sentry-topbar p,.sentry-section-head p{margin:.25rem 0 0}.sentry-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem}.sentry-summary .card{display:grid;gap:.35rem;padding:1rem}.sentry-summary strong{font-size:1.4rem}.sentry-services,.sentry-history,.sentry-notifications,.sentry-create{padding:1rem}.sentry-section-head{display:flex;justify-content:space-between;align-items:center;gap:.8rem;margin-bottom:.8rem}.sentry-service-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));gap:.8rem}.sentry-service{padding:1rem;min-width:0}.sentry-service.archived{opacity:.82}.sentry-service-title{justify-content:space-between;align-items:flex-start;gap:.75rem}.sentry-service-title h3{margin:0 0 .25rem;font-size:1.05rem;overflow-wrap:anywhere}.sentry-url{display:block;max-width:100%;overflow-wrap:anywhere;font-size:.85rem}.sentry-badge{white-space:nowrap}.sentry-badge.success{background:#e8f6ed;color:#176735}.sentry-badge.error{background:#fdecec;color:#9a2424}.sentry-badge.pending{background:#fff5d9;color:#765500}.sentry-badge.neutral{opacity:.75}.sentry-service-stats{display:grid;gap:.55rem;margin:1rem 0}.sentry-service-stats>div{display:flex;justify-content:space-between;gap:.75rem;align-items:baseline}.sentry-service-stats strong{text-align:right;font-size:.9rem}.sentry-recent{display:grid;gap:.4rem}.sentry-strip{display:flex;gap:.35rem;align-items:center;min-height:16px}.sentry-check{width:1rem;height:.65rem;border-radius:.2rem;background:#aaa}.sentry-check.success{background:#21834b}.sentry-check.error{background:#c93f3f}.sentry-check.pending{background:#dcaa30}.sentry-strip-empty{font-size:.82rem}.sentry-service-actions{gap:.45rem;flex-wrap:wrap;margin-top:1rem}.sentry-service-actions button,.sentry-section-head>button,.sentry-create-head>button,.sentry-create-actions button,.sentry-notification button{padding:.5rem .7rem;border:1px solid var(--border-color,#d3d7dd);border-radius:.45rem;background:transparent;color:inherit;font:inherit;cursor:pointer}.sentry-create-head{justify-content:space-between;align-items:flex-start;gap:.8rem}.sentry-create-head h2{margin:0}.sentry-create-head p{margin:.25rem 0}.sentry-create-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem;margin-top:.8rem}.sentry-field,.sentry-inline-control{display:flex;flex-direction:column;gap:.35rem;font-size:.9rem;font-weight:600}.sentry-field input,.sentry-field select,.sentry-inline-control select{width:100%;box-sizing:border-box;padding:.65rem .7rem;border:1px solid var(--border-color,#d3d7dd);border-radius:.5rem;background:var(--surface,#fff);color:inherit;font:inherit;font-weight:400}.sentry-span-2{grid-column:1/-1}.sentry-help{font-size:.86rem}.sentry-create-actions{justify-content:flex-end;gap:.5rem}.sentry-error{color:#a52828}.sentry-history .sentry-section-head{align-items:flex-end}.sentry-inline-control{min-width:min(240px,48%)}.sentry-table-wrap{max-width:100%;overflow:auto}.sentry-table{width:100%;border-collapse:collapse;text-align:left}.sentry-table th,.sentry-table td{padding:.65rem .55rem;vertical-align:top;border-bottom:1px solid var(--border-color,#d3d7dd)}.sentry-table th{font-size:.84rem}.sentry-table details summary{cursor:pointer}.sentry-log-block{max-width:650px;padding:.5rem 0}.sentry-log-block pre{max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:.7rem;background:var(--surface-muted,#f4f5f6);border-radius:.4rem;font-size:.82rem}.sentry-notification-list{padding:0;margin:0;list-style:none}.sentry-notification{display:grid;grid-template-columns:auto minmax(120px,1fr) minmax(120px,auto) auto;align-items:center;gap:.65rem;padding:.7rem 0;border-bottom:1px solid var(--border-color,#d3d7dd)}.sentry-notification.read{opacity:.68}.sentry-notification-dot{width:.55rem;height:.55rem;border-radius:50%;background:#4973dc}.sentry-notification.read .sentry-notification-dot{background:#aaa}.sentry-notification time{font-size:.83rem;opacity:.75}.sentry-dashboard button:disabled{opacity:.55;cursor:not-allowed}
@media(max-width:700px){.sentry-summary{grid-template-columns:1fr}.sentry-topbar{align-items:flex-start;flex-direction:column}.sentry-notification{grid-template-columns:auto 1fr auto}.sentry-notification time{grid-column:2}.sentry-notification button,.sentry-notification>.muted{grid-column:3;grid-row:1/3}.sentry-history .sentry-section-head{align-items:flex-start;flex-direction:column}.sentry-inline-control{min-width:100%}}
@media(max-width:480px){.sentry-create-grid{grid-template-columns:1fr}.sentry-span-2{grid-column:auto}.sentry-table th,.sentry-table td{padding:.5rem .35rem;font-size:.84rem}}
`;
document.head.append(style);

(async function init() { if (root) { root.innerHTML = '<section class="card"><p class="muted" role="status">Loading monitor data…</p></section>'; await refresh(false); startPolling(); } })();
