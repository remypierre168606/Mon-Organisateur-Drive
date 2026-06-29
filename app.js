const KEY='mon-organiseur-drive-v1';
const uid=()=>crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
const today=()=>dateKey(new Date());
const starter=()=>({activePlan:0,assignees:['Christophe'],companies:[],appointments:[],plans:[{id:uid(),title:'Plan de travail',buckets:[
 {id:uid(),title:'À faire',tasks:[{id:uid(),title:'Préparer la liste des achats',notes:'Exemple de tâche modifiable.',assignee:'Christophe',company:'',dueDate:'',startDate:'',endDate:'',priority:'normal',progress:'todo',linkName:'',linkUrl:''}]},
 {id:uid(),title:'En cours',tasks:[]},{id:uid(),title:'Terminé',tasks:[]}
]}]});
let db=load(), view=(localStorage.getItem('mon-organiseur-google-client-id')?'board':'settings'), drag=null, dragColumn=null, calendarTaskDrag=null;
let calendarCursor=new Date();
calendarCursor.setDate(1);
let calendarMode='week';
let calendarRdvOnly = localStorage.getItem('mon-organiseur-calendar-rdv-only') === '1';
let listFilterUrgent=false;
let listFilterHigh=false;

// Variables Google Drive déclarées dès le début pour éviter les erreurs au chargement.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const DRIVE_FILENAME = 'mon-organiseur-drive-data.json';
const CLIENT_ID_KEY = 'mon-organiseur-google-client-id';
var tokenClient = null;
var driveReady = false;
var driveFileId = localStorage.getItem('mon-organiseur-drive-file-id') || '';
var autosaveTimer = null;
var lastSavedSnapshot = '';
window.__driveSyncReadyFlag = true;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
function load(){try{return JSON.parse(localStorage.getItem(KEY))||starter()}catch{return starter()}}
function save(){
  localStorage.setItem(KEY,JSON.stringify(db));
  // La partie Google Drive est déclarée plus bas dans ce fichier.
  // Au premier affichage, elle n'est pas encore prête : on évite donc l'erreur JavaScript.
  if(window.__driveSyncReadyFlag){ scheduleDriveAutosave(); }
}
function plan(){return db.plans[db.activePlan]||db.plans[0]}
function ensurePlanData(){
  if(!Array.isArray(db.assignees)) db.assignees=[];
  if(!Array.isArray(db.companies)) db.companies=[];
  if(!Array.isArray(db.appointments)) db.appointments=[];
  db.plans.forEach(p=>{
    // Migration des anciennes versions : les responsables/entreprises étaient stockés dans chaque plan.
    if(Array.isArray(p.assignees)) p.assignees.forEach(n=>{ if(n && !db.assignees.includes(n)) db.assignees.push(n); });
    if(Array.isArray(p.companies)) p.companies.forEach(n=>{ if(n && !db.companies.includes(n)) db.companies.push(n); });
    delete p.assignees;
    delete p.companies;
    (p.buckets||[]).forEach(b=>(b.tasks||[]).forEach(t=>{
      if(t.assignee && !db.assignees.includes(t.assignee)) db.assignees.push(t.assignee);
      if(t.company && !db.companies.includes(t.company)) db.companies.push(t.company);
    }));
  });
}
function sortChoiceLists(){
  ensurePlanData();
  db.assignees=[...new Set(db.assignees.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'fr',{sensitivity:'base'}));
  db.companies=[...new Set(db.companies.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'fr',{sensitivity:'base'}));
}
function assigneeOptions(selected=''){
  ensurePlanData();
  const names=[...db.assignees].sort((a,b)=>String(a).localeCompare(String(b),'fr',{sensitivity:'base'}));
  if(selected && !names.includes(selected)) names.unshift(selected);
  return '<option value="">Aucun responsable</option>'+names.map(n=>`<option value="${esc(n)}" ${n===selected?'selected':''}>${esc(n)}</option>`).join('');
}
function companyOptions(selected=''){
  ensurePlanData();
  const names=[...db.companies].sort((a,b)=>String(a).localeCompare(String(b),'fr',{sensitivity:'base'}));
  if(selected && !names.includes(selected)) names.unshift(selected);
  return '<option value="">Aucune entreprise</option>'+names.map(n=>`<option value="${esc(n)}" ${n===selected?'selected':''}>${esc(n)}</option>`).join('');
}

function removeChoiceFromList(kind){
  ensurePlanData();
  const isAssignee = kind === 'assignee';
  const list = isAssignee ? db.assignees : db.companies;
  const label = isAssignee ? 'responsable' : 'entreprise';
  if(!list.length){
    alert('Aucun '+label+' à supprimer dans la liste de choix.');
    return;
  }
  const msg='Quel '+label+' veux-tu retirer de la liste de choix ?\n\n'+list.map((n,i)=>(i+1)+'. '+n).join('\n')+'\n\nTape le nom exactement comme affiché.';
  const name=prompt(msg,'');
  if(!name) return;
  const clean=name.trim();
  const index=list.findIndex(n=>n.toLowerCase()===clean.toLowerCase());
  if(index<0){
    alert('Nom introuvable dans la liste de choix : '+clean);
    return;
  }
  const realName=list[index];
  const first=confirm('Supprimer "'+realName+'" de la liste des choix ?\n\nLes tâches existantes conserveront ce nom.');
  if(!first) return;
  const second=confirm('Deuxième confirmation :\n\n"'+realName+'" ne sera plus proposé dans le menu déroulant.\nLes anciennes tâches ne seront pas modifiées.\n\nConfirmer ?');
  if(!second) return;
  list.splice(index,1);
  render();
  alert((isAssignee?'Responsable':'Entreprise')+' retiré(e) de la liste de choix : '+realName);
}

function appointments(){ ensurePlanData(); return db.appointments; }
function validAppointments(){
  // V40.5 : seuls les RDV créés/enregistrés avec la nouvelle fenêtre RDV sont actifs.
  // Les anciens RDV de test ou RDV incomplets des versions précédentes sont ignorés,
  // ce qui empêche les ronds violets/clignotants fantômes sur toutes les tâches.
  return appointments().filter(a=>
    a &&
    a.rdvActive === true &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(a.date||'').trim()) &&
    String(a.company||'').trim()
  );
}
function sortedAppointments(){
  return validAppointments().slice().sort((a,b)=>{
    const da=String(a.date||'9999-99-99').localeCompare(String(b.date||'9999-99-99'));
    if(da) return da;
    const ta=String(a.time||'99:99').localeCompare(String(b.time||'99:99'));
    if(ta) return ta;
    return String(a.company||'').localeCompare(String(b.company||''),'fr',{sensitivity:'base'});
  });
}
function appointmentsByDate(){
  const map={};
  validAppointments().forEach(a=>{ (map[a.date] ||= []).push(a); });
  Object.values(map).forEach(arr=>arr.sort((a,b)=>String(a.time||'99:99').localeCompare(String(b.time||'99:99'))));
  return map;
}
function cleanCompanyName(v){ return String(v||'').trim().toLowerCase(); }
function appointmentsForCompany(company){
  const clean=cleanCompanyName(company);
  if(!clean) return [];
  return validAppointments().filter(a=>cleanCompanyName(a.company)===clean).sort((a,b)=>{
    const da=String(a.date||'9999-99-99').localeCompare(String(b.date||'9999-99-99'));
    if(da) return da;
    return String(a.time||'99:99').localeCompare(String(b.time||'99:99'));
  });
}
function appointmentShouldBlink(a){
  if(!a || a.date!==today()) return false;
  const time=String(a.time||'').trim();
  // Si le RDV n'a pas d'heure, il clignote toute la journée.
  if(!time) return true;
  // Si le RDV a une heure, il clignote seulement tant que l'heure n'est pas passée.
  const now=new Date();
  const current=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  return time>=current;
}
function hasAppointmentTodayForCompany(company){ return appointmentsForCompany(company).some(appointmentShouldBlink); }
function appointmentTargetDate(company){
  const list=appointmentsForCompany(company);
  const td=today();
  const todayAppt=list.find(a=>a.date===td);
  if(todayAppt) return td;
  const future=list.find(a=>a.date && a.date>=td);
  return future?.date || list[0]?.date || td;
}
function setCalendarDate(dateStr){
  const [y,m,d]=String(dateStr||today()).split('-').map(Number);
  calendarCursor=new Date(y||new Date().getFullYear(), (m||1)-1, d||1);
}
function openAppointmentDay(company){
  setCalendarDate(appointmentTargetDate(company));
  calendarMode='day';
  view='calendar';
  render();
}
function appointmentDotHtml(t){
  const company=String(t?.company||'').trim();
  if(!company) return '';
  const list=appointmentsForCompany(company);
  if(!list.length) return '';
  const blink=list.some(appointmentShouldBlink);
  return `<button type="button" class="appointmentDot ${blink?'blink':''}" data-company="${esc(company)}" title="Voir les RDV ${esc(company)}" aria-label="Voir les RDV ${esc(company)}">●</button>`;
}
function appointmentCompanyOptions(selected=''){
  ensurePlanData();
  const names=[...db.companies].filter(Boolean).sort((a,b)=>String(a).localeCompare(String(b),'fr',{sensitivity:'base'}));
  if(selected && !names.includes(selected)) names.unshift(selected);
  if(!names.length) return '<option value="">Aucune entreprise disponible</option>';
  return names.map(n=>`<option value="${esc(n)}" ${n===selected?'selected':''}>${esc(n)}</option>`).join('');
}
function appointmentLabel(a){
  const time=a.time?` ${esc(a.time)}`:'';
  const title=a.title?` — ${esc(a.title)}`:'';
  return `🟣${time} ${esc(a.company||'RDV')}${title}`;
}
function openAppointmentDialog(id='', date=''){
  ensurePlanData();
  const existing=id?appointments().find(a=>a.id===id):null;
  $('appointmentDialogTitle').textContent=existing?'Modifier le RDV':'Nouveau RDV';
  $('appointmentId').value=existing?.id||'';
  $('appointmentCompany').innerHTML=appointmentCompanyOptions(existing?.company||'');
  $('appointmentDate').value=existing?.date||date||dateKey(calendarCursor)||today();
  $('appointmentTime').value=existing?.time||'';
  $('appointmentTitle').value=existing?.title||'';
  $('appointmentNotes').value=existing?.notes||'';
  $('deleteAppointmentBtn').style.visibility=existing?'visible':'hidden';
  $('appointmentDialog').showModal();
}
function deleteAppointment(id){
  const appt=appointments().find(a=>a.id===id);
  if(!appt) return;
  if(!confirm('Supprimer ce RDV ?')) return;
  db.appointments=db.appointments.filter(a=>a.id!==id);
  render();
}

