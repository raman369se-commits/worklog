const DB='worklog', STORE='entries', META='meta';
let db, page='today', active=null, tick=null;
let settings={currency:'SEK',rate:0,clients:[],projects:[]};
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const fmt=m=>`${Math.floor(m/60)}h ${String(Math.round(m%60)).padStart(2,'0')}m`;
const cash=(n,c)=>`${Number(n||0).toFixed(2)} ${c}`;

function openDB(){return new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB,1);
  r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id'});if(!d.objectStoreNames.contains(META))d.createObjectStore(META,{keyPath:'key'});};
  r.onsuccess=()=>{db=r.result;resolve()};
  r.onerror=()=>reject(r.error);
})}
function store(name,mode='readonly'){return db.transaction(name,mode).objectStore(name)}
function all(){return new Promise(r=>{const q=store(STORE).getAll();q.onsuccess=()=>r(q.result||[])})}
function put(x){return new Promise(r=>{const q=store(STORE,'readwrite').put(x);q.onsuccess=r})}
function remove(id){return new Promise(r=>{const q=store(STORE,'readwrite').delete(id);q.onsuccess=r})}
function meta(k){return new Promise(r=>{const q=store(META).get(k);q.onsuccess=()=>r(q.result?.value)})}
function setmeta(k,v){return new Promise(r=>{const q=store(META,'readwrite').put({key:k,value:v});q.onsuccess=r})}
function mins(e){if(!e.start||!e.end)return 0;let n=(new Date(e.end)-new Date(e.start))/60000;(e.lunch||[]).forEach(p=>{if(p.start&&p.end)n-=(new Date(p.end)-new Date(p.start))/60000});return Math.max(0,n)}
function val(e){return e.payType==='fixed'?+e.amount||0:(+e.rate||0)*mins(e)/60}
function dot(s){return s==='paid'?'status-paid':s==='problem'?'status-problem':'status-waiting'}

