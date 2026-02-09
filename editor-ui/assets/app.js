const conditionTypes = ["min","max_le","max_ge","diff_greater","diff_abs_lte","top_is","not_top_is","rank_is","top_diff_gte","top_diff_lte","total_min","total_max","sum_min","sum_max","spread_between"];

const conditionDocs = {
  min:["Dimension >= value",'{"type":"min","dim":"focus","value":5}'],
  max_le:["Dimension <= value",'{"type":"max_le","dim":"wonder","value":3}'],
  max_ge:["Dimension >= value",'{"type":"max_ge","dim":"calm","value":0}'],
  diff_greater:["A > B + value",'{"type":"diff_greater","a":"calm","b":"tempo","value":2}'],
  diff_abs_lte:["|A-B| <= value",'{"type":"diff_abs_lte","a":"focus","b":"insight","value":4}'],
  top_is:["Dimension is highest",'{"type":"top_is","dim":"charm"}'],
  not_top_is:["Dimension is not highest",'{"type":"not_top_is","dim":"tempo"}'],
  rank_is:["Dimension at rank (1 highest)",'{"type":"rank_is","dim":"calm","rank":2}'],
  top_diff_gte:["Top minus second >= value",'{"type":"top_diff_gte","value":3}'],
  top_diff_lte:["Top minus second <= value",'{"type":"top_diff_lte","value":2}'],
  total_min:["Total score >= value",'{"type":"total_min","value":10}'],
  total_max:["Total score <= value",'{"type":"total_max","value":20}'],
  sum_min:["Sum of selected dims >= value",'{"type":"sum_min","dims":["calm","focus"],"value":6}'],
  sum_max:["Sum of selected dims <= value",'{"type":"sum_max","dims":["tempo","wonder"],"value":8}'],
  spread_between:["Spread between min/max",'{"type":"spread_between","min":0,"max":6}']
};

const state = {
  settings: { title: "", subtitle: "", dimensions: [] },
  questions: { questions: [] },
  results: { results: [] },
  ui: { activeTab: "settings", showPotionFields: false, activeQuestionIndex: 0, activeResultIndex: 0 }
};