function allTasks(){return plan().buckets.flatMap(b=>b.tasks.map(t=>({...t,bucket:b}))) }
function allPlanTasks(){return db.plans.flatMap((p,planIndex)=>(p.buckets||[]).flatMap(b=>(b.tasks||[]).map(t=>({...t,bucket:b,plan:p,planIndex}))))}
function isLate(t){return t.dueDate && t.progress!=='done' && t.dueDate<today()}
function pass(t){const q=$('searchInput').value.toLowerCase();const f=$('filterStatus').value;const text=[t.title,t.notes,t.assignee,t.company,t.dueDate,t.startDate,t.endDate,t.priority,t.progress,t.linkName,t.linkUrl].join(' ').toLowerCase();if(q&&!text.includes(q))return false;if(f==='todo'&&t.progress==='done')return false;if(f==='done'&&t.progress!=='done')return false;if(f==='late'&&!isLate(t))return false;return true}
function render(){ensurePlanData();sortChoiceLists();renderPlans();$('planTitle').value=plan().title;document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));const activeView=$(view+'View')||$('boardView');activeView.classList.remove('hidden');$('addAssigneeBtn').onclick=()=>{const name=prompt('Nom du responsable à ajouter ?','');if(!name)return;const clean=name.trim();if(!clean)return;ensurePlanData();if(!db.assignees.includes(clean)) db.assignees.push(clean);render();alert('Responsable ajouté : '+clean);};$('removeAssigneeBtn').onclick=()=>removeChoiceFromList('assignee');$('addCompanyBtn').onclick=()=>{const name=prompt('Nom de l’entreprise à ajouter ?','');if(!name)return;const clean=name.trim();if(!clean)return;ensurePlanData();if(!db.companies.includes(clean)) db.companies.push(clean);render();alert('Entreprise ajoutée : '+clean);};$('removeCompanyBtn').onclick=()=>removeChoiceFromList('company');document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===view)); if(view==='board')renderBoard(); if(view==='list')renderList(); if(view==='calendar')renderCalendar(); if(view==='assignees')renderGroupedView('assignee'); if(view==='companies')renderGroupedView('company'); if(view==='priorities')renderPriorityView(); save()}
function renderPlans(){
  $('plansList').innerHTML=db.plans.map((p,i)=>`
    <div class="planItem ${i===db.activePlan?'active':''}" data-i="${i}">
      <span class="planName">${esc(p.title)}</span>
      <button class="planDeleteBtn" data-i="${i}" title="Supprimer ce plan">🗑</button>
    </div>`).join('');

  document.querySelectorAll('.planItem').forEach(el=>{
    el.onclick=(e)=>{
      if(e.target.closest('.planDeleteBtn')) return;
      db.activePlan=+el.dataset.i;
      render();
    };
  });

  document.querySelectorAll('.planDeleteBtn').forEach(btn=>{
    btn.onclick=(e)=>{
      e.stopPropagation();
      openDeletePlanDialog(+btn.dataset.i);
    };
  });
}
function renderBoard(){
  const root=$('boardView');
  root.innerHTML='';
  plan().buckets.forEach(b=>{
    const sec=document.createElement('section');
    sec.className='bucket';
    sec.dataset.bucketId=b.id;
    sec.innerHTML=`<div class="bucketHead"><button class="colDragHandle" draggable="true" title="Glisser pour déplacer la colonne">↔</button><input value="${esc(b.title)}"><span class="count">${b.tasks.length}</span><button class="bucketDeleteBtn" title="Supprimer cette colonne">🗑️</button></div><button class="addCard">+ Ajouter une tâche</button><div class="cards"></div>`;
    const handle=sec.querySelector('.colDragHandle');
    handle.ondragstart=e=>{dragColumn=b.id; drag=null; e.dataTransfer.effectAllowed='move';};
    sec.ondragover=e=>{if(dragColumn){e.preventDefault();sec.classList.add('columnDragover')}};
    sec.ondragleave=()=>sec.classList.remove('columnDragover');
    sec.ondrop=e=>{sec.classList.remove('columnDragover'); if(dragColumn){e.preventDefault(); reorderBucket(dragColumn,b.id); dragColumn=null; render();}};
    sec.querySelector('input').onchange=e=>{b.title=e.target.value;render()};
    sec.querySelector('.bucketDeleteBtn').onclick=e=>{e.stopPropagation();deleteBucket(b.id)};
    sec.querySelector('.addCard').onclick=()=>openTask(null,b.id);
    const cards=sec.querySelector('.cards');
    cards.ondragover=e=>{if(!dragColumn){e.preventDefault();cards.classList.add('dragover')}};
    cards.ondragleave=()=>cards.classList.remove('dragover');
    cards.ondrop=e=>{cards.classList.remove('dragover');if(!dragColumn && drag){e.preventDefault();moveTask(drag,b.id);drag=null;render()}};
    b.tasks.filter(pass).forEach(t=>cards.appendChild(card(t,b.id)));
    root.appendChild(sec)
  })
}
function reorderBucket(sourceId,targetId){
  if(!sourceId || !targetId || sourceId===targetId) return;
  const buckets=plan().buckets;
  const from=buckets.findIndex(b=>b.id===sourceId);
  const to=buckets.findIndex(b=>b.id===targetId);
  if(from<0 || to<0) return;
  const [item]=buckets.splice(from,1);
  buckets.splice(to,0,item);
}
function linkUrl(u){
  const url=String(u||'').trim();
  if(/^https?:\/\//i.test(url)) return url;
  return '';
}
function linksHtml(t){
  const url=linkUrl(t.linkUrl||(t.links&&t.links[0]&&t.links[0].url)); const name=t.linkName||(t.links&&t.links[0]&&t.links[0].name); if(!url) return ''; return `<div class="taskLinksPreview"><a class="taskLink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(name||'Ouvrir le lien')}</a></div>`;
}
function card(t,bid){const el=document.createElement('article');el.className='card priority-'+(t.priority||'normal')+' '+(t.progress==='done'?'done':'');el.draggable=true;el.ondragstart=()=>drag=t.id;el.onclick=()=>openTask(t.id,bid);el.innerHTML=`${appointmentDotHtml(t)}<h3>${t.progress==='done'?'✅ ':''}${esc(t.title)}</h3><div class="meta">${t.priority!=='low'?`<span class="pill ${t.priority}">${prio(t.priority)}</span>`:''}${t.dueDate?`<span class="pill ${isLate(t)?'late':''}">📅 ${esc(t.dueDate)}</span>`:''}${t.assignee?`<span class="pill">👤 ${esc(t.assignee)}</span>`:''}${t.company?`<span class="pill">🏢 ${esc(t.company)}</span>`:''}</div>${linksHtml(t)}`;el.querySelectorAll('a.taskLink').forEach(a=>a.onclick=e=>e.stopPropagation());return el}
function listPriorityRank(p){return {urgent:0,high:1,normal:2,low:3}[p||'normal'] ?? 2}
function listDateRank(d){return d ? d : '9999-99-99'}
function renderList(){
  let tasks=allTasks().filter(pass);
  if(listFilterUrgent || listFilterHigh){
    tasks=tasks.filter(t=>(listFilterUrgent && (t.priority||'normal')==='urgent') || (listFilterHigh && (t.priority||'normal')==='high'));
  }
  tasks.sort((a,b)=>{
    const pr=listPriorityRank(a.priority)-listPriorityRank(b.priority);
    if(pr) return pr;
    const da=listDateRank(a.dueDate).localeCompare(listDateRank(b.dueDate));
    if(da) return da;
    const ea=String(a.company||'').localeCompare(String(b.company||''),'fr',{sensitivity:'base'});
    if(ea) return ea;
    return String(a.title||'').localeCompare(String(b.title||''),'fr',{sensitivity:'base'});
  });
  const rows=tasks.map(t=>`<tr class="taskrow priority-${t.priority||'normal'}" data-id="${t.id}"><td class="taskTitleCell">${appointmentDotHtml(t)} ${t.progress==='done'?'✅':'⬜'} ${esc(t.title)}</td><td>${esc(t.bucket.title)}</td><td>${esc(t.assignee||'')}</td><td>${esc(t.company||'')}</td><td>${esc(t.dueDate||'')}</td><td>${prio(t.priority)}</td></tr>`).join('');
  $('listView').innerHTML=`
    <div class="listQuickFilters">
      <label><input id="listUrgentFilter" type="checkbox" ${listFilterUrgent?'checked':''}> 🔴 Urgentes</label>
      <label><input id="listHighFilter" type="checkbox" ${listFilterHigh?'checked':''}> 🟠 Hautes</label>
      <span class="listCount">${tasks.length} tâche(s) affichée(s)</span>
    </div>
    <table class="listTable"><thead><tr><th>Tâche</th><th>Colonne</th><th>Responsable</th><th>Entreprise</th><th>Date</th><th>Priorité</th></tr></thead><tbody>${rows||'<tr><td>Aucune tâche trouvée.</td></tr>'}</tbody></table>`;
  $('listUrgentFilter').onchange=e=>{listFilterUrgent=e.target.checked;render()};
  $('listHighFilter').onchange=e=>{listFilterHigh=e.target.checked;render()};
  document.querySelectorAll('.taskrow').forEach(r=>r.onclick=()=>openTask(r.dataset.id));
}


function validDateStr(v){ return /^\d{4}-\d{2}-\d{2}$/.test(String(v||'').trim()); }
function calendarDatesForTask(t){
  const start=validDateStr(t.startDate)?String(t.startDate):'';
  const end=validDateStr(t.endDate)?String(t.endDate):'';
  const due=validDateStr(t.dueDate)?String(t.dueDate):'';
  const first=start || end || due;
  const last=end || start || due;
  if(!first) return [];
  const [sy,sm,sd]=first.split('-').map(Number);
  const [ey,em,ed]=last.split('-').map(Number);
  let d=new Date(sy,sm-1,sd);
  let stop=new Date(ey,em-1,ed);
  if(stop<d) stop=new Date(d);
  const out=[];
  for(let guard=0; d<=stop && guard<370; guard++){
    out.push(dateKey(d));
    d.setDate(d.getDate()+1);
  }
  return out;
}
function calendarTaskDateLabel(t){
  const start=validDateStr(t.startDate)?t.startDate:'';
  const end=validDateStr(t.endDate)?t.endDate:'';
  if(start && end && start!==end) return ` (${esc(start)} → ${esc(end)})`;
  return '';
}

function parseDateOnly(v){
  if(!validDateStr(v)) return null;
  const [y,m,d]=String(v).split('-').map(Number);
  return new Date(y,m-1,d);
}
function addDaysToDateStr(dateStr, days){
  const d=parseDateOnly(dateStr);
  if(!d) return dateStr;
  d.setDate(d.getDate()+days);
  return dateKey(d);
}
function daysBetweenDateStr(a,b){
  const da=parseDateOnly(a), dbb=parseDateOnly(b);
  if(!da || !dbb) return 0;
  return Math.round((dbb-da)/86400000);
}
function moveTaskToCalendarDate(taskId,targetDate){
  if(!validDateStr(targetDate)) return;
  const found=findTaskGlobal(taskId);
  const t=found.t;
  if(!t) return;
  const oldStart=validDateStr(t.startDate)?t.startDate:(validDateStr(t.endDate)?t.endDate:(validDateStr(t.dueDate)?t.dueDate:targetDate));
  const oldEnd=validDateStr(t.endDate)?t.endDate:(validDateStr(t.dueDate)?t.dueDate:oldStart);
  const duration=Math.max(0, daysBetweenDateStr(oldStart, oldEnd));
  const newStart=targetDate;
  const newEnd=addDaysToDateStr(newStart, duration);
  t.startDate=newStart;
  t.endDate=newEnd;
  t.dueDate=newEnd; // Date de fin = échéance
  render();
}
function attachCalendarTaskDnD(){
  document.querySelectorAll('.calTask').forEach(el=>{
    el.draggable=true;
    el.ondragstart=e=>{calendarTaskDrag=el.dataset.id; drag=null; dragColumn=null; e.dataTransfer.effectAllowed='move';};
    el.onclick=()=>openTask(el.dataset.id);
  });
  document.querySelectorAll('[data-cal-drop-date]').forEach(zone=>{
    zone.ondragover=e=>{if(calendarTaskDrag){e.preventDefault();zone.classList.add('calendarDropOver')}};
    zone.ondragleave=()=>zone.classList.remove('calendarDropOver');
    zone.ondrop=e=>{if(calendarTaskDrag){e.preventDefault();zone.classList.remove('calendarDropOver');const id=calendarTaskDrag;calendarTaskDrag=null;moveTaskToCalendarDate(id,zone.dataset.calDropDate);}};
  });
}

function renderCalendar(){
  const root=$('calendarView');
  if(!calendarMode) calendarMode='month';
  const tasksByDate={};
  allTasks().filter(pass).forEach(t=>{
    calendarDatesForTask(t).forEach(d=>{ (tasksByDate[d] ||= []).push(t); });
  });
  const apptsByDate=appointmentsByDate();
  const apptHtml=(date)=> (apptsByDate[date]||[]).map(a=>`<div class="calAppt ${appointmentShouldBlink(a)?'blink':''}" data-appt="${a.id}" title="${esc(a.company||'RDV')}">${appointmentLabel(a)}</div>`).join('');
  const tasksForCalendar=(date)=> calendarRdvOnly ? [] : (tasksByDate[date]||[]);
  const rdvOnlyHtml=()=>`<label class="calendarRdvOnly"><input id="calendarRdvOnlyCheck" type="checkbox" ${calendarRdvOnly?'checked':''}> RDV uniquement</label>`;
  const switchHtml=(mode)=>`<div class="calendarSwitch"><button id="calMonthBtn" class="${mode==='month'?'activeSwitch':''}">Mois</button><button id="calWeekBtn" class="${mode==='week'?'activeSwitch':''}">Semaine</button><button id="calDayBtn" class="${mode==='day'?'activeSwitch':''}">Jour</button></div>`;

  if(calendarMode==='day'){
    const key=dateKey(calendarCursor);
    const title=calendarCursor.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
    const tasks=tasksForCalendar(key);
    const appts=apptsByDate[key]||[];
    root.innerHTML=`
      <div class="calendarHeader">
        <button id="calPrevBtn">← Jour précédent</button>
        <h2>${esc(title.charAt(0).toUpperCase()+title.slice(1))}</h2>
        <button id="calNextBtn">Jour suivant →</button>
        <button id="calTodayBtn">Aujourd'hui</button>
        <button id="addAppointmentTopBtn" class="appointmentAddBtn">+ RDV</button>
        ${rdvOnlyHtml()}
        ${switchHtml('day')}
      </div>
      <div class="calendarDayView" data-cal-drop-date="${key}">
        <section class="dayPanel">
          <h3>🟣 RDV</h3>
          <div class="appointmentList">${appts.length?appts.map(a=>`<div class="appointmentItem ${appointmentShouldBlink(a)?'blink':''}"><div><strong>${appointmentLabel(a)}</strong>${a.notes?`<div class="small">${esc(a.notes)}</div>`:''}</div><div class="appointmentActions"><button class="editAppointmentBtn" data-appt="${a.id}">Modifier</button><button class="deleteAppointmentBtnSmall" data-appt="${a.id}">Supprimer</button></div></div>`).join(''):'<p class="emptyDay">Aucun RDV ce jour.</p>'}</div>
        </section>
        <section class="dayPanel">
          <h3>📋 Tâches du jour</h3>
          <div class="calTasks dayTasks" data-cal-drop-date="${key}">${tasks.length?tasks.map(t=>`<div class="calTask priority-${t.priority||'normal'} ${isLate(t)?'lateTask':''}" data-id="${t.id}" title="${esc(t.title)}">${t.progress==='done'?'✅ ':''}${esc(t.title)}${calendarTaskDateLabel(t)}</div>`).join(''):'<p class="emptyDay">Aucune tâche ce jour.</p>'}</div>
        </section>
      </div>`;
    $('calPrevBtn').onclick=()=>{calendarCursor.setDate(calendarCursor.getDate()-1);renderCalendar()};
    $('calNextBtn').onclick=()=>{calendarCursor.setDate(calendarCursor.getDate()+1);renderCalendar()};
    $('calTodayBtn').onclick=()=>{calendarCursor=new Date();renderCalendar()};
    $('addAppointmentTopBtn').onclick=()=>openAppointmentDialog('',key);
  }else if(calendarMode==='week'){
    const cursor=new Date(calendarCursor);
    const mondayOffset=(cursor.getDay()+6)%7;
    const weekStart=new Date(cursor);
    weekStart.setDate(cursor.getDate()-mondayOffset);
    const weekEnd=new Date(weekStart);
    weekEnd.setDate(weekStart.getDate()+6);
    const title=`Semaine du ${weekStart.toLocaleDateString('fr-FR')} au ${weekEnd.toLocaleDateString('fr-FR')}`;
    const days=[];
    for(let i=0;i<7;i++){
      const d=new Date(weekStart);
      d.setDate(weekStart.getDate()+i);
      const key=dateKey(d);
      const isToday=key===today();
      const tasks=tasksForCalendar(key);
      const dayName=d.toLocaleDateString('fr-FR',{weekday:'long'});
      days.push(`<div class="calCell weekCell ${isToday?'todayCell':''}" data-cal-drop-date="${key}">
        <div class="calDate weekDate"><div><strong>${esc(dayName.charAt(0).toUpperCase()+dayName.slice(1))}</strong><br><span>${d.toLocaleDateString('fr-FR')}</span></div><div class="calCellBtns"><button class="calAddRdv" data-date="${key}" title="Ajouter un RDV">RDV</button><button class="calAdd" data-date="${key}" title="Ajouter une tâche à cette date">+</button></div></div>
        <div class="calTasks">${apptHtml(key)}${tasks.map(t=>`<div class="calTask priority-${t.priority||'normal'} ${isLate(t)?'lateTask':''}" data-id="${t.id}" title="${esc(t.title)}">${t.progress==='done'?'✅ ':''}${esc(t.title)}${calendarTaskDateLabel(t)}</div>`).join('') || (!apptHtml(key)?'<div class="emptyDay">Aucune tâche</div>':'')}</div>
      </div>`);
    }
    root.innerHTML=`
      <div class="calendarHeader">
        <button id="calPrevBtn">← Semaine précédente</button>
        <h2>${esc(title)}</h2>
        <button id="calNextBtn">Semaine suivante →</button>
        <button id="calTodayBtn">Aujourd'hui</button>
        <button id="addAppointmentTopBtn" class="appointmentAddBtn">+ RDV</button>
        ${rdvOnlyHtml()}
        ${switchHtml('week')}
      </div>
      <div class="calendarWeek">${days.join('')}</div>`;
    $('calPrevBtn').onclick=()=>{calendarCursor.setDate(calendarCursor.getDate()-7);renderCalendar()};
    $('calNextBtn').onclick=()=>{calendarCursor.setDate(calendarCursor.getDate()+7);renderCalendar()};
    $('calTodayBtn').onclick=()=>{calendarCursor=new Date();renderCalendar()};
    $('addAppointmentTopBtn').onclick=()=>openAppointmentDialog('',dateKey(calendarCursor));
  }else{
    const y=calendarCursor.getFullYear();
    const m=calendarCursor.getMonth();
    const monthName=calendarCursor.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
    const first=new Date(y,m,1);
    const mondayOffset=(first.getDay()+6)%7;
    const gridStart=new Date(y,m,1-mondayOffset);
    const days=[];
    for(let i=0;i<42;i++){
      const d=new Date(gridStart);
      d.setDate(gridStart.getDate()+i);
      const key=dateKey(d);
      const inMonth=d.getMonth()===m;
      const isToday=key===today();
      const tasks=tasksForCalendar(key);
      days.push(`<div class="calCell ${inMonth?'':'otherMonth'} ${isToday?'todayCell':''}" data-cal-drop-date="${key}">
        <div class="calDate"><strong>${d.getDate()}</strong><div class="calCellBtns"><button class="calAddRdv" data-date="${key}" title="Ajouter un RDV">RDV</button><button class="calAdd" data-date="${key}" title="Ajouter une tâche à cette date">+</button></div></div>
        <div class="calTasks">${apptHtml(key)}${tasks.map(t=>`<div class="calTask priority-${t.priority||'normal'} ${isLate(t)?'lateTask':''}" data-id="${t.id}" title="${esc(t.title)}">${t.progress==='done'?'✅ ':''}${esc(t.title)}${calendarTaskDateLabel(t)}</div>`).join('')}</div>
      </div>`);
    }
    root.innerHTML=`
      <div class="calendarHeader">
        <button id="calPrevBtn">← Mois précédent</button>
        <h2>${esc(monthName.charAt(0).toUpperCase()+monthName.slice(1))}</h2>
        <button id="calNextBtn">Mois suivant →</button>
        <button id="calTodayBtn">Aujourd'hui</button>
        <button id="addAppointmentTopBtn" class="appointmentAddBtn">+ RDV</button>
        ${rdvOnlyHtml()}
        ${switchHtml('month')}
      </div>
      <div class="calendarMonth">
        <div class="calWeekday">Lun</div><div class="calWeekday">Mar</div><div class="calWeekday">Mer</div><div class="calWeekday">Jeu</div><div class="calWeekday">Ven</div><div class="calWeekday">Sam</div><div class="calWeekday">Dim</div>
        ${days.join('')}
      </div>`;
    $('calPrevBtn').onclick=()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar()};
    $('calNextBtn').onclick=()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar()};
    $('calTodayBtn').onclick=()=>{calendarCursor=new Date();calendarCursor.setDate(1);renderCalendar()};
    $('addAppointmentTopBtn').onclick=()=>openAppointmentDialog('',dateKey(calendarCursor));
  }
  const rdvOnlyCheck=$('calendarRdvOnlyCheck');
  if(rdvOnlyCheck) rdvOnlyCheck.onchange=e=>{calendarRdvOnly=!!e.target.checked;localStorage.setItem('mon-organiseur-calendar-rdv-only',calendarRdvOnly?'1':'0');renderCalendar()};
  $('calMonthBtn').onclick=()=>{calendarMode='month';calendarCursor.setDate(1);renderCalendar()};
  $('calWeekBtn').onclick=()=>{calendarMode='week';renderCalendar()};
  $('calDayBtn').onclick=()=>{calendarMode='day';renderCalendar()};
  attachCalendarTaskDnD();
  document.querySelectorAll('.calAppt').forEach(el=>el.onclick=()=>openAppointmentDialog(el.dataset.appt));
  document.querySelectorAll('.editAppointmentBtn').forEach(btn=>btn.onclick=()=>openAppointmentDialog(btn.dataset.appt));
  document.querySelectorAll('.deleteAppointmentBtnSmall').forEach(btn=>btn.onclick=()=>deleteAppointment(btn.dataset.appt));
  document.querySelectorAll('.calAdd').forEach(btn=>btn.onclick=(e)=>{e.stopPropagation();openTaskOnDate(btn.dataset.date)});
  document.querySelectorAll('.calAddRdv').forEach(btn=>btn.onclick=(e)=>{e.stopPropagation();openAppointmentDialog('',btn.dataset.date)});
}
function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function openTaskOnDate(date){openTask(null,plan().buckets[0].id);if($('taskStartDate'))$('taskStartDate').value=date;if($('taskEndDate'))$('taskEndDate').value=date;if($('taskDueDate'))$('taskDueDate').value=date}

