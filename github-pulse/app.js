import { api, escapeHtml as esc, download, notice, date } from './ui.js';

const root = document.querySelector('main#app');
if (!root) throw new Error('GitHub Pulse needs a main#app element.');

root.innerHTML = `
  <section class="card">
    <div class="toolbar">
      <div><span class="eyebrow">GitHub Pulse</span><h2>Public repository watch</h2>
        <p class="muted">Save periodic snapshots of public repositories. No GitHub token is used or requested.</p></div>
      <div class="row"><span id="poll-state" class="badge">Connecting…</span><button id="refresh" type="button" class="primary">Refresh selected</button></div>
    </div>
    <form id="watch-form" class="grid">
      <label>Public repository <span class="muted">owner/repo</span><input id="repository" name="repository" required maxlength="200" placeholder="octocat/Hello-World" autocomplete="off" spellcheck="false"></label>
      <label>Check interval<select id="interval" name="interval"><option value="15">Every 15 minutes</option><option value="30">Every 30 minutes</option><option value="60" selected>Every 60 minutes</option></select></label>
      <div class="row" style="align-self:end;margin-bottom:14px"><button class="primary" type="submit">Watch repository</button></div>
    </form>
    <div id="loading" class="muted" role="status" aria-live="polite">Loading watched repositories…</div>
    <div id="watch-list" class="grid"></div>
  </section>
  <section id="details" class="card"><div class="empty">Loading the latest saved snapshot…</div></section>`;

const $ = selector => root.querySelector(selector);
const watchList = $('#watch-list');
const details = $('#details');
let state = { jobs: [], history: [], snapshots: [] };
let selectedId = null;
let busy = false;
let pollTimer = null;

function safeGithubUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.port || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch { return null; }
}

