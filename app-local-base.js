const KEY='mon-organiseur-simple-v2';
const uid=()=>crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
const today=()=>new Date().toISOString().slice(0,10);
const starter=()=>({activePlan:0,assignees:['Christophe'],companies:[],plans:[{id:uid(),title:'Plan de travail',buckets:[
 {id:uid(),title:'À faire',tasks:[{id:uid(),title:'Préparer la liste des achats',notes:'Exemple de tâche modifiable.',assignee:'Christophe',dueDate:'',priority:'normal',progress:'todo',labels:['achat'],checklist:[{text:'Comparer les prix',done:false},{text:'Commander',done:false}]}]},
 {id:uid(),title:'En cours',tasks:[]},{id:uid(),title:'Terminé',tasks:[]}
]}]});
let db=load(), view='board', drag=null;
let calendarCursor=new Date();
calendarCursor.setDate(1);
let calendarMode='month';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
function load(){try{return JSON.parse(localStorage.getItem(KEY))||starter()}catch{return starter()}}
function save(){localStorage.setItem(KEY,JSON.stringify(db))}
function plan(){return db.plans[db.activePlan]||db.plans[0]}
function ensurePlanData(){
  if(!Array.isArray(db.assignees)) db.assignees=[];
  if(!Array.isArray(db.companies)) db.companies=[];
  db.plans.forEach(p=>{
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
function assigneeOptions(selected=''){
  ensurePlanData();
  const names=[...db.assignees];
  if(selected && !names.includes(selected)) names.unshift(selected);
  return '<option value="">Aucun responsable</option>'+names.map(n=>`<option value="${esc(n)}" ${n===selected?'selected':''}>${esc(n)}</option>`).join('');
}
function companyOptions(selected=''){
  ensurePlanData();
  const names=[...db.companies];
  if(selected && !names.includes(selected)) names.unshift(selected);
  return '<option value="">Aucune entreprise</option>'+names.map(n=>`<option value="${esc(n)}" ${n===selected?'selected':''}>${esc(n)}</option>`).join('');
}
function allTasks(){return plan().buckets.flatMap(b=>b.tasks.map(t=>({...t,bucket:b}))) }
function allPlanTasks(){return db.plans.flatMap((p,planIndex)=>(p.buckets||[]).flatMap(b=>(b.tasks||[]).map(t=>({...t,bucket:b,plan:p,planIndex}))))}
function isLate(t){return t.dueDate && t.progress!=='done' && t.dueDate<today()}
function pass(t){const q=$('searchInput').value.toLowerCase();const f=$('filterStatus').value;const text=[t.title,t.notes,t.assignee,t.dueDate,t.priority,t.progress,...(t.labels||[])].join(' ').toLowerCase();if(q&&!text.includes(q))return false;if(f==='todo'&&t.progress==='done')return false;if(f==='done'&&t.progress!=='done')return false;if(f==='late'&&!isLate(t))return false;return true}
function render(){ensurePlanData();renderPlans();$('planTitle').value=plan().title;document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));$(view+'View').classList.remove('hidden');$('addAssigneeBtn')?.addEventListener('click',()=>{const name=prompt('Nom du responsable à ajouter ?','');if(!name)return;const clean=name.trim();if(!clean)return;ensurePlanData();if(!db.assignees.includes(clean)) db.assignees.push(clean);render();alert('Responsable ajouté : '+clean);});document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===view)); if(view==='board')renderBoard(); if(view==='list')renderList(); if(view==='calendar')renderCalendar(); if(view==='assignees')renderGroupedView('assignee'); if(view==='companies')renderGroupedView('company'); save()}
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
function renderBoard(){const root=$('boardView');root.innerHTML='';plan().buckets.forEach(b=>{const sec=document.createElement('section');sec.className='bucket';sec.innerHTML=`<div class="bucketHead"><input value="${esc(b.title)}"><span class="count">${b.tasks.length}</span></div><button class="addCard">+ Ajouter une tâche</button><div class="cards"></div>`;sec.querySelector('input').onchange=e=>{b.title=e.target.value;render()};sec.querySelector('.addCard').onclick=()=>openTask(null,b.id);const cards=sec.querySelector('.cards');cards.ondragover=e=>{e.preventDefault();cards.classList.add('dragover')};cards.ondragleave=()=>cards.classList.remove('dragover');cards.ondrop=()=>{cards.classList.remove('dragover');if(drag){moveTask(drag,b.id);drag=null;render()}};b.tasks.filter(pass).forEach(t=>cards.appendChild(card(t,b.id)));root.appendChild(sec)})}
function card(t,bid){const el=document.createElement('article');el.className='card priority-'+(t.priority||'normal')+' '+(t.progress==='done'?'done':'');el.draggable=true;el.ondragstart=()=>drag=t.id;el.onclick=()=>openTask(t.id,bid);const done=(t.checklist||[]).filter(x=>x.done).length,total=(t.checklist||[]).length;el.innerHTML=`<h3>${t.progress==='done'?'✅ ':''}${esc(t.title)}</h3><div class="meta">${t.priority!=='low'?`<span class="pill ${t.priority}">${prio(t.priority)}</span>`:''}${t.dueDate?`<span class="pill ${isLate(t)?'late':''}">📅 ${esc(t.dueDate)}</span>`:''}${t.assignee?`<span class="pill">👤 ${esc(t.assignee)}</span>`:''}</div>${(t.labels||[]).length?`<div class="meta">${t.labels.map(l=>`<span class="pill">${esc(l)}</span>`).join('')}</div>`:''}${total?`<div class="small">Checklist : ${done}/${total}</div>`:''}`;return el}
function renderList(){const rows=allTasks().filter(pass).map(t=>`<tr class="taskrow priority-${t.priority||'normal'}" data-id="${t.id}"><td>${t.progress==='done'?'✅':'⬜'} ${esc(t.title)}</td><td>${esc(t.bucket.title)}</td><td>${esc(t.assignee||'')}</td><td>${esc(t.dueDate||'')}</td><td>${prio(t.priority)}</td></tr>`).join('');$('listView').innerHTML=`<table class="listTable"><thead><tr><th>Tâche</th><th>Colonne</th><th>Responsable</th><th>Date</th><th>Priorité</th></tr></thead><tbody>${rows||'<tr><td>Aucune tâche trouvée.</td></tr>'}</tbody></table>`;document.querySelectorAll('.taskrow').forEach(r=>r.onclick=()=>openTask(r.dataset.id))}
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
  root.querySelectorAll('.groupTask').forEach(el=>el.onclick=()=>{
    db.activePlan=Number(el.dataset.plan);
    render();
    openTask(el.dataset.id);
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
    (entries.length?`<div class="groupGrid">${entries.map(([name,items])=>`<section class="groupBox">
      <h3><span>${esc(name)} <span class="count">${items.length}</span></span><button class="openGroupBtn" data-field="${field}" data-name="${encodeURIComponent(name)}">Ouvrir</button></h3>
      <div class="groupTasks">${items.slice(0,6).map(t=>taskRowForGroup(t,field)).join('')}${items.length>6?`<div class="small">+ ${items.length-6} tâche(s) dans la page dédiée</div>`:''}</div>
    </section>`).join('')}</div>`:`<p>Aucune tâche trouvée pour ${esc(empty.toLowerCase())}.</p>`);
  root.querySelectorAll('.openGroupBtn').forEach(btn=>btn.onclick=(e)=>{
    e.stopPropagation();
    renderGroupDetail(field,decodeURIComponent(btn.dataset.name));
  });
  attachGroupTaskClicks(root);
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

function renderStats(){const tasks=allTasks();const done=tasks.filter(t=>t.progress==='done').length;const late=tasks.filter(isLate).length;$('statsView').innerHTML=`<div class="statsGrid"><div class="stat"><strong>${tasks.length}</strong><br>Tâches</div><div class="stat"><strong>${done}</strong><br>Terminées</div><div class="stat"><strong>${tasks.length-done}</strong><br>Restantes</div><div class="stat"><strong>${late}</strong><br>En retard</div></div>`}
function prio(p){return {low:'Basse',normal:'Normale',high:'Haute',urgent:'Urgente'}[p]||p}
function findTask(id){for(const b of plan().buckets){const t=b.tasks.find(x=>x.id===id);if(t)return {t,b}}return {}}
function moveTask(id,bid){const {t}=findTask(id);if(!t)return;plan().buckets.forEach(b=>b.tasks=b.tasks.filter(x=>x.id!==id));plan().buckets.find(b=>b.id===bid).tasks.push(t)}
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

function openTask(id,bid){const {t,b}=id?findTask(id):{};$('dialogTitle').textContent=id?'Modifier la tâche':'Nouvelle tâche';$('taskId').value=id||'';$('taskTitle').value=t?.title||'';$('taskNotes').value=t?.notes||'';$('taskAssignee').innerHTML=assigneeOptions(t?.assignee||'');$('taskDueDate').value=t?.dueDate||'';$('taskPriority').value=t?.priority||'normal';$('taskProgress').value=t?.progress||'todo';$('taskLabels').value=(t?.labels||[]).join(', ');$('taskChecklist').value=(t?.checklist||[]).map(x=>(x.done?'[x] ':'')+x.text).join('\n');$('taskBucket').innerHTML=plan().buckets.map(bb=>`<option value="${bb.id}">${esc(bb.title)}</option>`).join('');$('taskBucket').value=(b||plan().buckets.find(x=>x.id===bid)||plan().buckets[0]).id;$('deleteTaskBtn').style.visibility=id?'visible':'hidden';$('taskDialog').showModal()}
function checklistFrom(txt){return txt.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>({done:/^\[x\]/i.test(s),text:s.replace(/^\[x\]\s*/i,'')}))}
$('taskForm').onsubmit=e=>{e.preventDefault();const id=$('taskId').value||uid();const old=findTask(id).t;const t={id,title:$('taskTitle').value.trim(),notes:$('taskNotes').value.trim(),assignee:$('taskAssignee').value.trim(),dueDate:$('taskDueDate').value,priority:$('taskPriority').value,progress:$('taskProgress').value,labels:$('taskLabels').value.split(',').map(x=>x.trim()).filter(Boolean),checklist:checklistFrom($('taskChecklist').value)};plan().buckets.forEach(b=>b.tasks=b.tasks.filter(x=>x.id!==id));const targetBucket=plan().buckets.find(b=>b.id===$('taskBucket').value); if(old){targetBucket.tasks.push(t)}else{targetBucket.tasks.unshift(t)}$('taskDialog').close();render()};
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
$('planTitle').onchange=e=>{plan().title=e.target.value;render()};$('addBucketBtn').onclick=()=>{const title=prompt('Nom de la colonne ?','Nouvelle colonne');if(title){plan().buckets.push({id:uid(),title,tasks:[]});render()}};$('addTaskTopBtn').onclick=()=>openTask(null,plan().buckets[0].id);$('newPlanBtn').onclick=()=>{const title=prompt('Nom du nouveau plan ?','Nouveau plan');if(title){db.plans.push({id:uid(),title,buckets:[{id:uid(),title:'À faire',tasks:[]},{id:uid(),title:'En cours',tasks:[]},{id:uid(),title:'Terminé',tasks:[]}]});db.activePlan=db.plans.length-1;render()}};document.querySelectorAll('.nav').forEach(n=>n.onclick=()=>{view=n.dataset.view;render()});$('searchInput').oninput=render;$('filterStatus').onchange=render;$('exportBtn').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:'application/json'}));a.download='mon-organiseur-sauvegarde.json';a.click()};$('importInput').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{db=JSON.parse(r.result);render()}catch{alert('Fichier non valide')}};r.readAsText(f)};$('resetBtn').onclick=()=>{if(confirm('Tout effacer et remettre le modèle de départ ?')){db=starter();render()}};render();