function groupKeyValue(t, field){
  const empty=field==='assignee'?'Aucun responsable':'Aucune entreprise';
  return (t[field]||'').trim() || empty;
}
function taskRowForGroup(t, field){
  return `<div class="groupTask priority-${t.priority||'normal'}" data-plan="${t.planIndex}" data-id="${t.id}">
    <div>
      <strong>${appointmentDotHtml(t)} ${t.progress==='done'?'✅ ':''}${esc(t.title)}</strong>
      <div class="small">Plan : ${esc(t.plan?.title||'')} · Colonne : ${esc(t.bucket?.title||'')}</div>
    </div>
    <div class="groupMeta">
      ${t.dueDate?`<span class="pill ${isLate(t)?'late':''}">📅 ${esc(t.dueDate)}</span>`:''}
      <span class="pill">${esc(prio(t.priority))}</span>
      ${field==='assignee'&&t.company?`<span class="pill">🏢 ${esc(t.company)}</span>`:''}
      ${field==='company'&&t.assignee?`<span class="pill">👤 ${esc(t.assignee)}</span>`:''}
    </div>
  </div>`;
}
function attachGroupTaskClicks(root){
  root.querySelectorAll('.groupTask').forEach(el=>{
    el.draggable=true;
    el.ondragstart=(e)=>{ drag=e.currentTarget.dataset.id; e.dataTransfer.effectAllowed='move'; };
    el.onclick=()=>{ db.activePlan=Number(el.dataset.plan); render(); openTask(el.dataset.id); };
  });
}
function attachGroupDrop(root, field){
  root.querySelectorAll('.groupBox[data-value]').forEach(box=>{
    box.ondragover=e=>{e.preventDefault();box.classList.add('columnDragover')};
    box.ondragleave=()=>box.classList.remove('columnDragover');
    box.ondrop=e=>{
      e.preventDefault();box.classList.remove('columnDragover');
      const id=drag; drag=null;
      const found=findTaskGlobal(id); if(!found.t) return;
      const value=decodeURIComponent(box.dataset.value||'');
      if(field==='assignee') found.t.assignee=(value==='Aucun responsable')?'':value;
      if(field==='company') found.t.company=(value==='Aucune entreprise')?'':value;
      if(field==='priority') found.t.priority=value;
      render();
    };
  });
}