async function init(){
  settings=await meta('settings')||settings;
  active=await meta('active')||null;
  if(!active?.id)active=null;
  bindUI();
  render();
  if(active)startTick();
  navigator.serviceWorker?.register('./sw.js').catch(()=>{});
}
function bindUI(){
  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{page=b.dataset.page;render()}));
  $('#addBtn').addEventListener('click',()=>showForm());
  $('#settingsBtn').addEventListener('click',settingsView);
}
function render(){
  const titles={today:'Today',work:'Work',calendar:'Calendar',money:'Money'};
  $('#pageTitle').textContent=titles[page];
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  ({today:renderToday,work:renderWork,calendar:renderCalendar,money:renderMoney}[page])();
}
async function renderToday(){
  const es=await all(), a=es.filter(e=>e.date===today());
  let h='<div class="content">';
  if(active){
    const e=es.find(x=>x.id===active.id);
    if(e) h+=`<div class="hero"><span class="muted">Current work</span><h2>${esc(e.title)}</h2><span class="muted">${esc(e.client||'')} ${e.project?'· '+esc(e.project):''}</span></div>
    <div class="active-card"><span class="eyebrow">ACTIVE</span><div id="timer" class="timer">00:00:00</div>
    <div class="row"><button class="secondary" id="lunch" type="button">${active.lunch?'Resume':'Lunch'}</button><button class="primary" id="finish" type="button">Finish</button></div></div>`;
  } else h+=`<div class="hero"><span class="muted">Ready when you are.</span><h2>Start work.</h2><button class="primary" id="start" type="button">Start work</button></div>`;
  h+='<div class="section-title"><h3>Today</h3></div>';
  h+=a.length?a.sort((x,y)=>(y.start||'').localeCompare(x.start||'')).map(card).join(''):'<div class="empty">No completed work today.</div>';
  h+='</div>';$('#main').innerHTML=h;
  $('#start')?.addEventListener('click',()=>showForm(null,true));
  $('#finish')?.addEventListener('click',finish);
  $('#lunch')?.addEventListener('click',toggleLunch);
  if(active)clock();
}
function card(e){return `<div class="card"><div class="card-head"><div><b>${esc(e.title)}</b><div class="muted">${esc(e.client||'')}${e.project?' · '+esc(e.project):''}</div></div><i class="status-dot ${dot(e.status)}"></i></div><div class="row meta"><span>${fmt(mins(e))}</span><b>${cash(val(e),e.currency||settings.currency)}</b></div>${e.photos?.length?'<div class="thumbs">'+e.photos.map(p=>`<img src="${p}">`).join('')+'</div>':''}<div class="row actions"><button class="secondary edit-btn" data-id="${e.id}" type="button">Edit</button><button class="secondary danger delete-btn" data-id="${e.id}" type="button">Delete</button></div></div>`}
function bindCards(){document.querySelectorAll('.edit-btn').forEach(b=>b.onclick=()=>showFormById(b.dataset.id));document.querySelectorAll('.delete-btn').forEach(b=>b.onclick=()=>deleteEntry(b.dataset.id))}
function startTick(){clearInterval(tick);tick=setInterval(clock,1000)}
function clock(){if(!active)return;let sec=Math.max(0,Math.floor((Date.now()-new Date(active.start))/1000)-(active.lunchElapsed||0));if($('#timer'))$('#timer').textContent=new Date(sec*1000).toISOString().slice(11,19)}
async function startWork(e){e.start=new Date().toISOString();e.date=today();e.status='waiting';await put(e);active={id:e.id,start:e.start,lunch:false,lunchStart:null,lunchElapsed:0};await setmeta('active',active);startTick();render()}
async function toggleLunch(){if(!active)return;if(active.lunch){active.lunchElapsed+=(Date.now()-new Date(active.lunchStart))/1000;active.lunch=false;active.lunchStart=null}else{active.lunch=true;active.lunchStart=new Date().toISOString()}await setmeta('active',active);render()}
async function finish(){const es=await all(),e=es.find(x=>x.id===active?.id);if(!e)return;if(active.lunch){active.lunchElapsed+=(Date.now()-new Date(active.lunchStart))/1000;active.lunch=false}e.end=new Date().toISOString();e.lunch=active.lunchElapsed?[{start:new Date(new Date(e.end).getTime()-active.lunchElapsed*1000).toISOString(),end:e.end}]:[];await put(e);active=null;await setmeta('active',null);clearInterval(tick);render()}
async function showFormById(id){const e=(await all()).find(x=>x.id===id);showForm(e)}
function showForm(e,startMode=false){
  const x=e||{id:crypto.randomUUID(),date:today(),title:'',client:'',project:'',start:'',end:'',payType:'hourly',rate:settings.rate,currency:settings.currency,status:'waiting',photos:[],notes:''};
  $('#modal').classList.remove('hidden');
  $('#modal').innerHTML=`<div class="sheet"><button class="close" id="closeModal" type="button">×</button><h2>${e?'Edit work':'Add work'}</h2>
  <form id="workForm" class="form"><div class="field"><label>Title *</label><input name="title" required value="${esc(x.title)}"></div>
  <div class="grid"><div class="field"><label>Client</label><input name="client" value="${esc(x.client)}"></div><div class="field"><label>Project</label><input name="project" value="${esc(x.project)}"></div></div>
  <div class="grid"><div class="field"><label>Date</label><input type="date" name="date" value="${x.date}"></div><div class="field"><label>Currency</label><select name="currency"><option>SEK</option><option>EUR</option><option>USD</option></select></div></div>
  <div class="grid"><div class="field"><label>Start</label><input type="datetime-local" name="start"></div><div class="field"><label>End</label><input type="datetime-local" name="end"></div></div>
  <div class="grid"><div class="field"><label>Pay type</label><select name="payType"><option value="hourly">Hourly</option><option value="fixed">Fixed</option></select></div><div class="field"><label>Rate / Amount</label><input name="money" type="number" step=".01" value="${x.payType==='fixed'?x.amount||0:x.rate||0}"></div></div>
  <div class="field"><label>Status</label><select name="status"><option value="waiting">Waiting / in progress</option><option value="paid">Paid / completed</option><option value="problem">Problem / unpaid</option></select></div>
  <div class="field"><label>Notes</label><textarea name="notes">${esc(x.notes)}</textarea></div>
  <button class="primary" type="submit">${startMode?'Start work':'Save work'}</button></form></div>`;
  $('#workForm [name=currency]').value=x.currency||settings.currency;
  $('#workForm [name=payType]').value=x.payType||'hourly';
  $('#workForm [name=status]').value=x.status||'waiting';
  if(x.start)$('#workForm [name=start]').value=localInput(x.start);
  if(x.end)$('#workForm [name=end]').value=localInput(x.end);
  $('#closeModal').onclick=closeModal;
  $('#workForm').onsubmit=ev=>saveForm(ev,x,startMode);
}
function localInput(v){const d=new Date(v),z=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`}
async function saveForm(ev,x,startMode){ev.preventDefault();const f=new FormData(ev.target);x.title=f.get('title');x.client=f.get('client');x.project=f.get('project');x.date=f.get('date');x.currency=f.get('currency');x.payType=f.get('payType');x.status=f.get('status');x.notes=f.get('notes');const n=+f.get('money')||0;if(x.payType==='fixed')x.amount=n;else x.rate=n;const st=f.get('start');const en=f.get('end');if(st)x.start=new Date(st).toISOString();if(en)x.end=new Date(en).toISOString();await put(x);closeModal();if(startMode)await startWork(x);else render()}
function closeModal(){$('#modal').classList.add('hidden');$('#modal').innerHTML=''}
async function deleteEntry(id){if(confirm('Delete this work entry?')){await remove(id);render()}}
function settingsView(){
  $('#modal').classList.remove('hidden');
  $('#modal').innerHTML=`<div class="sheet"><button class="close" id="closeSettings" type="button">×</button><h2>Settings</h2>
  <form id="settingsForm" class="form"><div class="grid"><div class="field"><label>Default currency</label><select name="currency"><option>SEK</option><option>EUR</option><option>USD</option></select></div><div class="field"><label>Hourly rate</label><input name="rate" type="number" step=".01" value="${settings.rate||''}"></div></div>
  <div class="field"><label>Clients, one per line</label><textarea name="clients">${esc(settings.clients.join('\n'))}</textarea></div>
  <div class="field"><label>Projects, one per line</label><textarea name="projects">${esc(settings.projects.join('\n'))}</textarea></div>
  <button class="primary" type="submit">Save settings</button></form>
  <div class="section-title"><h3>Backup</h3></div><div class="row"><button class="secondary" id="exportBtn" type="button">Export backup</button><label class="secondary">Import backup<input id="importBtn" type="file" accept="application/json" hidden></label></div>
  <p class="note">Backup includes local work data and settings.</p></div>`;
  $('#settingsForm [name=currency]').value=settings.currency;
  $('#closeSettings').onclick=closeModal;
  $('#settingsForm').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.target);settings.currency=f.get('currency');settings.rate=+f.get('rate')||0;settings.clients=String(f.get('clients')).split('\n').map(x=>x.trim()).filter(Boolean);settings.projects=String(f.get('projects')).split('\n').map(x=>x.trim()).filter(Boolean);await setmeta('settings',settings);closeModal()};
  $('#exportBtn').onclick=exportBackup;
  $('#importBtn').onchange=importBackup;
}
async function exportBackup(){const data={version:1,exportedAt:new Date().toISOString(),settings,entries:await all()};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.download=`worklog-backup-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function importBackup(ev){const f=ev.target.files[0];if(!f)return;const data=JSON.parse(await f.text());if(data.settings){settings=data.settings;await setmeta('settings',settings)}for(const e of (data.entries||[]))await put(e);render();alert('Backup imported.')}
async function renderWork(){const es=await all();$('#main').innerHTML=`<div class="content"><div class="toolbar"><input id="q" placeholder="Search"><select id="mo"><option value="all">All months</option>${[...new Set(es.map(e=>e.date?.slice(0,7)).filter(Boolean))].sort().reverse().map(m=>`<option>${m}</option>`).join('')}</select><select id="st"><option value="all">All status</option><option value="paid">Paid</option><option value="waiting">Waiting</option><option value="problem">Problem</option></select></div><div id="list"></div></div>`;const draw=()=>{const q=$('#q').value.toLowerCase(),m=$('#mo').value,s=$('#st').value,a=es.filter(e=>(!q||[e.title,e.client,e.project].join(' ').toLowerCase().includes(q))&&(m==='all'||e.date?.startsWith(m))&&(s==='all'||e.status===s)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));$('#list').innerHTML=a.length?a.map(card).join(''):'<div class="empty">No matching work.</div>';bindCards()};['q','mo','st'].forEach(id=>$('#'+id).oninput=draw);draw()}
async function renderCalendar(){const es=await all(),d=new Date(),y=d.getFullYear(),m=d.getMonth(),first=new Date(y,m,1),days=new Date(y,m+1,0).getDate(),off=(first.getDay()+6)%7;let h='<div class="content"><div class="section-title"><h3>'+d.toLocaleString(undefined,{month:'long',year:'numeric'})+'</h3></div><div class="calendar">'+['M','T','W','T','F','S','S'].map(x=>`<div class="day-name">${x}</div>`).join('');for(let i=0;i<off;i++)h+='<div></div>';for(let n=1;n<=days;n++){const dt=`${y}-${String(m+1).padStart(2,'0')}-${String(n).padStart(2,'0')}`,a=es.filter(e=>e.date===dt);h+=`<div class="day ${dt===today()?'today':''} ${a.length?'has-work':''}" data-day="${dt}"><b>${n}</b>${a.length?`<small>${fmt(a.reduce((s,e)=>s+mins(e),0))}<br>${a.length} job${a.length>1?'s':''}</small>`:''}</div>`}$('#main').innerHTML=h+'</div></div>';document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>dayView(b.dataset.day))}
async function dayView(dt){const a=(await all()).filter(e=>e.date===dt);$('#modal').classList.remove('hidden');$('#modal').innerHTML=`<div class="sheet"><button class="close" id="closeDay" type="button">×</button><h2>${new Date(dt+'T12:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</h2>${a.length?a.map(card).join(''):'<div class="empty">No work recorded.</div>'}</div>`;$('#closeDay').onclick=closeModal;bindCards()}
async function renderMoney(){const es=await all(),mo=today().slice(0,7),a=es.filter(e=>e.date?.startsWith(mo)),cs=[...new Set(a.map(e=>e.currency||settings.currency))];let h='<div class="content"><div class="section-title"><h3>This month</h3></div>';cs.forEach(c=>{const r=a.filter(e=>e.currency===c&&e.status==='paid').reduce((s,e)=>s+val(e),0),x=a.filter(e=>e.currency===c&&e.status!=='paid').reduce((s,e)=>s+val(e),0);h+=`<div class="grid"><div class="stat"><span class="muted">Received · ${c}</span><b>${cash(r,c)}</b></div><div class="stat"><span class="muted">Expected · ${c}</span><b>${cash(x,c)}</b></div></div>`});h+=`<div class="grid" style="margin-top:10px"><div class="stat"><span class="muted">Hours</span><b>${fmt(a.reduce((s,e)=>s+mins(e),0))}</b></div><div class="stat"><span class="muted">Jobs</span><b>${a.length}</b></div></div><div class="section-title"><h3>Most profitable</h3></div>${[...a].sort((x,y)=>val(y)-val(x)).slice(0,5).map(e=>`<div class="card"><div class="card-head"><b>${esc(e.title)}</b><span>${cash(val(e),e.currency||settings.currency)}</span></div></div>`).join('')||'<div class="empty">No income yet.</div>'}</div>`;$('#main').innerHTML=h}

window.form=()=>showForm();
window.settingsView=settingsView;
openDB().then(init).catch(err=>{console.error(err);document.querySelector('#main').innerHTML='<div class="content"><div class="empty">WORKLOG could not start. Please reload.</div></div>'});
