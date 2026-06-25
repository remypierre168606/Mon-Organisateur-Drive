const KEY='mon-organiseur-drive-v1';
const uid=()=>crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
const today=()=>new Date().toISOString().slice(0,10);
const starter=()=>({activePlan:0,assignees:['Christophe'],companies:[],plans:[{id:uid(),title:'Plan de travail',buckets:[
 {id:uid(),title:'À faire',tasks:[{id:uid(),title:'Préparer la liste des achats',notes:'Exemple de tâche modifiable.',assignee:'Christophe',company:'',dueDate:'',priority:'normal',progress:'todo',linkName:'',linkUrl:''}]},
 {id:uid(),title:'En cours',tasks:[]},{id:uid(),title:'Terminé',tasks:[]}
]}]});
let db=load(), view=(localStorage.getItem('mon-organiseur-google-client-id')?'board':'settings'), drag=null, dragColumn=null;
let calendarCursor=new Date();
calendarCursor.setDate(1);
let calendarMode='week';

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
function allTasks(){return plan().buckets.flatMap(b=>b.tasks.map(t=>({...t,bucket:b}))) }
function allPlanTasks(){return db.plans.flatMap((p,planIndex)=>(p.buckets||[]).flatMap(b=>(b.tasks||[]).map(t=>({...t,bucket:b,plan:p,planIndex}))))}
function isLate(t){return t.dueDate && t.progress!=='done' && t.dueDate<today()}
function pass(t){const q=$('searchInput').value.toLowerCase();const f=$('filterStatus').value;const text=[t.title,t.notes,t.assignee,t.company,t.dueDate,t.priority,t.progress,t.linkName,t.linkUrl].join(' ').toLowerCase();if(q&&!text.includes(q))return false;if(f==='todo'&&t.progress==='done')return false;if(f==='done'&&t.progress!=='done')return false;if(f==='late'&&!isLate(t))return false;return true}
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
function card(t,bid){const el=document.createElement('article');el.className='card priority-'+(t.priority||'normal')+' '+(t.progress==='done'?'done':'');el.draggable=true;el.ondragstart=()=>drag=t.id;el.onclick=()=>openTask(t.id,bid);el.innerHTML=`<h3>${t.progress==='done'?'✅ ':''}${esc(t.title)}</h3><div class="meta">${t.priority!=='low'?`<span class="pill ${t.priority}">${prio(t.priority)}</span>`:''}${t.dueDate?`<span class="pill ${isLate(t)?'late':''}">📅 ${esc(t.dueDate)}</span>`:''}${t.assignee?`<span class="pill">👤 ${esc(t.assignee)}</span>`:''}${t.company?`<span class="pill">🏢 ${esc(t.company)}</span>`:''}</div>${linksHtml(t)}`;el.querySelectorAll('a.taskLink').forEach(a=>a.onclick=e=>e.stopPropagation());return el}
function renderList(){const rows=allTasks().filter(pass).map(t=>`<tr class="taskrow priority-${t.priority||'normal'}" data-id="${t.id}"><td>${t.progress==='done'?'✅':'⬜'} ${esc(t.title)}</td><td>${esc(t.bucket.title)}</td><td>${esc(t.assignee||'')}</td><td>${esc(t.company||'')}</td><td>${esc(t.dueDate||'')}</td><td>${prio(t.priority)}</td></tr>`).join('');$('listView').innerHTML=`<table class="listTable"><thead><tr><th>Tâche</th><th>Colonne</th><th>Responsable</th><th>Entreprise</th><th>Date</th><th>Priorité</th></tr></thead><tbody>${rows||'<tr><td>Aucune tâche trouvée.</td></tr>'}</tbody></table>`;document.querySelectorAll('.taskrow').forEach(r=>r.onclick=()=>openTask(r.dataset.id))}
function renderCalendar(){
  const root=$('calendarView');
  if(!calendarMode) calendarMode='month';
  const tasksByDate={};
  allTasks().filter(t=>t.dueDate&&pass(t)).forEach(t=>{
    (tasksByDate[t.dueDate] ||= []).push(t);
  });

  if(calendarMode==='week'){
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
      const tasks=tasksByDate[key]||[];
      const dayName=d.toLocaleDateString('fr-FR',{weekday:'long'});
      days.push(`<div class="calCell weekCell ${isToday?'todayCell':''}">
        <div class="calDate weekDate"><div><strong>${esc(dayName.charAt(0).toUpperCase()+dayName.slice(1))}</strong><br><span>${d.toLocaleDateString('fr-FR')}</span></div><button class="calAdd" data-date="${key}" title="Ajouter une tâche à cette date">+</button></div>
        <div class="calTasks">${tasks.map(t=>`<div class="calTask priority-${t.priority||'normal'} ${isLate(t)?'lateTask':''}" data-id="${t.id}" title="${esc(t.title)}">${t.progress==='done'?'✅ ':''}${esc(t.title)}</div>`).join('') || '<div class="emptyDay">Aucune tâche</div>'}</div>
      </div>`);
    }
    root.innerHTML=`
      <div class="calendarHeader">
        <button id="calPrevBtn">← Semaine précédente</button>
        <h2>${esc(title)}</h2>
        <button id="calNextBtn">Semaine suivante →</button>
        <button id="calTodayBtn">Aujourd'hui</button>
        <div class="calendarSwitch">
          <button id="calMonthBtn">Mois</button>
          <button id="calWeekBtn" class="activeSwitch">Semaine</button>
        </div>
      </div>
      <div class="calendarWeek">${days.join('')}</div>`;
    $('calPrevBtn').onclick=()=>{calendarCursor.setDate(calendarCursor.getDate()-7);renderCalendar()};
    $('calNextBtn').onclick=()=>{calendarCursor.setDate(calendarCursor.getDate()+7);renderCalendar()};
    $('calTodayBtn').onclick=()=>{calendarCursor=new Date();renderCalendar()};
    $('calMonthBtn').onclick=()=>{calendarMode='month';calendarCursor.setDate(1);renderCalendar()};
    $('calWeekBtn').onclick=()=>{calendarMode='week';renderCalendar()};
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
      const tasks=tasksByDate[key]||[];
      days.push(`<div class="calCell ${inMonth?'':'otherMonth'} ${isToday?'todayCell':''}">
        <div class="calDate"><strong>${d.getDate()}</strong><button class="calAdd" data-date="${key}" title="Ajouter une tâche à cette date">+</button></div>
        <div class="calTasks">${tasks.map(t=>`<div class="calTask priority-${t.priority||'normal'} ${isLate(t)?'lateTask':''}" data-id="${t.id}" title="${esc(t.title)}">${t.progress==='done'?'✅ ':''}${esc(t.title)}</div>`).join('')}</div>
      </div>`);
    }
    root.innerHTML=`
      <div class="calendarHeader">
        <button id="calPrevBtn">← Mois précédent</button>
        <h2>${esc(monthName.charAt(0).toUpperCase()+monthName.slice(1))}</h2>
        <button id="calNextBtn">Mois suivant →</button>
        <button id="calTodayBtn">Aujourd'hui</button>
        <div class="calendarSwitch">
          <button id="calMonthBtn" class="activeSwitch">Mois</button>
          <button id="calWeekBtn">Semaine</button>
        </div>
      </div>
      <div class="calendarMonth">
        <div class="calWeekday">Lun</div><div class="calWeekday">Mar</div><div class="calWeekday">Mer</div><div class="calWeekday">Jeu</div><div class="calWeekday">Ven</div><div class="calWeekday">Sam</div><div class="calWeekday">Dim</div>
        ${days.join('')}
      </div>`;
    $('calPrevBtn').onclick=()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar()};
    $('calNextBtn').onclick=()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar()};
    $('calTodayBtn').onclick=()=>{calendarCursor=new Date();calendarCursor.setDate(1);renderCalendar()};
    $('calMonthBtn').onclick=()=>{calendarMode='month';renderCalendar()};
    $('calWeekBtn').onclick=()=>{calendarMode='week';calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),Math.min(new Date().getDate(),28));renderCalendar()};
  }
  document.querySelectorAll('.calTask').forEach(el=>el.onclick=()=>openTask(el.dataset.id));
  document.querySelectorAll('.calAdd').forEach(btn=>btn.onclick=(e)=>{e.stopPropagation();openTaskOnDate(btn.dataset.date)});
}
function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function openTaskOnDate(date){openTask(null,plan().buckets[0].id);$('taskDueDate').value=date}