function renderGroupedView(field){
  const root=$(field==='assignee'?'assigneesView':'companiesView');
  const title=field==='assignee'?'Classement par responsable':'Classement par entreprise';
  const empty=field==='assignee'?'Aucun responsable':'Aucune entreprise';
  const icon=field==='assignee'?'👤':'🏢';
  const tasks=allPlanTasks().filter(pass).sort((a,b)=>{
    const ga=groupKeyValue(a,field).localeCompare(groupKeyValue(b,field),'fr');
    if(ga) return ga;
    const pa=(a.plan?.title||'').localeCompare(b.plan?.title||'','fr');
    if(pa) return pa;
    return (a.dueDate||'9999-99-99').localeCompare(b.dueDate||'9999-99-99');
  });
  const groups={};
  tasks.forEach(t=>{const k=groupKeyValue(t,field); (groups[k] ||= []).push(t);});
  const entries=Object.entries(groups);
  root.innerHTML=`<div class="groupHeader"><h2>${icon} ${esc(title)}</h2><p>Vue globale : toutes les tâches de tous les plans. Clique sur <strong>Ouvrir</strong> pour afficher une page dédiée.</p></div>`+
    (entries.length?`<div class="groupGrid">${entries.map(([name,items])=>`<section class="groupBox" data-value="${encodeURIComponent(name)}">
      <h3><span>${esc(name)} <span class="count">${items.length}</span></span><button class="openGroupBtn" data-field="${field}" data-name="${encodeURIComponent(name)}">Ouvrir</button></h3>
      <div class="groupTasks">${items.slice(0,6).map(t=>taskRowForGroup(t,field)).join('')}${items.length>6?`<div class="small">+ ${items.length-6} tâche(s) dans la page dédiée</div>`:''}</div>
    </section>`).join('')}</div>`:`<p>Aucune tâche trouvée pour ${esc(empty.toLowerCase())}.</p>`);
  root.querySelectorAll('.openGroupBtn').forEach(btn=>btn.onclick=(e)=>{
    e.stopPropagation();
    renderGroupDetail(field,decodeURIComponent(btn.dataset.name));
  });
  attachGroupTaskClicks(root);
  attachGroupDrop(root, field);
}
function renderGroupDetail(field, name){
  const root=$(field==='assignee'?'assigneesView':'companiesView');
  const icon=field==='assignee'?'👤':'🏢';
  const label=field==='assignee'?'Responsable':'Entreprise';
  const tasks=allPlanTasks().filter(t=>groupKeyValue(t,field)===name).filter(pass).sort((a,b)=>{
    const pa=(a.plan?.title||'').localeCompare(b.plan?.title||'','fr');
    if(pa) return pa;
    const da=(a.dueDate||'9999-99-99').localeCompare(b.dueDate||'9999-99-99');
    if(da) return da;
    return (a.title||'').localeCompare(b.title||'','fr');
  });
  root.innerHTML=`<div class="groupHeader detailHeader">
    <button id="backGroupBtn" class="backBtn">← Retour</button>
    <div><h2>${icon} ${esc(label)} : ${esc(name)}</h2><p>${tasks.length} tâche(s) trouvée(s) dans tous les plans.</p></div>
  </div>
  <div class="detailTaskList">${tasks.length?tasks.map(t=>taskRowForGroup(t,field)).join(''):`<p>Aucune tâche pour ${esc(name)}.</p>`}</div>`;
  $('backGroupBtn').onclick=()=>renderGroupedView(field);
  attachGroupTaskClicks(root);
}