const els = {
  status: document.getElementById("status"),
  settingsEditor: document.getElementById("settings-editor"),
  questionsEditor: document.getElementById("questions-editor"),
  resultsEditor: document.getElementById("results-editor"),
  jsonSettings: document.getElementById("json-settings"),
  jsonQuestions: document.getElementById("json-questions"),
  jsonResults: document.getElementById("json-results"),
  showPotionToggle: document.getElementById("show-potion-fields"),
  tabButtons: Array.from(document.querySelectorAll("button[data-tab]")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel"))
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const toNum = (v, f=0) => Number.isFinite(Number(v)) ? Number(v) : f;
const esc = (v) => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function setStatus(msg, err=false){ els.status.textContent = msg; els.status.style.color = err ? "#8b2222" : "#9a4e22"; }

function setActiveTab(tab){
  const next = ["settings","questions","results"].includes(tab) ? tab : "settings";
  state.ui.activeTab = next;
  els.tabButtons.forEach((b)=>{ const on = b.dataset.tab===next; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on ? "true":"false");});
  els.tabPanels.forEach((p)=>{ const on = p.dataset.panel===next; p.classList.toggle("is-active", on); p.hidden = !on;});
}

function getDimensionIds(){
  const seen = new Set();
  return (state.settings.dimensions||[]).map((d)=>String(d.id||"").trim()).filter((id)=>id && !seen.has(id) && seen.add(id));
}
function getDimensionLabel(id){ return (state.settings.dimensions||[]).find((d)=>d.id===id)?.label || id; }

function createDimension(){
  const ids = getDimensionIds();
  let i = ids.length + 1; let id = `dim_${i}`;
  while (ids.includes(id)) { i += 1; id = `dim_${i}`; }
  return { id, label: `Dimension ${i}`, left: "Low", right: "High", description: "" };
}
function nextQuestionId(){
  const nums = (state.questions.questions||[]).map((q)=>String(q.id||"").match(/^q(\d+)$/i)).filter(Boolean).map((m)=>Number(m[1]));
  return `q${nums.length ? Math.max(...nums)+1 : (state.questions.questions||[]).length+1}`;
}
function createOption(){ const w={}; getDimensionIds().forEach((id)=>{w[id]=0;}); return { text:"", image:"", weights:w }; }
function createQuestion(){ return { id: nextQuestionId(), prompt:"", image:"", options:[createOption(), createOption()] }; }
function nextResultId(){ const ids = new Set((state.results.results||[]).map((r)=>String(r.id||""))); let i=ids.size+1; let id=`result_${i}`; while(ids.has(id)){i+=1; id=`result_${i}`;} return id; }

function createCondition(type="min"){
  const d = getDimensionIds()[0] || "";
  if (["min","max_le","max_ge"].includes(type)) return { type, dim:d, value:0 };
  if (["diff_greater","diff_abs_lte"].includes(type)) return { type, a:d, b:d, value:0 };
  if (["top_is","not_top_is"].includes(type)) return { type, dim:d };
  if (type === "rank_is") return { type, dim:d, rank:1 };
  if (["top_diff_gte","top_diff_lte","total_min","total_max"].includes(type)) return { type, value:0 };
  if (["sum_min","sum_max"].includes(type)) return { type, dims:d?[d]:[], value:0 };
  if (type === "spread_between") return { type, min:0, max:10 };
  return { type };
}

function createResult(){
  const base = {
    id: nextResultId(), title:"", summary:"", lore:"", image:"", priority:0,
    palette:{ primary:"", secondary:"", accent:"" },
    signals:[], conditions:[]
  };
  if (state.ui.showPotionFields) {
    base.tasting_notes = { top:"", mid:"", base:"" };
    base.side_effect = "";
    base.signature_ritual = "";
  }
  return base;
}

function normalizeData(){
  state.settings = state.settings && typeof state.settings === "object" ? state.settings : {};
  state.settings.title = String(state.settings.title || "");
  state.settings.subtitle = String(state.settings.subtitle || "");
  state.settings.dimensions = Array.isArray(state.settings.dimensions) ? state.settings.dimensions : [];
  state.settings.dimensions = state.settings.dimensions.map((d,i)=>({
    id:String(d?.id||`dim_${i+1}`), label:String(d?.label||d?.id||`Dimension ${i+1}`), left:String(d?.left||"Low"), right:String(d?.right||"High"), description:String(d?.description||"")
  }));

  const dimIds = getDimensionIds();
  if (Array.isArray(state.questions)) state.questions = { questions: state.questions };
  state.questions = state.questions && typeof state.questions === "object" ? state.questions : { questions: [] };
  state.questions.questions = Array.isArray(state.questions.questions) ? state.questions.questions : [];
  state.questions.questions = state.questions.questions.map((q,i)=>({
    id:String(q?.id||`q${i+1}`), prompt:String(q?.prompt||""), image:String(q?.image||""),
    options:(Array.isArray(q?.options)?q.options:[]).map((o)=>{
      const rw = o?.weights && typeof o.weights === "object" ? o.weights : {};
      const w = {}; dimIds.forEach((id)=>{w[id]=toNum(rw[id],0);});
      return { text:String(o?.text||""), image:String(o?.image||""), weights:w };
    })
  }));

  if (Array.isArray(state.results)) state.results = { results: state.results };
  state.results = state.results && typeof state.results === "object" ? state.results : { results: [] };
  state.results.results = Array.isArray(state.results.results) ? state.results.results : [];
  state.results.results = state.results.results.map((r,i)=>{
    const result = {
      id:String(r?.id||`result_${i+1}`), title:String(r?.title||""), summary:String(r?.summary||""), lore:String(r?.lore||""), image:String(r?.image||""), priority:toNum(r?.priority,0),
      palette:{ primary:String(r?.palette?.primary||""), secondary:String(r?.palette?.secondary||""), accent:String(r?.palette?.accent||"") },
      signals:Array.isArray(r?.signals)?r.signals.map((s)=>String(s||"")):(typeof r?.signals==="string"?r.signals.split(/\r?\n/).map((s)=>s.trim()).filter(Boolean):[]),
      conditions:Array.isArray(r?.conditions)?r.conditions.map((c)=>({ ...c })) : []
    };

    if (state.ui.showPotionFields) {
      result.tasting_notes = { top:String(r?.tasting_notes?.top||""), mid:String(r?.tasting_notes?.mid||""), base:String(r?.tasting_notes?.base||"") };
      result.side_effect = String(r?.side_effect||"");
      result.signature_ritual = String(r?.signature_ritual||"");
    }

    return result;
  });

  const qCount = state.questions.questions.length;
  const rCount = state.results.results.length;
  state.ui.activeQuestionIndex = qCount ? clamp(state.ui.activeQuestionIndex, 0, qCount - 1) : 0;
  state.ui.activeResultIndex = rCount ? clamp(state.ui.activeResultIndex, 0, rCount - 1) : 0;
}

function setByPath(obj, path, value){
  const keys = path.split("."); let cur = obj;
  for(let i=0;i<keys.length-1;i+=1){ const k = /^\d+$/.test(keys[i]) ? Number(keys[i]) : keys[i]; cur = cur[k]; }
  const last = /^\d+$/.test(keys[keys.length-1]) ? Number(keys[keys.length-1]) : keys[keys.length-1];
  cur[last] = value;
}

function renderDimensionSelect(value, attrs=""){
  const options = getDimensionIds().map((id)=>`<option value="${esc(id)}" ${id===value?"selected":""}>${esc(getDimensionLabel(id))} (${esc(id)})</option>`).join("");
  return `<select ${attrs}><option value=""></option>${options}</select>`;
}

function conditionHelpHtml(type){
  const info = conditionDocs[type];
  if (!info) return '<div class="cond-help"><p class="muted">No built-in help for this type. See <a class="link" href="wiki.html" target="_blank" rel="noopener">Condition Wiki</a>.</p></div>';
  return `<div class="cond-help"><strong>Meaning</strong><p class="muted">${esc(info[0])}</p><strong>Example</strong><p><code>${esc(info[1])}</code></p></div>`;
}

function renderSettings(){
  const cards = (state.settings.dimensions||[]).map((d,di)=>`
    <div class="card">
      <div class="row between"><strong>Dimension ${di+1}</strong><button class="danger small" type="button" data-action="remove-dimension" data-di="${di}">Remove</button></div>
      <div class="grid">
        <label>ID <input class="dim-id-input" type="text" data-path="settings.dimensions.${di}.id" value="${esc(d.id)}" /></label>
        <label>Label <input type="text" data-path="settings.dimensions.${di}.label" value="${esc(d.label)}" /></label>
        <label>Left <input type="text" data-path="settings.dimensions.${di}.left" value="${esc(d.left)}" /></label>
        <label>Right <input type="text" data-path="settings.dimensions.${di}.right" value="${esc(d.right)}" /></label>
      </div>
      <label>Description <input type="text" data-path="settings.dimensions.${di}.description" value="${esc(d.description)}" /></label>
    </div>`).join("");

  els.settingsEditor.innerHTML = `
    <div class="grid two">
      <label>Title <input type="text" data-path="settings.title" value="${esc(state.settings.title)}" /></label>
      <label>Subtitle <input type="text" data-path="settings.subtitle" value="${esc(state.settings.subtitle)}" /></label>
    </div>
    <div class="row"><button type="button" data-action="add-dimension">Add Dimension</button></div>
    ${cards || '<p class="muted">No dimensions yet.</p>'}`;
}

function renderQuestions(){
  const dims = getDimensionIds();
  const questions = state.questions.questions || [];
  if (!questions.length) {
    els.questionsEditor.innerHTML = '<p class="muted">No questions yet.</p>';
    return;
  }

  const qi = state.ui.activeQuestionIndex;
  const q = questions[qi];
  const questionTabs = questions
    .map((item, idx) => {
      const label = item.id || `q${idx + 1}`;
      return `<button class="entity-tab ${idx===qi?"is-active":""}" type="button" data-action="select-question-tab" data-qi="${idx}">${esc(label)}</button>`;
    })
    .join("");

  const opts = (q.options||[]).map((o,oi)=>{
    const w = dims.map((dim)=>`<label>${esc(getDimensionLabel(dim))}<input type="number" step="1" data-weight="1" data-qi="${qi}" data-oi="${oi}" data-dim="${esc(dim)}" value="${toNum(o.weights?.[dim],0)}" /></label>`).join("");
    return `<div class="card">
      <div class="row between"><strong>Option ${oi+1}</strong><button class="danger small" type="button" data-action="remove-option" data-qi="${qi}" data-oi="${oi}">Remove Option</button></div>
      <div class="grid two">
        <label>Text <input type="text" data-path="questions.questions.${qi}.options.${oi}.text" value="${esc(o.text)}" /></label>
        <label>Image <input type="text" data-path="questions.questions.${qi}.options.${oi}.image" value="${esc(o.image)}" /></label>
      </div>
      <div class="weight-grid">${w || '<p class="muted">Add dimensions first.</p>'}</div>
    </div>`;
  }).join("");

  els.questionsEditor.innerHTML = `
    <div class="entity-tabbar">${questionTabs}</div>
    <div class="card">
      <div class="row between"><strong>Question ${qi+1}</strong><button class="danger small" type="button" data-action="remove-question" data-qi="${qi}">Remove Question</button></div>
      <div class="grid">
        <label>ID <input type="text" data-path="questions.questions.${qi}.id" value="${esc(q.id)}" /></label>
        <label>Image <input type="text" data-path="questions.questions.${qi}.image" value="${esc(q.image)}" /></label>
      </div>
      <label>Prompt <input type="text" data-path="questions.questions.${qi}.prompt" value="${esc(q.prompt)}" /></label>
      <div class="row"><button type="button" data-action="add-option" data-qi="${qi}">Add Option</button></div>
      ${opts || '<p class="muted">No options yet.</p>'}
    </div>`;
}

function renderConditionFields(cond, ri, ci){
  const type = cond.type || "";
  const num = (f,v)=>`<input type="number" step="1" data-cond-field="${f}" data-ri="${ri}" data-ci="${ci}" value="${toNum(v,0)}" />`;
  if (["min","max_le","max_ge"].includes(type)) return `<div class="grid"><label>Dimension ${renderDimensionSelect(cond.dim||"", `data-cond-field="dim" data-ri="${ri}" data-ci="${ci}"`)}</label><label>Value ${num("value", cond.value)}</label></div>`;
  if (["diff_greater","diff_abs_lte"].includes(type)) return `<div class="grid"><label>A ${renderDimensionSelect(cond.a||"", `data-cond-field="a" data-ri="${ri}" data-ci="${ci}"`)}</label><label>B ${renderDimensionSelect(cond.b||"", `data-cond-field="b" data-ri="${ri}" data-ci="${ci}"`)}</label><label>Value ${num("value", cond.value)}</label></div>`;
  if (["top_is","not_top_is"].includes(type)) return `<label>Dimension ${renderDimensionSelect(cond.dim||"", `data-cond-field="dim" data-ri="${ri}" data-ci="${ci}"`)}</label>`;
  if (type === "rank_is") return `<div class="grid"><label>Dimension ${renderDimensionSelect(cond.dim||"", `data-cond-field="dim" data-ri="${ri}" data-ci="${ci}"`)}</label><label>Rank ${num("rank", cond.rank||1)}</label></div>`;
  if (["top_diff_gte","top_diff_lte","total_min","total_max"].includes(type)) return `<label>Value ${num("value", cond.value)}</label>`;
  if (["sum_min","sum_max"].includes(type)) {
    const sel = Array.isArray(cond.dims) ? cond.dims : [];
    const checks = getDimensionIds().map((id)=>`<label><input type="checkbox" data-cond-dims="1" data-ri="${ri}" data-ci="${ci}" value="${esc(id)}" ${sel.includes(id)?"checked":""} />${esc(getDimensionLabel(id))}</label>`).join("");
    return `<div class="grid two"><div><p class="muted">Dimensions</p><div class="grid">${checks || '<p class="muted">No dimensions defined.</p>'}</div></div><label>Value ${num("value", cond.value)}</label></div>`;
  }
  if (type === "spread_between") return `<div class="grid"><label>Min ${num("min", cond.min)}</label><label>Max ${num("max", cond.max)}</label></div>`;
  return '<p class="muted">Custom/legacy condition.</p>';
}

function renderResults(){
  const results = state.results.results || [];
  if (!results.length) {
    els.resultsEditor.innerHTML = '<p class="muted">No results yet.</p>';
    return;
  }

  const ri = state.ui.activeResultIndex;
  const r = results[ri];
  const resultTabs = results
    .map((item, idx) => {
      const label = item.id || `result_${idx + 1}`;
      return `<button class="entity-tab ${idx===ri?"is-active":""}" type="button" data-action="select-result-tab" data-ri="${idx}">${esc(label)}</button>`;
    })
    .join("");

  const signals = (r.signals||[]).join("\n");
  const potionFields = state.ui.showPotionFields
    ? `<div class="grid"><label>Side Effect <input type="text" data-path="results.results.${ri}.side_effect" value="${esc(r.side_effect)}" /></label><label>Signature Ritual <input type="text" data-path="results.results.${ri}.signature_ritual" value="${esc(r.signature_ritual)}" /></label></div>
       <div class="card"><strong>Tasting Notes</strong><div class="grid"><label>Top <input type="text" data-path="results.results.${ri}.tasting_notes.top" value="${esc(r.tasting_notes?.top||"")}" /></label><label>Mid <input type="text" data-path="results.results.${ri}.tasting_notes.mid" value="${esc(r.tasting_notes?.mid||"")}" /></label><label>Base <input type="text" data-path="results.results.${ri}.tasting_notes.base" value="${esc(r.tasting_notes?.base||"")}" /></label></div></div>`
    : '<p class="muted">Potion fields hidden. Use the checkbox above to edit them.</p>';

  const conds = (r.conditions||[]).map((c,ci)=>{
    const t = String(c.type||"");
    const options = conditionTypes.map((type)=>`<option value="${type}" ${type===t?"selected":""}>${type}</option>`).join("");
    const extra = conditionTypes.includes(t) ? "" : `<option value="${esc(t)}" selected>${esc(t||"(empty)")}</option>`;
    return `<div class="card"><div class="row between"><strong>Condition ${ci+1}</strong><button class="danger small" type="button" data-action="remove-condition" data-ri="${ri}" data-ci="${ci}">Remove Condition</button></div>
      <label>Type <select data-cond-field="type" data-ri="${ri}" data-ci="${ci}">${extra}${options}</select></label>
      ${renderConditionFields(c,ri,ci)}
      ${conditionHelpHtml(t)}
    </div>`;
  }).join("");

  els.resultsEditor.innerHTML = `
    <div class="entity-tabbar">${resultTabs}</div>
    <div class="card">
      <div class="row between"><strong>Result ${ri+1}</strong><button class="danger small" type="button" data-action="remove-result" data-ri="${ri}">Remove Result</button></div>
      <div class="grid">
        <label>ID <input type="text" data-path="results.results.${ri}.id" value="${esc(r.id)}" /></label>
        <label>Title <input type="text" data-path="results.results.${ri}.title" value="${esc(r.title)}" /></label>
        <label>Image <input type="text" data-path="results.results.${ri}.image" value="${esc(r.image)}" /></label>
        <label>Priority <input type="number" data-path="results.results.${ri}.priority" value="${toNum(r.priority,0)}" /></label>
      </div>
      <label>Summary <input type="text" data-path="results.results.${ri}.summary" value="${esc(r.summary)}" /></label>
      <label>Description / Lore <textarea data-path="results.results.${ri}.lore">${esc(r.lore)}</textarea></label>
      <div class="card"><strong>Palette (optional)</strong><div class="grid"><label>Primary <input type="text" data-path="results.results.${ri}.palette.primary" value="${esc(r.palette?.primary||"")}" /></label><label>Secondary <input type="text" data-path="results.results.${ri}.palette.secondary" value="${esc(r.palette?.secondary||"")}" /></label><label>Accent <input type="text" data-path="results.results.${ri}.palette.accent" value="${esc(r.palette?.accent||"")}" /></label></div></div>
      ${potionFields}
      <label>Signals (one per line)<textarea data-signals="1" data-ri="${ri}">${esc(signals)}</textarea></label>
      <div class="row between wrap"><button type="button" data-action="add-condition" data-ri="${ri}">Add Condition</button><a class="link" href="wiki.html" target="_blank" rel="noopener">Condition Wiki</a></div>
      ${conds || '<p class="muted">No conditions (always eligible).</p>'}
    </div>`;
}

function syncJsonEditors(){
  [[els.jsonSettings, state.settings],[els.jsonQuestions, state.questions],[els.jsonResults, state.results]].forEach(([ta,obj])=>{
    if (document.activeElement !== ta) ta.value = JSON.stringify(obj, null, 2);
  });
}

function renderAll(){ renderSettings(); renderQuestions(); renderResults(); syncJsonEditors(); setActiveTab(state.ui.activeTab); }

function applyImportedJson(target, parsed){
  if (target === "settings") {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("settings.json must be an object.");
    state.settings = clone(parsed); return;
  }
  if (target === "questions") {
    if (Array.isArray(parsed)) { state.questions = { questions: clone(parsed) }; return; }
    if (!parsed || typeof parsed !== "object") throw new Error("questions.json must be an object or array.");
    state.questions = clone(parsed); return;
  }
  if (target === "results") {
    if (Array.isArray(parsed)) { state.results = { results: clone(parsed) }; return; }
    if (!parsed || typeof parsed !== "object") throw new Error("results.json must be an object or array.");
    state.results = clone(parsed);
  }
}

function handleActionClick(btn){
  const a = btn.dataset.action; if (!a) return;
  const qi = toNum(btn.dataset.qi,-1), oi = toNum(btn.dataset.oi,-1), ri = toNum(btn.dataset.ri,-1), ci = toNum(btn.dataset.ci,-1), di = toNum(btn.dataset.di,-1);
  if (a === "select-question-tab" && qi >= 0) { state.ui.activeQuestionIndex = qi; renderQuestions(); return; }
  if (a === "select-result-tab" && ri >= 0) { state.ui.activeResultIndex = ri; renderResults(); return; }
  if (a === "add-dimension") state.settings.dimensions.push(createDimension());
  else if (a === "remove-dimension" && di >= 0) state.settings.dimensions.splice(di,1);
  else if (a === "add-option" && qi >= 0) state.questions.questions[qi].options.push(createOption());
  else if (a === "remove-option" && qi >= 0 && oi >= 0) state.questions.questions[qi].options.splice(oi,1);
  else if (a === "remove-question" && qi >= 0) state.questions.questions.splice(qi,1);
  else if (a === "add-condition" && ri >= 0) state.results.results[ri].conditions.push(createCondition("min"));
  else if (a === "remove-condition" && ri >= 0 && ci >= 0) state.results.results[ri].conditions.splice(ci,1);
  else if (a === "remove-result" && ri >= 0) state.results.results.splice(ri,1);
  else return;

  if (a === "add-option" || a === "remove-option" || a === "remove-question") state.ui.activeQuestionIndex = qi >= 0 ? qi : state.ui.activeQuestionIndex;
  if (a === "add-condition" || a === "remove-condition" || a === "remove-result") state.ui.activeResultIndex = ri >= 0 ? ri : state.ui.activeResultIndex;
  normalizeData(); renderAll();
}

function updateConditionField(target){
  const ri = toNum(target.dataset.ri,-1), ci = toNum(target.dataset.ci,-1), field = target.dataset.condField;
  if (ri<0 || ci<0 || !field) return;
  const cond = state.results.results?.[ri]?.conditions?.[ci]; if (!cond) return;
  if (field === "type") {
    const replacement = createCondition(target.value || "min");
    Object.keys(cond).forEach((k)=>delete cond[k]);
    Object.assign(cond, replacement);
    normalizeData(); renderAll(); return;
  }
  cond[field] = ["value","rank","min","max"].includes(field) ? toNum(target.value,0) : target.value;
  syncJsonEditors();
}

function updateConditionDims(target){
  const ri = toNum(target.dataset.ri,-1), ci = toNum(target.dataset.ci,-1);
  if (ri<0 || ci<0) return;
  const cond = state.results.results?.[ri]?.conditions?.[ci]; if (!cond) return;
  cond.dims = Array.from(document.querySelectorAll(`input[data-cond-dims="1"][data-ri="${ri}"][data-ci="${ci}"]:checked`)).map((i)=>i.value);
  syncJsonEditors();
}

function updateWeightInput(target){
  const qi = toNum(target.dataset.qi,-1), oi = toNum(target.dataset.oi,-1), dim = target.dataset.dim;
  if (qi<0 || oi<0 || !dim) return;
  const opt = state.questions.questions?.[qi]?.options?.[oi]; if (!opt) return;
  opt.weights[dim] = toNum(target.value,0);
  syncJsonEditors();
}

function downloadJson(filename, data){
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

const readFileJson = async (file) => JSON.parse(await file.text());

async function loadStarterExample(){
  const [settings, questions, results] = await Promise.all([
    fetch("examples/settings.example.json").then((r)=>r.json()),
    fetch("examples/questions.example.json").then((r)=>r.json()),
    fetch("examples/results.example.json").then((r)=>r.json())
  ]);
  state.settings = settings; state.questions = questions; state.results = results;
  normalizeData(); renderAll(); setStatus("Loaded starter example data.");
}

async function loadProjectData(){
  const [settings, questions, results] = await Promise.all([
    fetch("../data/settings.json").then((r)=>{ if(!r.ok) throw new Error("Could not load ../data/settings.json"); return r.json(); }),
    fetch("../data/questions.json").then((r)=>{ if(!r.ok) throw new Error("Could not load ../data/questions.json"); return r.json(); }),
    fetch("../data/results.json").then((r)=>{ if(!r.ok) throw new Error("Could not load ../data/results.json"); return r.json(); })
  ]);
  state.settings = settings; state.questions = questions; state.results = results;
  normalizeData(); renderAll(); setStatus("Loaded data from ../data/*.json.");
}

function bindControls(){
  document.getElementById("add-question").addEventListener("click", ()=>{
    state.questions.questions.push(createQuestion());
    state.ui.activeQuestionIndex = state.questions.questions.length - 1;
    normalizeData(); renderAll();
  });
  document.getElementById("add-result").addEventListener("click", ()=>{
    state.results.results.push(createResult());
    state.ui.activeResultIndex = state.results.results.length - 1;
    normalizeData(); renderAll();
  });

  els.tabButtons.forEach((b)=>b.addEventListener("click", ()=>setActiveTab(b.dataset.tab || "settings")));
  els.showPotionToggle.addEventListener("change", ()=>{
    state.ui.showPotionFields = els.showPotionToggle.checked;
    normalizeData();
    renderAll();
    setStatus(state.ui.showPotionFields
      ? "Potion fields enabled and added to result JSON."
      : "Potion fields removed from result JSON.");
  });

  document.getElementById("load-starter").addEventListener("click", async ()=>{ try{ await loadStarterExample(); } catch(err){ setStatus(`Failed to load starter example: ${err.message}`, true); } });
  document.getElementById("load-project").addEventListener("click", async ()=>{ try{ await loadProjectData(); } catch(err){ setStatus(`Failed to load project data: ${err.message}. Use a local server and open editor-ui/index.html via http://localhost.`, true); } });
  document.getElementById("sync-json").addEventListener("click", ()=>{ syncJsonEditors(); setStatus("JSON editors synced from form data."); });

  document.getElementById("download-settings").addEventListener("click", ()=>downloadJson("settings.json", state.settings));
  document.getElementById("download-questions").addEventListener("click", ()=>downloadJson("questions.json", state.questions));
  document.getElementById("download-results").addEventListener("click", ()=>downloadJson("results.json", state.results));

  document.getElementById("import-settings").addEventListener("change", async (e)=>{ const f=e.target.files?.[0]; if(!f) return; try{ applyImportedJson("settings", await readFileJson(f)); normalizeData(); renderAll(); setStatus("Imported settings.json."); } catch(err){ setStatus(`Import failed: ${err.message}`, true);} });
  document.getElementById("import-questions").addEventListener("change", async (e)=>{ const f=e.target.files?.[0]; if(!f) return; try{ applyImportedJson("questions", await readFileJson(f)); normalizeData(); renderAll(); setStatus("Imported questions.json."); } catch(err){ setStatus(`Import failed: ${err.message}`, true);} });
  document.getElementById("import-results").addEventListener("change", async (e)=>{ const f=e.target.files?.[0]; if(!f) return; try{ applyImportedJson("results", await readFileJson(f)); normalizeData(); renderAll(); setStatus("Imported results.json."); } catch(err){ setStatus(`Import failed: ${err.message}`, true);} });

  document.querySelectorAll("button[data-apply-json]").forEach((b)=>b.addEventListener("click", ()=>{
    const t = b.dataset.applyJson;
    try {
      if (t === "settings") applyImportedJson("settings", JSON.parse(els.jsonSettings.value));
      if (t === "questions") applyImportedJson("questions", JSON.parse(els.jsonQuestions.value));
      if (t === "results") applyImportedJson("results", JSON.parse(els.jsonResults.value));
      normalizeData(); renderAll(); setStatus(`Applied ${t}.json to forms.`);
    } catch(err){ setStatus(`Invalid ${t}.json: ${err.message}`, true); }
  }));

  document.addEventListener("click", (e)=>{ const b=e.target.closest("button[data-action]"); if(b) handleActionClick(b); });
  document.addEventListener("input", (e)=>{
    const t=e.target;
    if (t.matches("input[data-weight]")) return void updateWeightInput(t);
    if (t.matches("textarea[data-signals]")) { const ri=toNum(t.dataset.ri,-1); if (ri>=0) { state.results.results[ri].signals = t.value.split(/\r?\n/).map((x)=>x.trim()).filter(Boolean); syncJsonEditors(); } return; }
    if (t.matches("input[data-path], textarea[data-path]")) { setByPath(state, t.dataset.path, t.type==="number" ? toNum(t.value,0) : t.value); syncJsonEditors(); }
  });
  document.addEventListener("change", (e)=>{
    const t=e.target;
    if (t.matches("input.dim-id-input")) { normalizeData(); renderAll(); return; }
    if (t.matches("select[data-cond-field], input[data-cond-field]")) return void updateConditionField(t);
    if (t.matches("input[data-cond-dims]")) updateConditionDims(t);
  });
}

async function init(){
  bindControls(); setActiveTab("settings");
  try { await loadStarterExample(); }
  catch(err){ state.settings={title:"",subtitle:"",dimensions:[]}; state.questions={questions:[]}; state.results={results:[]}; normalizeData(); renderAll(); setStatus(`Failed to auto-load starter data: ${err.message}`, true); }
}

init();