function link(value, label, className = '') {
  const href = safeGithubUrl(value);
  return href
    ? `<a${className ? ` class="${esc(className)}"` : ''} href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
    : esc(label);
}

function timeValue(value) {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function ageLabel(value) {
  const when = timeValue(value);
  if (!when) return 'Time unavailable';
  const seconds = Math.max(0, Math.floor((Date.now() - when.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function selectedJob() { return state.jobs.find(job => job.id === selectedId) || null; }
function jobSnapshot(jobId) {
  return state.snapshots.filter(item => item.job_id === jobId)
    .sort((a, b) => (timeValue(b.checkedAt)?.getTime() || 0) - (timeValue(a.checkedAt)?.getTime() || 0))[0] || null;
}
function latestRun(jobId) {
  return state.history.filter(run => run.job_id === jobId)
    .sort((a, b) => (timeValue(b.started)?.getTime() || 0) - (timeValue(a.started)?.getTime() || 0))[0] || null;
}

function renderWatches() {
  $('#loading').hidden = state.jobs.length > 0;
  if (!state.jobs.length) {
    watchList.className = 'empty';
    watchList.innerHTML = 'No repositories are being watched yet. Add a public <code>owner/repo</code> above to save its first snapshot.';
    return;
  }
  watchList.className = 'grid';
  watchList.innerHTML = state.jobs.map(job => {
    const snapshot = jobSnapshot(job.id);
    const repo = snapshot?.repository || {};
    const name = repo.full_name || job.name || 'Unknown repository';
    const run = latestRun(job.id);
    const selected = job.id === selectedId;
    const archived = Boolean(job.archived);
    const status = run?.status || (snapshot ? 'snapshot saved' : 'waiting for first check');
    const metrics = snapshot ? `
      <div class="row" aria-label="Repository statistics">
        <span class="badge">★ ${esc(repo.stargazers_count ?? '—')}</span>
        <span class="badge">⑂ ${esc(repo.forks_count ?? '—')}</span>
        <span class="badge">Issues ${esc(repo.open_issues_count ?? '—')}</span>
      </div>` : '';
    return `<article class="card" style="margin:0;padding:18px;border-color:${selected ? 'var(--accent)' : 'var(--line)'}">
      <div class="toolbar"><button class="list-button${selected ? ' active' : ''}" type="button" data-select="${esc(job.id)}" aria-pressed="${selected}">${esc(name)}</button><span class="badge${['error','failed','timed_out'].includes(run?.status) ? ' bad' : ''}">${esc(archived ? 'Paused' : status)}</span></div>
      ${repo.description ? `<p class="muted">${esc(repo.description)}</p>` : ''}
      ${metrics}
      <p class="muted"><small>Saved snapshot: ${snapshot ? `${esc(date(snapshot.checkedAt))} · ${esc(ageLabel(snapshot.checkedAt))}` : 'No snapshot yet'}</small></p>
      <p class="muted"><small>Next check: ${archived ? 'paused' : esc(date(job.next_at))}</small></p>
      <div class="row">${repo.html_url ? link(repo.html_url, 'Open on GitHub') : ''}<button type="button" data-select="${esc(job.id)}">View</button></div>
    </article>`;
  }).join('');
}

function renderRecords(items, kind) {
  if (!items.length) return `<div class="empty">No ${kind} were found in this saved snapshot.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>${kind === 'pull requests' ? 'Pull request' : 'Issue'}</th><th>State</th><th>Updated</th></tr></thead><tbody>${items.map(item => {
    const title = item.title || `#${item.number}`;
    return `<tr><td><strong>${link(item.html_url, `#${item.number} ${title}`)}</strong><br><small>by ${esc(item.user?.login || 'unknown')}</small></td><td>${esc(item.state || 'unknown')}</td><td>${esc(date(item.updated_at))}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderDetails() {
  const job = selectedJob();
  if (!job) {
    details.innerHTML = `<div class="empty">Choose a watched repository to see its latest saved snapshot.</div>`;
    return;
  }
  const snapshot = jobSnapshot(job.id);
  const repo = snapshot?.repository || {};
  const run = latestRun(job.id);
  const description = repo.description ? `<p class="muted">${esc(repo.description)}</p>` : '';
  if (!snapshot) {
    details.innerHTML = `<div class="toolbar"><div><h2>${esc(job.name || 'Watched repository')}</h2><p class="muted">No snapshot has been saved yet. Refresh to queue the first check.</p></div><button type="button" data-export disabled>Export snapshot JSON</button></div><div class="empty">${job.archived ? 'This watch is paused.' : 'Waiting for the first completed check.'}</div>`;
    return;
  }
  const issues = Array.isArray(snapshot.issues) ? snapshot.issues : [];
  const pulls = issues.filter(item => item.pull_request);
  const plainIssues = issues.filter(item => !item.pull_request);
  const releases = Array.isArray(snapshot.releases) ? snapshot.releases : [];
  const stats = [
    ['Stars', repo.stargazers_count], ['Forks', repo.forks_count], ['Open issues', repo.open_issues_count],
    ['Last pushed', repo.pushed_at ? date(repo.pushed_at) : '—'],
  ];
  details.innerHTML = `
    <div class="toolbar"><div><span class="eyebrow">Saved snapshot · ${esc(ageLabel(snapshot.checkedAt))}</span><h2>${link(repo.html_url, repo.full_name || job.name || 'Repository')}</h2>${description}<p class="muted">Checked ${esc(date(snapshot.checkedAt))}. These are saved results from that check, not live GitHub data.</p></div>
      <div class="row"><button type="button" data-export>Export snapshot JSON</button><button type="button" data-toggle="${esc(job.id)}">${job.archived ? 'Resume watch' : 'Pause watch'}</button></div></div>
    ${run ? `<p><span class="badge${run.status === 'error' ? ' bad' : ''}">Latest check: ${esc(run.status || 'unknown')}</span> <small class="muted">Started ${esc(date(run.started))}${run.ended ? ` · ended ${esc(date(run.ended))}` : ''}</small></p>` : ''}
    <div class="grid">${stats.map(([label, value]) => `<div class="card" style="margin:0;padding:18px"><span class="eyebrow">${esc(label)}</span><div class="stat">${esc(value ?? '—')}</div></div>`).join('')}</div>
    <section style="margin-top:24px"><div class="toolbar"><div><h2>Issues <span class="badge">${plainIssues.length}</span></h2><p class="muted">Open and closed issues from this snapshot.</p></div></div>${renderRecords(plainIssues, 'issues')}</section>
    <section style="margin-top:24px"><div class="toolbar"><div><h2>Pull requests <span class="badge">${pulls.length}</span></h2><p class="muted">Pull requests are split from GitHub's issues response.</p></div></div>${renderRecords(pulls, 'pull requests')}</section>
    <section style="margin-top:24px"><h2>Latest releases</h2>${releases.length ? `<div class="grid">${releases.map(release => `<article class="card" style="margin:0;padding:18px"><h3>${link(release.html_url, release.name || release.tag_name || 'Release')}</h3><p class="muted">${esc(release.tag_name || '')}</p><small class="muted">Published ${esc(date(release.published_at))}</small></article>`).join('')}</div>` : '<div class="empty">No releases were found in this saved snapshot.</div>'}</section>`;
}

function render() { renderWatches(); renderDetails(); }

async function loadRepositories({ quiet = false } = {}) {
  if (busy || document.hidden) return;
  busy = true;
  if (!quiet) {
    $('#poll-state').textContent = 'Fetching saved snapshots…';
    $('#loading').hidden = false;
    if (!state.jobs.length) $('#loading').textContent = 'Fetching watched repositories…';
  }
  try {
    const result = await api('repositories');
    state = {
      jobs: Array.isArray(result.jobs) ? result.jobs : [],
      history: Array.isArray(result.history) ? result.history : [],
      snapshots: Array.isArray(result.snapshots) ? result.snapshots : [],
    };
    if (!state.jobs.some(job => job.id === selectedId)) selectedId = state.jobs[0]?.id || null;
    render();
    $('#poll-state').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    $('#loading').hidden = true;
  } catch (error) {
    $('#loading').hidden = !state.jobs.length;
    if (!state.jobs.length) $('#loading').textContent = 'Watched repositories could not be loaded.';
    $('#poll-state').textContent = 'Update failed';
    notice(error.message || 'Could not load watched repositories.', true);
  } finally { busy = false; }
}

async function runSelected() {
  const job = selectedJob();
  if (!job) { notice('Add or select a watched repository first.', true); return; }
  if (job.archived) { notice('Resume this watch before requesting a check.', true); return; }
  if (busy) return;
  busy = true;
  const button = $('#refresh'); button.disabled = true; button.textContent = 'Queueing check…';
  try {
    await api('run', { job_id: job.id });
    notice('Check queued. The saved snapshot will update when it finishes.');
    $('#poll-state').textContent = 'Check queued';
    // The endpoint may still show the previous snapshot; the regular visible
    // poll will pick up the new result without overlapping this request.
  } catch (error) { notice(error.message || 'Could not queue a repository check.', true); }
  finally { busy = false; button.disabled = false; button.textContent = 'Refresh selected'; }
}

$('#watch-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#repository').value.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input) || input.startsWith('.') || input.includes('/.')) {
    notice('Enter a public repository as owner/repo.', true); return;
  }
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await api('create', { repository: input, interval: Number($('#interval').value) });
    $('#repository').value = '';
    notice(`Watching ${input}. Its first snapshot will appear after a check.`);
    await loadRepositories();
  } catch (error) { notice(error.message || 'Could not watch this repository.', true); }
  finally { submit.disabled = false; }
});