function priorityGroupLabel(p){return {urgent:'🔴 Urgente',high:'🟡 Haute',normal:'🟢 Normale',low:'🔵 Basse'}[p]||'🟢 Normale'}
function renderPriorityView(){
  const root=$('prioritiesView');
  const order=['urgent','high','normal','low'];
  const tasks=allPlanTasks().filter(pass).sort((a,b)=>{
    const ia=order.indexOf(a.priority||'normal');
    const ib=order.indexOf(b.priority||'normal');
    if(ia!==ib) return (ia<0?99:ia)-(ib<0?99:ib);
    const da=(a.dueDate||'9999-99-99').localeCompare(b.dueDate||'9999-99-99');
    if(da) return da;
    return (a.title||'').localeCompare(b.title||'','fr');
  });
  const groups={urgent:[],high:[],normal:[],low:[]};
  tasks.forEach(t=>{const k=groups[t.priority]?t.priority:'normal'; groups[k].push(t);});
  root.innerHTML=`<div class="groupHeader"><h2>📌 Classement par priorité</h2><p>Vue globale : toutes les tâches de tous les plans, classées par priorité. Tu peux faire glisser une tâche vers une autre priorité.</p></div>
    <div class="groupGrid priorityGrid">${order.map(k=>`<section class="groupBox priorityBox priority-${k}" data-value="${k}">
      <h3><span>${priorityGroupLabel(k)} <span class="count">${groups[k].length}</span></span><button class="openPriorityBtn openGroupBtn" data-priority="${k}">Ouvrir</button></h3>
      <div class="groupTasks">${groups[k].length?groups[k].map(t=>taskRowForPriority(t)).join(''):'<p class="small">Aucune tâche.</p>'}</div>
    </section>`).join('')}</div>`;
  root.querySelectorAll('.openPriorityBtn').forEach(btn=>btn.onclick=(e)=>{e.stopPropagation();renderPriorityDetail(btn.dataset.priority);});
  attachGroupTaskClicks(root);
  attachGroupDrop(root, 'priority');
}
function renderPriorityDetail(priority){
  const root=$('prioritiesView');
  const tasks=allPlanTasks().filter(t=>(t.priority||'normal')===priority).filter(pass).sort((a,b)=>{
    const pa=(a.plan?.title||'').localeCompare(b.plan?.title||'','fr');
    if(pa) return pa;
    const da=(a.dueDate||'9999-99-99').localeCompare(b.dueDate||'9999-99-99');
    if(da) return da;
    return (a.title||'').localeCompare(b.title||'','fr');
  });
  root.innerHTML=`<div class="groupHeader detailHeader">
    <button id="backPriorityBtn" class="backBtn">← Retour</button>
    <div><h2>📌 Priorité : ${priorityGroupLabel(priority)}</h2><p>${tasks.length} tâche(s) trouvée(s) dans tous les plans.</p></div>
  </div>
  <div class="detailTaskList">${tasks.length?tasks.map(t=>taskRowForPriority(t)).join(''):`<p>Aucune tâche.</p>`}</div>`;
  $('backPriorityBtn').onclick=()=>renderPriorityView();
  attachGroupTaskClicks(root);
}
function taskRowForPriority(t){
  return `<div class="groupTask priority-${t.priority||'normal'}" data-plan="${t.planIndex}" data-id="${t.id}">
    <div>
      <strong>${appointmentDotHtml(t)} ${t.progress==='done'?'✅ ':''}${esc(t.title)}</strong>
      <div class="small">Plan : ${esc(t.plan?.title||'')} · Colonne : ${esc(t.bucket?.title||'')}</div>
    </div>
    <div class="groupMeta">
      ${t.dueDate?`<span class="pill ${isLate(t)?'late':''}">📅 ${esc(t.dueDate)}</span>`:''}
      ${t.assignee?`<span class="pill">👤 ${esc(t.assignee)}</span>`:''}
      ${t.company?`<span class="pill">🏢 ${esc(t.company)}</span>`:''}
    </div>
  </div>`;
}

