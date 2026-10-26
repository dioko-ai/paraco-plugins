import { api, escapeHtml as esc, notice } from './ui.js';

const root = document.querySelector('main#app');
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const presets = [
  ['Every 15 minutes', '*/15 * * * *'],
  ['Weekdays at 9:00', '0 9 * * 1-5'],
  ['Daily at midnight', '0 0 * * *'],
  ['Monthly on the 1st', '0 0 1 * *']
];
const localDateTime = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
root.innerHTML = `
  <section class="card">
    <div class="toolbar"><h2>Schedule builder</h2><span class="badge">5-field cron</span></div>
    <div class="toolbar" id="presets" aria-label="Schedule presets"></div>
    <div class="grid">
      <label>Schedule expression<input id="expression" class="mono" value="0 9 * * 1-5" spellcheck="false" aria-describedby="syntax-help"></label>
      <label>Schedule time zone<input id="timezone" value="${esc(browserZone)}" placeholder="America/Denver" autocomplete="off"></label>
      <label>Compare with another time zone<input id="compare-zone" value="UTC" placeholder="Europe/London" autocomplete="off"></label>
      <label>Show runs after <small>(your browser's local time)</small><input id="after" type="datetime-local"></label>
    </div>
    <p id="syntax-help" class="muted">Fields are minute, hour, day of month, month, and day of week. Use numbers, lists, ranges, and steps. When both day-of-month and day-of-week are restricted, cron matches either field. Local times skipped by daylight saving time have no run.</p>
    <div class="row"><button id="preview" class="primary">Preview next five runs</button><button id="copy">Copy expression</button></div>
    <div id="status" class="muted" role="status" aria-live="polite"></div>
    <div id="results" class="empty" aria-live="polite">Choose a preset or preview a schedule to see its next five runs.</div>
  </section>
  <section class="card">
    <div class="toolbar"><div><h2>Saved schedules</h2><p class="muted">Keep named expressions and their schedule time zones on this device's workspace.</p></div></div>
    <form id="save-form" class="grid"><label>Bookmark name<input id="bookmark-name" required maxlength="80" placeholder="e.g. Weekday report"></label><div class="row" style="align-self:end;margin-bottom:14px"><button class="primary" type="submit">Save current schedule</button></div></form>
    <div id="bookmarks" class="empty">Loading saved schedules…</div>
  </section>`;

const $ = (selector) => root.querySelector(selector);
const expression = $('#expression'), timezone = $('#timezone'), after = $('#after');
let saved = [], version = null, busy = false, loaded = false;
after.value = localDateTime(new Date());
$('#presets').innerHTML = presets.map(([name, value]) => `<button type="button" data-preset="${esc(value)}">${esc(name)}</button>`).join('');