watchList.addEventListener('click', event => {
  const button = event.target.closest('[data-select]');
  if (!button) return;
  selectedId = button.dataset.select;
  render();
});

details.addEventListener('click', async event => {
  const exportButton = event.target.closest('[data-export]');
  if (exportButton && !exportButton.disabled) {
    const snapshot = jobSnapshot(selectedId);
    if (!snapshot) return;
    const name = (snapshot.repository?.full_name || selectedJob()?.name || 'repository').replace(/[^A-Za-z0-9._-]+/g, '-');
    download(`${name}-snapshot.json`, snapshot, 'application/json');
    return;
  }
  const toggle = event.target.closest('[data-toggle]');
  if (!toggle || busy) return;
  const job = state.jobs.find(item => item.id === toggle.dataset.toggle);
  if (!job) return;
  busy = true; toggle.disabled = true;
  try {
    await api(job.archived ? 'unarchive' : 'archive', { job_id: job.id });
    notice(job.archived ? 'Watch resumed.' : 'Watch paused.');
    busy = false;
    await loadRepositories();
  } catch (error) { notice(error.message || 'Could not change the watch state.', true); }
  finally { busy = false; }
});

$('#refresh').addEventListener('click', runSelected);

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (!document.hidden) loadRepositories({ quiet: true }); }, 15000);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadRepositories({ quiet: true });
});
startPolling();
await loadRepositories();