function renderStats(){const tasks=allTasks();const done=tasks.filter(t=>t.progress==='done').length;const late=tasks.filter(isLate).length;$('statsView').innerHTML=`<div class="statsGrid"><div class="stat"><strong>${tasks.length}</strong><br>Tâches</div><div class="stat"><strong>${done}</strong><br>Terminées</div><div class="stat"><strong>${tasks.length-done}</strong><br>Restantes</div><div class="stat"><strong>${late}</strong><br>En retard</div></div>`}
function prio(p){return {low:'Basse',normal:'Normale',high:'Haute',urgent:'Urgente'}[p]||p}
function findTask(id){for(const b of plan().buckets){const t=b.tasks.find(x=>x.id===id);if(t)return {t,b}}return {}}
function moveTask(id,bid){const {t}=findTask(id);if(!t)return;plan().buckets.forEach(b=>b.tasks=b.tasks.filter(x=>x.id!==id));plan().buckets.find(b=>b.id===bid).tasks.push(t)}
function deleteBucket(bid){
  const p=plan();
  const b=p.buckets.find(x=>x.id===bid);
  if(!b) return;
  if(p.buckets.length<=1){ alert('Impossible de supprimer la dernière colonne.'); return; }
  const count=(b.tasks||[]).length;
  if(!confirm(`Supprimer la colonne "${b.title}" ?${count?`

Attention : ${count} tâche(s) seront aussi supprimée(s).`:''}`)) return;
  if(!confirm('Deuxième confirmation : veux-tu vraiment supprimer cette colonne définitivement ?')) return;
  p.buckets=p.buckets.filter(x=>x.id!==bid);
  render();
}
function openDeletePlanDialog(index){
  const p=db.plans[index];
  if(!p) return;
  if(db.plans.length<=1){
    alert('Impossible de supprimer le dernier plan. Crée d’abord un autre plan.');
    return;
  }
  $('deletePlanIndex').value=String(index);
  $('deletePlanName').textContent=p.title;
  $('confirmDeletePlanCheck').checked=false;
  $('confirmDeletePlanBtn').disabled=true;
  $('deletePlanDialog').showModal();
}

function findTaskGlobal(id){
  for(let pi=0; pi<db.plans.length; pi++){
    const p=db.plans[pi];
    for(const b of (p.buckets||[])){
      const t=(b.tasks||[]).find(x=>x.id===id);
      if(t) return {t,b,plan:p,planIndex:pi};
    }
  }
  return {};
}
function openTask(id,bid){
  const found=id?findTaskGlobal(id):{};
  const t=found.t, b=found.b;
  $('dialogTitle').textContent=id?'Modifier la tâche':'Nouvelle tâche';
  $('taskId').value=id||'';
  $('taskTitle').value=t?.title||'';
  $('taskNotes').value=t?.notes||'';
  $('taskAssignee').innerHTML=assigneeOptions(t?.assignee||'');
  $('taskCompany').innerHTML=companyOptions(t?.company||'');
  const taskEndValue=t?.endDate||t?.dueDate||'';
  if($('taskDueDate')) $('taskDueDate').value=taskEndValue;
  if($('taskStartDate')) $('taskStartDate').value=t?.startDate||'';
  if($('taskEndDate')) $('taskEndDate').value=taskEndValue;
  $('taskPriority').value=t?.priority||'normal';
  $('taskProgress').value=t?.progress||'todo';
  $('taskLinkName').value=(t?.linkName||t?.links?.[0]?.name||'');
  $('taskLinkUrl').value=(t?.linkUrl||t?.links?.[0]?.url||'');
  const planSelect=$('taskPlan');
  if(planSelect){
    planSelect.innerHTML=db.plans.map((p,i)=>`<option value="${i}">${esc(p.title||('Plan '+(i+1)))}</option>`).join('');
    planSelect.value=String(found.planIndex ?? db.activePlan);
    planSelect.onchange=()=>updateTaskBucketOptions(Number(planSelect.value), b?.id || bid);
    updateTaskBucketOptions(Number(planSelect.value), b?.id || bid);
  }else{
    $('taskBucket').innerHTML=plan().buckets.map(bb=>`<option value="${bb.id}">${esc(bb.title)}</option>`).join('');
  }
  $('deleteTaskBtn').style.visibility=id?'visible':'hidden';
  if($('taskEndDate') && $('taskDueDate')){ $('taskEndDate').onchange=()=>{ $('taskDueDate').value=$('taskEndDate').value||''; }; }
  $('taskDialog').showModal();
}
function updateTaskBucketOptions(planIndex, selectedBucketId=''){
  const p=db.plans[planIndex]||plan();
  $('taskBucket').innerHTML=(p.buckets||[]).map(bb=>`<option value="${bb.id}">${esc(bb.title)}</option>`).join('');
  const exists=(p.buckets||[]).some(bb=>bb.id===selectedBucketId);
  $('taskBucket').value=exists?selectedBucketId:(p.buckets?.[0]?.id||'');
}
function checklistFrom(txt){return txt.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>({done:/^\[x\]/i.test(s),text:s.replace(/^\[x\]\s*/i,'')}))}

$('appointmentForm').onsubmit=e=>{
  e.preventDefault();
  ensurePlanData();
  const id=$('appointmentId').value||uid();
  const a={id,company:$('appointmentCompany').value.trim(),date:$('appointmentDate').value,time:$('appointmentTime').value,title:$('appointmentTitle').value.trim(),notes:$('appointmentNotes').value.trim(),color:'violet',rdvActive:true,updatedAt:new Date().toISOString()};
  if(!a.company){ alert('Choisis une entreprise pour le RDV.'); return; }
  if(!a.date){ alert('Choisis une date pour le RDV.'); return; }
  db.appointments=db.appointments.filter(x=>x.id!==id);
  db.appointments.push(a);
  $('appointmentDialog').close();
  calendarMode='day';
  setCalendarDate(a.date);
  view='calendar';
  render();
};
$('cancelAppointmentDialog').onclick=()=>$('appointmentDialog').close();
$('deleteAppointmentBtn').onclick=()=>{const id=$('appointmentId').value;if(id){deleteAppointment(id);$('appointmentDialog').close();}};
document.addEventListener('click', (e)=>{
  const dot=e.target.closest('.appointmentDot');
  if(dot){ e.preventDefault(); e.stopPropagation(); openAppointmentDay(dot.dataset.company||''); }
});