function setStatus(text, error = false) {
  const status = $('#status'); status.textContent = text; status.className = error ? 'notice error' : 'muted';
}
function validZone(zone) {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return true; } catch { return false; }
}
function formatter(zone) {
  return new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'full', timeStyle: 'long' });
}
function offsetLabel(date, zone) {
  try { return new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset', hour: '2-digit' }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || ''; }
  catch { return ''; }
}
function elapsed(ms) {
  if (ms < 60000) return 'less than a minute';
  const minutes = Math.round(ms / 60000);
  const units = [[525600, 'year'], [43200, 'month'], [10080, 'week'], [1440, 'day'], [60, 'hour'], [1, 'minute']];
  for (const [size, name] of units) if (minutes >= size) {
    const amount = Math.floor(minutes / size);
    return `about ${amount} ${name}${amount === 1 ? '' : 's'}`;
  }
  return '';
}
function renderRuns(times) {
  const zone = timezone.value.trim(), compare = $('#compare-zone').value.trim();
  const box = $('#results');
  if (!Array.isArray(times) || !times.length) { box.className = 'empty'; box.textContent = 'The scheduler returned no upcoming runs.'; return; }
  const rows = times.slice(0, 5).map((stamp, index) => {
    const date = new Date(stamp);
    if (!Number.isFinite(date.getTime())) throw new Error('The scheduler returned an invalid run time.');
    const scheduleText = formatter(zone).format(date);
    const browserText = formatter(browserZone).format(date);
    const compareText = compare && compare !== zone && compare !== browserZone ? formatter(compare).format(date) : '';
    const offset = offsetLabel(date, zone);
    const gap = index ? elapsed(date - new Date(times[index - 1])) : elapsed(date - new Date(after.value));
    return `<tr><td>${index + 1}</td><td><strong>${esc(scheduleText)}</strong><br><small>${esc(zone)} · ${esc(offset)}</small></td><td>${esc(browserText)}<br><small>Browser time · ${esc(browserZone)}</small></td><td>${compareText ? `${esc(compareText)}<br><small>${esc(compare)}</small>` : '—'}</td><td>in ${esc(gap)}</td></tr>`;
  }).join('');
  box.className = 'table-wrap';
  box.innerHTML = `<table><thead><tr><th>#</th><th>Schedule time</th><th>Your browser time</th><th>Comparison</th><th>Gap</th></tr></thead><tbody>${rows}</tbody></table><p class="muted" style="margin:14px 0 0">Daylight saving changes can shift local wall-clock times and offsets between runs. The scheduler supplies these run instants.</p>`;
}
async function preview() {
  const expr = expression.value.trim(), zone = timezone.value.trim();
  if (!expr) { setStatus('Enter a five-field cron expression.', true); return; }
  if (!validZone(zone)) { setStatus('Enter a valid IANA time zone, such as America/Denver.', true); return; }
  const compare = $('#compare-zone').value.trim();
  if (compare && !validZone(compare)) { setStatus('Enter a valid comparison IANA time zone, or leave it blank.', true); return; }
  const since = new Date(after.value);
  if (!after.value || !Number.isFinite(since.getTime())) { setStatus('Choose a valid start time.', true); return; }
  const button = $('#preview'); button.disabled = true; setStatus('Asking the scheduler for upcoming runs…');
  try {
    const result = await api('preview', { expression: expr, timezone: zone, after: since.getTime() });
    renderRuns(result.times);
    setStatus(`Showing the next ${Math.min(result.times?.length || 0, 5)} run${result.times?.length === 1 ? '' : 's'} from the scheduler.`);
  } catch (error) { $('#results').className = 'empty'; $('#results').textContent = 'No preview is available until the scheduler responds.'; setStatus(error.message || 'Could not preview this schedule.', true); }
  finally { button.disabled = false; }
}
function renderBookmarks() {
  const box = $('#bookmarks');
  if (!saved.length) { box.className = 'empty'; box.textContent = 'No saved schedules yet.'; return; }
  box.className = 'table-wrap';
  box.innerHTML = `<table><thead><tr><th>Name</th><th>Expression</th><th>Time zone</th><th>Actions</th></tr></thead><tbody>${saved.map(item => `<tr><td>${esc(item.name)}</td><td><code>${esc(item.expression)}</code></td><td>${esc(item.timezone)}</td><td><button type="button" data-load="${esc(item.id)}">Load</button> <button type="button" class="danger" data-delete="${esc(item.id)}">Delete</button></td></tr>`).join('')}</tbody></table>`;
}
async function loadBookmarks() {
  try { const result = await api('load'); saved = Array.isArray(result.value?.saved) ? result.value.saved : []; version = result.version; loaded = true; renderBookmarks(); }
  catch (error) { $('#bookmarks').className = 'empty'; $('#bookmarks').textContent = 'Saved schedules could not be loaded.'; setStatus(error.message || 'Could not load saved schedules.', true); }
}
async function commitSaved(next) {
  if (busy) return false;
  busy = true;
  try {
    const result = await api('save', { value: { saved: next }, version });
    saved = Array.isArray(result.value?.saved) ? result.value.saved : next;
    version = result.version; renderBookmarks(); notice('Saved schedules updated.'); return true;
  } catch (error) {
    notice(error.message || 'Could not update saved schedules. Reloading the latest version.', true);
    await loadBookmarks(); return false;
  } finally { busy = false; }
}

$('#presets').addEventListener('click', event => {
  const button = event.target.closest('[data-preset]'); if (!button) return;
  expression.value = button.dataset.preset; preview();
});
$('#preview').addEventListener('click', preview);
$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(expression.value); notice('Cron expression copied.'); }
  catch { notice('Clipboard access is unavailable in this browser.', true); }
});
$('#save-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!loaded) { notice('Saved schedules are not ready yet. Try again in a moment.', true); return; }
  const name = $('#bookmark-name').value.trim();
  if (!name || !expression.value.trim() || !validZone(timezone.value.trim())) { notice('Enter a name, expression, and valid IANA time zone.', true); return; }
  const id = globalThis.crypto?.randomUUID?.() || `cron-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (await commitSaved([...saved, { id, name, expression: expression.value.trim(), timezone: timezone.value.trim() }])) $('#bookmark-name').value = '';
});
$('#bookmarks').addEventListener('click', async event => {
  const loadButton = event.target.closest('[data-load]'), deleteButton = event.target.closest('[data-delete]');
  if (loadButton) {
    const item = saved.find(entry => entry.id === loadButton.dataset.load); if (!item) return;
    expression.value = item.expression; timezone.value = item.timezone; await preview();
  } else if (deleteButton) {
    await commitSaved(saved.filter(entry => entry.id !== deleteButton.dataset.delete));
  }
});

await loadBookmarks();
await preview();