function groupKeyValue(t, field){
  const empty=field==='assignee'?'Aucun responsable':'Aucune entreprise';
  return (t[field]||'').trim() || empty;
}
function taskRowForGroup(t, field){
  return `<div class="groupTask priority-${t.priority||'normal'}" data-plan="${t.planIndex}" data-id="${t.id}">
    <div>
      <strong>${t.progress==='done'?'✅ ':''}${esc(t.title)}</strong>
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
      <strong>${t.progress==='done'?'✅ ':''}${esc(t.title)}</strong>
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
  $('taskDueDate').value=t?.dueDate||'';
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
  $('taskDialog').showModal();
}
function updateTaskBucketOptions(planIndex, selectedBucketId=''){
  const p=db.plans[planIndex]||plan();
  $('taskBucket').innerHTML=(p.buckets||[]).map(bb=>`<option value="${bb.id}">${esc(bb.title)}</option>`).join('');
  const exists=(p.buckets||[]).some(bb=>bb.id===selectedBucketId);
  $('taskBucket').value=exists?selectedBucketId:(p.buckets?.[0]?.id||'');
}
function checklistFrom(txt){return txt.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>({done:/^\[x\]/i.test(s),text:s.replace(/^\[x\]\s*/i,'')}))}
$('taskForm').onsubmit=e=>{e.preventDefault();const id=$('taskId').value||uid();const found=findTaskGlobal(id);const old=found.t;const targetPlanIndex=$('taskPlan')?Number($('taskPlan').value):db.activePlan;const targetPlan=db.plans[targetPlanIndex]||plan();const t={id,title:$('taskTitle').value.trim(),notes:$('taskNotes').value.trim(),assignee:$('taskAssignee').value.trim(),company:$('taskCompany').value.trim(),dueDate:$('taskDueDate').value,priority:$('taskPriority').value,progress:$('taskProgress').value,linkName:$('taskLinkName').value.trim(),linkUrl:$('taskLinkUrl').value.trim()};db.plans.forEach(p=>(p.buckets||[]).forEach(b=>b.tasks=b.tasks.filter(x=>x.id!==id)));const targetBucket=(targetPlan.buckets||[]).find(b=>b.id===$('taskBucket').value)||targetPlan.buckets[0]; if(old){targetBucket.tasks.push(t)}else{targetBucket.tasks.unshift(t)}db.activePlan=targetPlanIndex;$('taskDialog').close();render()};
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

const VERSION_LABEL = 'V36.1';
let driveConnectedForBanner = false;
let lastSaveTimeForBanner = localStorage.getItem('mon-organiseur-last-save-time') || '--';

function updateVersionBanner(){
  const el=$('versionBanner');
  if(!el) return;
  el.textContent = `${VERSION_LABEL} | ${driveConnectedForBanner?'🟢 Drive connecté':'🔴 Drive déconnecté'} | 💾 ${lastSaveTimeForBanner}`;
}
function setDriveBanner(connected){
  driveConnectedForBanner = !!connected;
  updateVersionBanner();
}
function setSaveBanner(date=new Date()){
  lastSaveTimeForBanner = date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  localStorage.setItem('mon-organiseur-last-save-time', lastSaveTimeForBanner);
  updateVersionBanner();
}
function status(msg){
  const el=$('syncStatus'); if(el) el.textContent = msg;
  if(String(msg||'').includes('Drive connecté')) setDriveBanner(true);
  if(String(msg||'').includes('Drive déconnecté')) setDriveBanner(false);
}
function clientId(){ return localStorage.getItem(CLIENT_ID_KEY) || ''; }

function scheduleDriveAutosave(){
  if(!driveReady) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(()=>saveToDrive(true), 1200);
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
  status('Interface Google Drive prête.');
}

function currentRedirectUri(){
  // V36.1 : la connexion Google Drive utilise Google Identity Services en mode popup.
  // Il n'y a plus d'URI de redirection à configurer pour la connexion.
  return 'Pas nécessaire en V36.1 (connexion par fenêtre Google)';
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
async function finishOAuthRedirectIfNeeded(){
  const hash=String(location.hash||'');
  if(!hash.includes('access_token=')) return false;
  const params=new URLSearchParams(hash.slice(1));
  const token=params.get('access_token');
  const err=params.get('error');
  history.replaceState(null,'',location.pathname+location.search);
  if(err){ status('Connexion refusée : '+err); alert('Connexion refusée : '+err); return true; }
  if(!token) return false;
  try{
    status('Connexion Google reçue. Initialisation Drive...');
    await waitForGoogleLibraries();
    gapi.client.setToken({access_token:token});
    driveReady=true;
    setDriveBanner(true);
    status('Drive connecté. Chargement de la sauvegarde...');
    await loadFromDrive(true);
    scheduleDriveAutosave();
  }catch(e){
    console.error(e);
    status('Erreur après connexion Google. Voir console.');
    alert('Erreur après connexion Google : '+(e?.message||e));
  }
  return true;
}
async function connectDrive(){
  try{
    status('Préparation de la connexion Google...');
    const cid=clientId();
    if(!cid){ alert('Il faut d’abord créer/coller le Client ID Google.'); return; }
    if(location.protocol==='file:'){ alert('Google Drive ne fonctionne pas depuis file://. Utilise Netlify ou http://localhost:8000'); return; }

    // V36.1 : nouvelle connexion Google Identity Services par popup.
    // Avantage : plus de redirect_uri, donc plus d'erreur redirect_uri_mismatch.
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
          status('Connexion refusée : '+resp.error);
          alert('Connexion refusée : '+resp.error);
          return;
        }
        try{
          status('Connexion Google reçue. Initialisation Drive...');
          gapi.client.setToken({access_token: resp.access_token});
          driveReady=true;
          setDriveBanner(true);
          status('Drive connecté. Chargement de la sauvegarde...');
          await loadFromDrive(true);
          scheduleDriveAutosave();
        }catch(e){
          console.error(e);
          status('Erreur après connexion Google. Voir console.');
          alert('Erreur après connexion Google : '+(e?.message||e));
        }
      }
    });

    status('Ouverture de la fenêtre Google...');
    tokenClient.requestAccessToken({prompt:'consent'});
  }catch(e){
    console.error(e);
    status('Erreur de connexion Google Drive. Voir console.');
    alert('Erreur de connexion Google Drive : '+(e?.message||e));
  }
}

function disconnectDrive(){
  const token=(typeof gapi!=='undefined' && gapi.client && gapi.client.getToken)?gapi.client.getToken():null;
  if(token && typeof google!=='undefined' && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(token.access_token);
  if(typeof gapi!=='undefined' && gapi.client) gapi.client.setToken('');
  driveReady=false; status('Drive déconnecté.');
}

async function findDriveFile(){
  const res=await gapi.client.drive.files.list({
    q:`name='${DRIVE_FILENAME}' and trashed=false`,
    spaces:'drive', fields:'files(id,name,modifiedTime)', pageSize:10
  });
  const file=(res.result.files||[])[0];
  if(file){ driveFileId=file.id; localStorage.setItem('mon-organiseur-drive-file-id',driveFileId); return file.id; }
  return '';
}

async function loadFromDrive(silent=false){
  if(!driveReady){ if(!silent) alert('Connecte d’abord Google Drive.'); return; }
  try{
    let id=driveFileId || await findDriveFile();
    if(!id){ status('Aucune sauvegarde Drive trouvée. Une nouvelle sera créée.'); await saveToDrive(true); return; }
    const res=await gapi.client.drive.files.get({fileId:id, alt:'media'});
    const incoming=typeof res.body==='string'?JSON.parse(res.body):res.result;
    if(incoming && incoming.plans){ db=incoming; localStorage.setItem(KEY,JSON.stringify(db)); render(); setDriveBanner(true); status('Données chargées depuis Google Drive.'); }
  }catch(e){ console.error(e); if(!silent) alert('Impossible de charger depuis Drive.'); status('Erreur de chargement Drive.'); }
}

async function saveToDrive(silent=false){
  if(!driveReady) return;
  const snapshot=JSON.stringify(db,null,2);
  if(snapshot===lastSavedSnapshot && silent) return;
  try{
    status('Sauvegarde Drive...');
    let id=driveFileId || await findDriveFile();
    const metadata={name:DRIVE_FILENAME,mimeType:'application/json'};
    const boundary='-------monplanner'+Date.now();
    const body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n'+snapshot+'\r\n--'+boundary+'--';
    const path=id?`/upload/drive/v3/files/${id}`:'/upload/drive/v3/files';
    const method=id?'PATCH':'POST';
    const res=await gapi.client.request({path,method,params:{uploadType:'multipart'},headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
    if(res.result.id){ driveFileId=res.result.id; localStorage.setItem('mon-organiseur-drive-file-id',driveFileId); }
    lastSavedSnapshot=snapshot;
    setDriveBanner(true);
    setSaveBanner();
    status('Sauvegardé automatiquement sur Google Drive à '+lastSaveTimeForBanner);
  }catch(e){ console.error(e); if(!silent) alert('Impossible de sauvegarder sur Drive.'); status('Erreur de sauvegarde Drive.'); }
}

window.connectDrive = connectDrive;
window.initDriveUi = initDriveUi;
// Sécurité : même si un autre script remplace le bouton, ce clic sera capté.
document.addEventListener('click', (e)=>{
  if(e.target && e.target.id==='connectDriveBtn'){
    e.preventDefault();
    connectDrive();
  }
});
async function startApp(){ initDriveUi(); render(); await finishOAuthRedirectIfNeeded(); }
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', startApp); } else { startApp(); }