$('taskForm').onsubmit=e=>{
  e.preventDefault();
  const id=$('taskId').value||uid();
  const found=findTaskGlobal(id);
  const old=found.t;
  const targetPlanIndex=$('taskPlan')?Number($('taskPlan').value):db.activePlan;
  const targetPlan=db.plans[targetPlanIndex]||plan();
  const startDate=$('taskStartDate')?$('taskStartDate').value:'';
  const endDate=$('taskEndDate')?$('taskEndDate').value:'';
  // V40.12 : la date de fin remplace l'échéance.
  const dueDate=endDate;
  const t={id,title:$('taskTitle').value.trim(),notes:$('taskNotes').value.trim(),assignee:$('taskAssignee').value.trim(),company:$('taskCompany').value.trim(),dueDate,startDate,endDate,priority:$('taskPriority').value,progress:$('taskProgress').value,linkName:$('taskLinkName').value.trim(),linkUrl:$('taskLinkUrl').value.trim()};
  db.plans.forEach(p=>(p.buckets||[]).forEach(b=>b.tasks=b.tasks.filter(x=>x.id!==id)));
  const targetBucket=(targetPlan.buckets||[]).find(b=>b.id===$('taskBucket').value)||targetPlan.buckets[0];
  if(old){targetBucket.tasks.push(t)}else{targetBucket.tasks.unshift(t)}
  db.activePlan=targetPlanIndex;
  $('taskDialog').close();
  render();
};
$('deleteTaskBtn').onclick=()=>{const id=$('taskId').value;if(confirm('Supprimer cette tâche ?')){plan().buckets.forEach(b=>b.tasks=b.tasks.filter(t=>t.id!==id));$('taskDialog').close();render()}};
$('cancelDialog').onclick=()=>$('taskDialog').close();
$('cancelDeletePlanBtn').onclick=()=>$('deletePlanDialog').close();
$('confirmDeletePlanCheck').onchange=e=>{$('confirmDeletePlanBtn').disabled=!e.target.checked};
$('confirmDeletePlanBtn').onclick=()=>{
  const index=Number($('deletePlanIndex').value);
  if(!$('confirmDeletePlanCheck').checked) return;
  if(!db.plans[index]) return;
  db.plans.splice(index,1);
  if(db.activePlan>=db.plans.length) db.activePlan=db.plans.length-1;
  if(db.activePlan<0) db.activePlan=0;
  $('deletePlanDialog').close();
  render();
};
$('planTitle').onchange=e=>{plan().title=e.target.value;render()};$('addBucketBtn').onclick=()=>{const title=prompt('Nom de la colonne ?','Nouvelle colonne');if(title){plan().buckets.push({id:uid(),title,tasks:[]});render()}};$('addTaskTopBtn').onclick=()=>openTask(null,plan().buckets[0].id);$('newPlanBtn').onclick=()=>{const title=prompt('Nom du nouveau plan ?','Nouveau plan');if(title){db.plans.push({id:uid(),title,buckets:[{id:uid(),title:'À faire',tasks:[]},{id:uid(),title:'En cours',tasks:[]},{id:uid(),title:'Terminé',tasks:[]}]});db.activePlan=db.plans.length-1;render()}};document.querySelectorAll('.nav').forEach(n=>n.onclick=()=>{view=n.dataset.view;render()});$('searchInput').oninput=render;$('filterStatus').onchange=render;$('exportBtn').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:'application/json'}));a.download='mon-organiseur-sauvegarde.json';a.click()};$('importInput').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{db=JSON.parse(r.result);render()}catch{alert('Fichier non valide')}};r.readAsText(f)};$('resetBtn').onclick=()=>{if(confirm('Tout effacer et remettre le modèle de départ ?')){db=starter();render()}};


// ---------------- GOOGLE DRIVE SYNC ----------------

const VERSION_LABEL = 'V40.12 Calendrier';
let driveConnectedForBanner = false;
let lastSaveTimeForBanner = localStorage.getItem('mon-organiseur-last-save-time') || '--';
let lastLocalSaveTimeForBanner = localStorage.getItem('mon-organiseur-last-local-save-time') || '--';
let tokenExpiresAt = Number(localStorage.getItem('mon-organiseur-token-expires-at') || '0');
let pendingDriveSync = localStorage.getItem('mon-organiseur-pending-sync') === '1';
let driveHealthTimer = null;

function nowLabel(date=new Date()){
  return date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}
function getDriveToken(){
  try{
    return (typeof gapi!=='undefined' && gapi.client && gapi.client.getToken) ? gapi.client.getToken() : null;
  }catch{return null;}
}
function hasValidDriveToken(){
  const token=getDriveToken();
  if(!token || !token.access_token) return false;
  if(tokenExpiresAt && Date.now() > (tokenExpiresAt - 60000)) return false;
  return true;
}
function updateVersionBanner(){
  const el=$('versionBanner');
  if(!el) return;
  const state = driveConnectedForBanner ? (pendingDriveSync ? '🟠 Drive à synchroniser' : '🟢 Drive connecté') : '🔴 Drive déconnecté';
  el.textContent = `${VERSION_LABEL} | ${state} | 💾 Drive ${lastSaveTimeForBanner}`;
  updateDriveStatusPanel();
}
function setDriveBanner(connected){
  driveConnectedForBanner = !!connected && hasValidDriveToken();
  if(!driveConnectedForBanner) driveReady=false;
  updateVersionBanner();
  updateDriveStatusPanel();
}
function setLocalSaveBanner(date=new Date()){
  lastLocalSaveTimeForBanner = nowLabel(date);
  localStorage.setItem('mon-organiseur-last-local-save-time', lastLocalSaveTimeForBanner);
  updateDriveStatusPanel();
}
function setSaveBanner(date=new Date()){
  lastSaveTimeForBanner = nowLabel(date);
  localStorage.setItem('mon-organiseur-last-save-time', lastSaveTimeForBanner);
  pendingDriveSync=false;
  localStorage.setItem('mon-organiseur-pending-sync','0');
  updateVersionBanner();
  updateDriveStatusPanel();
}
function markPendingSync(){
  pendingDriveSync=true;
  localStorage.setItem('mon-organiseur-pending-sync','1');
  updateVersionBanner();
  updateDriveStatusPanel();
}

function updateDriveStatusPanel(extra=''){
  const panel=$('driveStatusPanel');
  if(!panel) return;
  const connected = !!driveReady && hasValidDriveToken();
  const connectionText = connected ? '🟢 Connecté' : '🔴 Déconnecté';
  const stateText = connected && !pendingDriveSync ? 'Synchronisé ✅' : 'À synchroniser ⚠️';
  const tokenText = connected ? 'Valide' : 'Non connecté';
  const fileText = driveFileId ? 'Trouvé' : 'Pas encore créé';
  const c=$('driveStatusConnection'); if(c) c.textContent=connectionText;
  const s=$('driveStatusState'); if(s){ s.textContent=stateText; s.className = connected && !pendingDriveSync ? 'driveStateOk' : 'driveStateWarn'; }
  const l=$('driveStatusLocal'); if(l) l.textContent=lastLocalSaveTimeForBanner || '--';
  const r=$('driveStatusRemote'); if(r) r.textContent=lastSaveTimeForBanner || '--';
  const f=$('driveStatusFile'); if(f) f.textContent=fileText;
  const t=$('driveStatusToken'); if(t) t.textContent=extra || tokenText;
}
function explainError(e){
  if(!e) return 'Erreur inconnue';
  if(typeof e==='string') return e;
  const r=e.result?.error || e.error || e;
  const code=r.code || e.status || '';
  const msg=r.message || e.message || JSON.stringify(r);
  return (code ? code+' - ' : '') + msg;
}
function status(msg){
  const el=$('syncStatus'); if(el) el.textContent = msg;
  if(String(msg||'').includes('Drive connecté')) setDriveBanner(true);
  if(String(msg||'').includes('Drive déconnecté') || String(msg||'').includes('Connexion Google Drive perdue')) setDriveBanner(false);
  updateDriveStatusPanel();
}
function clientId(){ return localStorage.getItem(CLIENT_ID_KEY) || ''; }

function scheduleDriveAutosave(){
  setLocalSaveBanner();
  markPendingSync();
  if(!driveReady || !hasValidDriveToken()){
    setDriveBanner(false);
    status('Sauvegarde locale OK. Drive déconnecté : reconnecte Google Drive pour synchroniser.');
    return;
  }
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(()=>saveToDrive(true), 1500);
}

function initDriveUi(){
  const input=$('googleClientId'); if(input) input.value=clientId();
  const saveBtn=$('saveClientIdBtn');
  const connectBtn=$('connectDriveBtn');
  const loadBtn=$('loadDriveBtn');
  const saveDriveBtn=$('saveDriveBtn');
  const disconnectBtn=$('disconnectDriveBtn');
  if(saveBtn) saveBtn.onclick=()=>{
    const v=$('googleClientId').value.trim();
    if(!v){alert('Colle ton Client ID Google.');return;}
    localStorage.setItem(CLIENT_ID_KEY,v);
    status('Client ID enregistré. Clique sur “Se connecter à Google Drive”.');
  };
  if(connectBtn){
    connectBtn.onclick=(e)=>{ e.preventDefault(); connectDrive(); };
    connectBtn.setAttribute('data-ready','oui');
  }
  if(loadBtn) loadBtn.onclick=(e)=>{ e.preventDefault(); loadFromDrive(false); };
  if(saveDriveBtn) saveDriveBtn.onclick=(e)=>{ e.preventDefault(); saveToDrive(false); };
  if(disconnectBtn) disconnectBtn.onclick=(e)=>{ e.preventDefault(); disconnectDrive(); };
  updateVersionBanner();
  updateWebOriginHelp();
  updateDriveStatusPanel();
  status('Interface Google Drive prête. Dernière sauvegarde locale : '+lastLocalSaveTimeForBanner+'.');
  startDriveHealthCheck();
}

