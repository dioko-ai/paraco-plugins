export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function api(action, body = {}) {
 const r = await fetch(`api/${action}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
 const value = await r.json(); if (!r.ok) throw new Error(value.error || 'Unable to complete the request.'); return value;
}
export function notice(message, error = false) { const el=document.querySelector('#notice'); el.textContent=message; el.className=error?'notice error':'notice'; }
export function download(name, content, type='text/plain') { const url=URL.createObjectURL(new Blob([typeof content==='string'?content:JSON.stringify(content,null,2)],{type})); const a=document.createElement('a'); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
export const date = value => value ? new Date(value).toLocaleString() : '—';
export async function busy(button, action) { button.disabled=true; try {return await action();} catch(e) {notice(e.message,true);} finally {button.disabled=false;} }