function currentRedirectUri(){
  return 'Pas nécessaire en V40.8 : connexion Google par fenêtre, sans URI de redirection.';
}
function updateWebOriginHelp(){
  const o=$('currentOriginText'); if(o) o.textContent=location.origin;
  const r=$('currentRedirectText'); if(r) r.textContent=currentRedirectUri();
}
async function waitForGoogleLibraries(){
  for(let i=0;i<30 && (typeof gapi==='undefined');i++){
    status('Chargement de Google Drive... '+(i+1));
    await new Promise(r=>setTimeout(r,300));
  }
  if(typeof gapi==='undefined') throw new Error('Librairie Google API non chargée');
  await new Promise((resolve,reject)=>{ try{ gapi.load('client',resolve); }catch(e){ reject(e); } });
  await gapi.client.init({discoveryDocs:[DRIVE_DISCOVERY]});
}
async function finishOAuthRedirectIfNeeded(){ return false; }

function startDriveHealthCheck(){
  if(driveHealthTimer) clearInterval(driveHealthTimer);
  driveHealthTimer=setInterval(()=>{
    if(driveReady && !hasValidDriveToken()){
      driveReady=false;
      setDriveBanner(false);
      status('Connexion Google Drive perdue. Sauvegarde locale OK, reconnecte Drive pour synchroniser.');
    }
  }, 30000);
}

async function ensureDriveUsable(silent=false){
  if(!driveReady || !hasValidDriveToken()){
    driveReady=false;
    setDriveBanner(false);
    if(!silent) alert('Google Drive n’est plus connecté. Clique sur “Se connecter à Google Drive”.');
    status('Connexion Google Drive perdue. Sauvegarde locale OK, reconnecte Drive pour synchroniser.');
    return false;
  }
  try{
    await gapi.client.drive.files.list({pageSize:1, fields:'files(id)'});
    setDriveBanner(true);
    return true;
  }catch(e){
    console.error(e);
    driveReady=false;
    setDriveBanner(false);
    if(!silent) alert('Google Drive a refusé la requête : '+explainError(e));
    status('Connexion Google Drive perdue : '+explainError(e));
    return false;
  }
}

async function connectDrive(){
  try{
    status('Préparation de la connexion Google...');
    const cid=clientId();
    if(!cid){ alert('Il faut d’abord créer/coller le Client ID Google.'); return; }
    if(location.protocol==='file:'){ alert('Google Drive ne fonctionne pas depuis file://. Utilise Netlify ou http://localhost:8000'); return; }
    await waitForGoogleLibraries();
    if(typeof google==='undefined' || !google.accounts || !google.accounts.oauth2){
      throw new Error('Librairie Google Identity Services non chargée');
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: DRIVE_SCOPE,
      prompt: 'consent',
      callback: async (resp)=>{
        if(resp.error){
          console.error(resp);
          driveReady=false; setDriveBanner(false);
          status('Connexion refusée : '+resp.error);
          alert('Connexion refusée : '+resp.error);
          return;
        }
        try{
          status('Connexion Google reçue. Initialisation Drive...');
          gapi.client.setToken({access_token: resp.access_token});
          const expiresIn = Number(resp.expires_in || 3600);
          tokenExpiresAt = Date.now() + Math.max(60, expiresIn-30)*1000;
          localStorage.setItem('mon-organiseur-token-expires-at', String(tokenExpiresAt));
          driveReady=true;
          setDriveBanner(true);
          status('Drive connecté. Vérification...');
          const ok=await ensureDriveUsable(false);
          if(ok){
            status('Drive connecté. Chargement de la sauvegarde...');
            await loadFromDrive(true);
            if(pendingDriveSync) await saveToDrive(true);
            scheduleDriveAutosave();
          }
        }catch(e){
          console.error(e);
          driveReady=false; setDriveBanner(false);
          status('Erreur après connexion Google : '+explainError(e));
          alert('Erreur après connexion Google : '+explainError(e));
        }
      }
    });

    status('Ouverture de la fenêtre Google...');
    tokenClient.requestAccessToken({prompt:'consent'});
  }catch(e){
    console.error(e);
    driveReady=false; setDriveBanner(false);
    status('Erreur de connexion Google Drive : '+explainError(e));
    alert('Erreur de connexion Google Drive : '+explainError(e));
  }
}

function disconnectDrive(){
  const token=getDriveToken();
  if(token && typeof google!=='undefined' && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(token.access_token);
  if(typeof gapi!=='undefined' && gapi.client) gapi.client.setToken('');
  tokenExpiresAt=0;
  localStorage.removeItem('mon-organiseur-token-expires-at');
  driveReady=false; setDriveBanner(false); status('Drive déconnecté. Sauvegarde locale conservée.');
}

async function findDriveFile(){
  const res=await gapi.client.drive.files.list({
    q:`name='${DRIVE_FILENAME}' and trashed=false`,
    spaces:'drive', fields:'files(id,name,modifiedTime)', pageSize:10
  });
  const file=(res.result.files||[])[0];
  if(file){ driveFileId=file.id; localStorage.setItem('mon-organiseur-drive-file-id',driveFileId); updateDriveStatusPanel(); return file.id; }
  return '';
}

async function loadFromDrive(silent=false){
  if(!await ensureDriveUsable(silent)) return;
  try{
    let id=driveFileId || await findDriveFile();
    if(!id){ status('Aucune sauvegarde Drive trouvée. Une nouvelle sera créée.'); await saveToDrive(true); return; }
    const res=await gapi.client.drive.files.get({fileId:id, alt:'media'});
    const incoming=typeof res.body==='string'?JSON.parse(res.body):res.result;
    if(incoming && incoming.plans){
      db=incoming;
      localStorage.setItem(KEY,JSON.stringify(db));
      setLocalSaveBanner();
      lastSavedSnapshot=JSON.stringify(db,null,2);
      render();
      setDriveBanner(true);
      pendingDriveSync=false; localStorage.setItem('mon-organiseur-pending-sync','0'); updateVersionBanner();
      status('Données chargées depuis Google Drive.');
    }
  }catch(e){
    console.error(e);
    if(!silent) alert('Impossible de charger depuis Drive : '+explainError(e));
    if(String(explainError(e)).startsWith('401') || String(explainError(e)).startsWith('403')){driveReady=false; setDriveBanner(false);}
    status('Erreur de chargement Drive : '+explainError(e));
  }
}

async function saveToDrive(silent=false){
  if(!await ensureDriveUsable(silent)) return;
  const snapshot=JSON.stringify(db,null,2);
  if(snapshot===lastSavedSnapshot && silent && !pendingDriveSync) return;
  try{
    status('Sauvegarde Drive...');
    let id=driveFileId || await findDriveFile();
    const metadata={name:DRIVE_FILENAME,mimeType:'application/json'};
    const boundary='-------monplanner'+Date.now();
    const body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n'+snapshot+'\r\n--'+boundary+'--';
    const path=id?`/upload/drive/v3/files/${id}`:'/upload/drive/v3/files';
    const method=id?'PATCH':'POST';
    const res=await gapi.client.request({path,method,params:{uploadType:'multipart'},headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
    if(res.result.id){ driveFileId=res.result.id; localStorage.setItem('mon-organiseur-drive-file-id',driveFileId); updateDriveStatusPanel(); }
    lastSavedSnapshot=snapshot;
    setDriveBanner(true);
    setSaveBanner();
    status('Sauvegardé sur Google Drive à '+lastSaveTimeForBanner+' | local '+lastLocalSaveTimeForBanner);
  }catch(e){
    console.error(e);
    markPendingSync();
    if(String(explainError(e)).startsWith('401') || String(explainError(e)).startsWith('403')){driveReady=false; setDriveBanner(false);}
    if(!silent) alert('Impossible de sauvegarder sur Drive : '+explainError(e));
    status('Erreur de sauvegarde Drive : '+explainError(e)+'. Sauvegarde locale OK.');
  }
}

window.connectDrive = connectDrive;
window.initDriveUi = initDriveUi;
document.addEventListener('click', (e)=>{
  if(e.target && e.target.id==='connectDriveBtn'){
    e.preventDefault();
    connectDrive();
  }
});
async function startApp(){ initDriveUi(); render(); await finishOAuthRedirectIfNeeded(); }
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', startApp); } else { startApp(); }
