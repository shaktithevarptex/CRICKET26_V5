
// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
const ADMIN_PASS = "26";
const API_BASE = 'api/';
// ─── CricAPI Keys ────────────────────────────────────────────────────────────
// Use different keys for different purposes to spread the 100 hits/day limit.
// Admin can update these inside the app (Manage → Fetch Scores → API Keys).
const API_KEYS = {
  series:    localStorage.getItem('cric_key_series')    || "813aaa00-d400-4d56-bca6-278761ed77fb",
  scorecard: localStorage.getItem('cric_key_scorecard') || "813aaa00-d400-4d56-bca6-278761ed77fb",
  players:   localStorage.getItem('cric_key_players')   || "813aaa00-d400-4d56-bca6-278761ed77fb",
};
function saveApiKeys(){ Object.entries(API_KEYS).forEach(([k,v])=>localStorage.setItem('cric_key_'+k,v)); }

let state = {
  user: null,       // "admin" | "user"
  page: "login",
  prevPage: null,
  tournaments: [],
  tId: null,        // current tournament id
  // wizard
  wiz: { tName:"", sid:"", parsedTeams:[], suggestions:{}, choices:{} }
};

// Try to load tournaments from API; fall back to localStorage if API unavailable
async function loadTournamentsFromServer(){
  try{
    const res = await fetch('api/get_tournaments.php');
    const j = await res.json();
    if(j && j.status === 'success' && Array.isArray(j.data)){
      state.tournaments = j.data.map(t => ({
        ...t,
        id: String(t.id),
        teams: (t.teams||[]).map(tm => ({ ...tm, id: String(tm.id), players: (tm.players||[]).map(p=>({ ...p, id: String(p.id) })) }))
      }));
      return;
    }
  } catch(e){ /* ignore and fallback */ }

  const saved = localStorage.getItem("fantasy_tournaments");
  if(saved){ state.tournaments = JSON.parse(saved); }
}

// API helpers for saving/updating/deleting tournaments
async function apiSaveTournament(tournament){
  const res = await fetch('api/save_tournament.php',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(tournament) });
  return res.json();
}

async function apiUpdateTournament(tournament){
  const res = await fetch('api/update_tournament.php',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(tournament) });
  return res.json();
}

async function apiDeleteTournament(id){
  const res = await fetch('api/delete_tournament.php',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id}) });
  return res.json();
}
const norm = s => (s||"").toLowerCase().replace(/[^a-z]/g,"");

// ── Weekly helpers ────────────────────────────────
function getWeekMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0,10);
}
function getWeekSunday(date) {
  const mon = new Date(getWeekMonday(date));
  mon.setDate(mon.getDate() + 6);
  return mon.toISOString().slice(0,10);
}
function weekKey(date) { return getWeekMonday(date); }
function weekLabel(key) {
  if(!key) return '';
  const sun = getWeekSunday(key);
  const fmt = d => {
    const [y,m,dd] = d.split('-');
    return `${dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]}`;
  };
  return `${fmt(key)} – ${fmt(sun)}`;
}
function getISOWeekNum(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
  const y = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d-y)/86400000)+1)/7);
}
function weekKeyFromInput(val) {
  // val = "YYYY-Www"
  if(!val) return weekKey(new Date());
  const [yr, ww] = val.split('-W');
  const year = parseInt(yr), week = parseInt(ww);
  const jan4 = new Date(year, 0, 4);
  const startW1 = new Date(jan4);
  startW1.setDate(jan4.getDate() - (jan4.getDay()||7) + 1);
  const mon = new Date(startW1);
  mon.setDate(startW1.getDate() + (week-1)*7);
  return mon.toISOString().slice(0,10);
}

function renderSubCaptain(t) {
  const el = document.getElementById("sub-captain");

  const wc = t.weeklyCaptains || {};
  const weeks = Object.keys(wc).sort().reverse();

  const todayKey = weekKey(new Date());
  const todayWeekNum = String(getISOWeekNum(new Date())).padStart(2, "0");
  const todayYear = new Date().getFullYear();

  const historyRows = weeks
    .flatMap((wk) =>
      Object.entries(wc[wk] || {}).map(([teamId, sel]) => {
        const team = (t.teams || []).find((x) => x.id === teamId);
        const cap = (team?.players || []).find((p) => p.id === sel.captain);
        const vc = (team?.players || []).find((p) => p.id === sel.vc);
        if (!cap) return "";

        return `
        <div class="cap-history-row">

          <div class="cap-history-info">
            <div class="cap-meta">
              ${escHtml(weekLabel(wk))} · ${escHtml(
          team?.owner || team?.name || ""
        )}
            </div>

            <div class="cap-tags">
              <span class="cap-tag captain">
                ⭐ C: ${escHtml(cap?.name || "")}
              </span>

              <span class="cap-tag vc">
                🔰 VC: ${escHtml(vc?.name || sel.vc)}
              </span>
            </div>
          </div>

          <button class="cap-delete"
            onclick="deleteCaptainEntry('${escHtml(wk)}','${teamId}')">
            ✕
          </button>

        </div>`;
      })
    )
    .join("");

  el.innerHTML = `
  
  <div class="card">

    <div class="section-title">
      Weekly Captain & Vice-Captain
    </div>

    <div class="cap-info-box">
      Captain earns <b>2×</b> points · Vice-captain earns <b>1.5×</b> points.
      Applied only to matches played within that <b>Mon–Sun week</b>.
    </div>

    <div class="grid-2">

      <div>
        <label class="form-label">Week (Mon–Sun)</label>
        <input 
          type="week"
          id="cap-week-input"
          class="inp"
          value="${todayYear}-W${todayWeekNum}"
          onchange="onCapWeekChange()"
        />

        <div id="cap-week-label" class="meta-text">
          ${weekLabel(todayKey)}
        </div>
      </div>

      <div>
        <label class="form-label">Fantasy Team</label>

        <select 
          class="inp"
          id="cap-team"
          onchange="updateCaptainPlayers()"
        >
          <option value="">Select team</option>
          ${(t.teams || [])
            .map(
              (tm) =>
                `<option value="${tm.id}">
                  ${escHtml(tm.name)}${
                  tm.owner && norm(tm.owner) !== norm(tm.name)
                    ? " (" + escHtml(tm.owner) + ")"
                    : ""
                }
                </option>`
            )
            .join("")}
        </select>

      </div>

    </div>

    <div class="grid-2 mt">

      <div>
        <label class="form-label captain-label">
          Captain (2× points)
        </label>

        <select class="inp" id="cap-player">
          <option value="">Pick team first</option>
        </select>
      </div>

      <div>
        <label class="form-label vc-label">
          Vice Captain (1.5× points)
        </label>

        <select class="inp" id="vc-player">
          <option value="">Pick team first</option>
        </select>
      </div>

    </div>

    <button 
      class="btn btn-success full mt"
      onclick="saveCaptain()"
    >
      Save Captain for this Week
    </button>

  </div>

  ${
    weeks.length
      ? `
  <div class="card mt">

    <div class="section-title">
      Captain History
    </div>

    <div class="cap-history-list">
      ${historyRows || `<div class="meta-text">No captains set yet</div>`}
    </div>

  </div>`
      : ""
  }

  `;
}

function onCapWeekChange() {
  const val = document.getElementById('cap-week-input')?.value;
  const key = weekKeyFromInput(val);
  const lbl = document.getElementById('cap-week-label');
  if(lbl) lbl.textContent = weekLabel(key);
  updateCaptainPlayers(); // pre-fill if already saved
}

function updateCaptainPlayers() {
  const teamId  = document.getElementById('cap-team')?.value;
  const wkVal   = document.getElementById('cap-week-input')?.value;
  const capSel  = document.getElementById('cap-player');
  const vcSel   = document.getElementById('vc-player');
  if(!capSel || !vcSel) return;
  const t = getTournament();
  const team = (t.teams||[]).find(x=>x.id===teamId);
  if(!team) {
    capSel.innerHTML = '<option value="">— pick team first —</option>';
    vcSel.innerHTML  = '<option value="">— pick team first —</option>';
    return;
  }
  const wkKey   = weekKeyFromInput(wkVal);
  const existing = ((t.weeklyCaptains||{})[wkKey]||{})[teamId] || {};
  const opts = p => team.players.map(pl =>
    `<option value="${pl.id}" ${pl.id===p?'selected':''}>${escHtml(pl.name)}</option>`
  ).join('');
  capSel.innerHTML = opts(existing.captain);
  vcSel.innerHTML  = opts(existing.vc);
}

function saveCaptain() {
  const teamId  = document.getElementById('cap-team')?.value;
  const capId   = document.getElementById('cap-player')?.value;
  const vcId    = document.getElementById('vc-player')?.value;
  const wkVal   = document.getElementById('cap-week-input')?.value;
  if(!teamId || !capId || !vcId) { alert('Select team, captain and vice-captain'); return; }
  if(capId === vcId) { alert('Captain and Vice-Captain must be different players'); return; }
  const wkKey  = weekKeyFromInput(wkVal);
  const t      = getTournament();
  const team   = (t.teams||[]).find(x=>x.id===teamId);
  const cap    = (team?.players||[]).find(p=>p.id===capId);
  const vc     = (team?.players||[]).find(p=>p.id===vcId);
  const updated = { ...t,
    weeklyCaptains: { ...(t.weeklyCaptains||{}),
      [wkKey]: { ...((t.weeklyCaptains||{})[wkKey]||{}), [teamId]: { captain:capId, vc:vcId } }
    }
  };
  updateTournament(updated);
  renderSubCaptain(getTournament());
  renderLeaderboard(getTournament());
  // Toast
  const toast = document.createElement('div');
  toast.style.cssText='position:fixed;top:24px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:12px 24px;border-radius:12px;font-weight:700;font-size:14px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.4)';
  toast.textContent = `✅ ${cap?.name||'Captain'} (C) · ${vc?.name||'VC'} — Week ${weekLabel(wkKey)}`;
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(), 3200);
}

function deleteCaptainEntry(wkKey, teamId) {
  if(!confirm('Remove this captain selection?')) return;
  const t = getTournament();
  const newWc = JSON.parse(JSON.stringify(t.weeklyCaptains||{}));
  if(newWc[wkKey]) {
    delete newWc[wkKey][teamId];
    if(!Object.keys(newWc[wkKey]).length) delete newWc[wkKey];
  }
  updateTournament({...t, weeklyCaptains:newWc});
  renderSubCaptain(getTournament());
  renderLeaderboard(getTournament());
}
// ═══════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════
function goPage(page, opts={}) {
  // hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('page-'+page);
  if(el){ el.classList.add('active'); el.classList.remove('fu'); void el.offsetWidth; el.classList.add('fu'); }

  const topbar = document.getElementById('topbar');
  const backBtn = document.getElementById('back-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const apiBadge = document.getElementById('api-badge');
  const pageTitleEl = document.getElementById('page-title');
  const pageSubEl = document.getElementById('page-sub');

  if(page === 'login'){
    topbar.style.display = 'none';
  } else {
    topbar.style.display = 'block';
    logoutBtn.style.display = 'block';
    apiBadge.style.display = state.user==='admin' ? 'inline-block' : 'none';
    updateApiBadge();
  }

  // Back button logic
  const backMap = {
    'user-home': null,
    'admin-home': null,
    'new-tournament': 'admin-home',
    'resolve': 'new-tournament',
    'preview': 'new-tournament',
    'tournament': state.user==='admin' ? 'admin-home' : 'user-home',
  };
  const backTarget = backMap[page];
  backBtn.style.display = backTarget ? 'block' : 'none';
  backBtn.onclick = () => goPage(backTarget);

  // Titles
  const titles = {
    'user-home': ['Tournaments', null],
    'admin-home': ['Admin Dashboard', null],
    'new-tournament': ['New Tournament', null],
    'resolve': ['Verify Player Names', `${Object.keys(state.wiz.suggestions).length} name(s) need confirmation`],
    'preview': ['Review & Create', `${state.wiz.parsedTeams.length} teams · ${state.wiz.parsedTeams.reduce((s,t)=>s+t.players.length,0)} players`],
    'tournament': [getTournament()?.name||'', `${getTournament()?.startDate||''} · ${(getTournament()?.teams||[]).length} teams`],
  };
  const [title, sub] = titles[page] || ['', null];
  pageTitleEl.textContent = title;
  pageSubEl.textContent = sub || '';
  pageSubEl.style.display = sub ? 'block' : 'none';

  state.page = page;

  // Render page content
  renderPage(page);
}

function navBack() {
  const backMap = {
    'new-tournament': 'admin-home',
    'resolve': 'new-tournament',
    'preview': 'new-tournament',
    'tournament': state.user==='admin' ? 'admin-home' : 'user-home',
  };
  const target = backMap[state.page];
  if(target) goPage(target);
}

function logout() {
  state.user = null;
  goPage('login');
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
function getTournament() {
  return state.tournaments.find(t => t.id === state.tId);
}

function updateTournament(updated) {

  state.tournaments = state.tournaments.map(t =>
    t.id === updated.id ? updated : t
  );

  // Try to persist to server, fallback to localStorage
  (async()=>{
    try{
      await apiUpdateTournament(updated);
    }catch(e){
      try{ localStorage.setItem("fantasy_tournaments", JSON.stringify(state.tournaments)); }catch(err){}
    }
  })();

  // re-render UI
  if(state.page === 'tournament') {
    renderTournamentContent();
  }

}

function updateApiBadge() {
  const badge = document.getElementById('api-badge');
  const hits = getHits();
  badge.textContent = `API ${hits}/100`;
  badge.style.background = hits>=90 ? 'rgba(248,113,113,.2)' : 'rgba(56,189,248,.15)';
  badge.style.border = `1px solid ${hits>=90?'rgba(248,113,113,.4)':'rgba(56,189,248,.4)'}`;
  badge.style.color = hits>=90 ? '#f87171' : '#38bdf8';
}

function getHits(){
  const d = JSON.parse(localStorage.getItem("api_hits") || "{}");
  if(d.date === new Date().toDateString()) return d.hits || 0;
  return 0;
}

function bumpHits(n){
  const today = new Date().toDateString();
  const current = getHits();

  const data = {
    date: today,
    hits: current + n
  };

  localStorage.setItem("api_hits", JSON.stringify(data));
  updateApiBadge();
}
function makeId(prefix){ return prefix+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,6); }

// ═══════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════
function playerLogin() {
  state.user = 'user';
  goPage('user-home');
}

function showAdminForm() {
  document.getElementById('login-choose').style.display = 'none';
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-err').style.display = 'none';
  setTimeout(()=>document.getElementById('login-pass').focus(), 50);
}

function backToChoose() {
  document.getElementById('login-choose').style.display = 'flex';
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('login-pass').value = '';
}

function doAdminLogin() {
  const errEl = document.getElementById('login-err');
  const pass = document.getElementById('login-pass').value;
  if(pass !== ADMIN_PASS){ errEl.textContent='Wrong password'; errEl.style.display='block'; return; }
  state.user = 'admin';
  goPage('admin-home');
}

// ═══════════════════════════════════════════════════
// RENDER HELPERS
// ═══════════════════════════════════════════════════
function renderPage(page) {
  if(page==='user-home') renderUserHome();
  else if(page==='admin-home') renderAdminHome();
  else if(page==='new-tournament') renderNewTournament();
  else if(page==='resolve') renderResolve();
  else if(page==='preview') renderPreview();
  else if(page==='tournament') renderTournamentContent();
}

function tournamentCard(t, onClick) {
  const totalPlayers = (t.teams||[]).reduce((s,x)=>s+(x.players?.length||0),0);
  const el = document.createElement('div');
  el.className = 'card';
  el.style.cssText = 'border:1px solid var(--bdra);cursor:pointer;transition:background .18s';
  el.onmouseenter = () => el.style.background = 'var(--surfh)';
  el.onmouseleave = () => el.style.background = '';
  el.onclick = onClick;
  el.innerHTML = `
<div style="display:flex;justify-content:space-between;margin-bottom:12px">
  <span class="badge" style="background:rgba(52,211,153,.15);border:1px solid rgba(52,211,153,.35);color:var(--ok)">
    ${escHtml(t.status||'active')}
  </span>
  <span class="txt-dim fs-11">${(t.teams||[]).length} teams</span>
</div>

<div class="fw-800 txt-main fs-17 mb-8">${escHtml(t.name)}</div>

<div class="txt-dim fs-12">
${(t.matches||[]).length} matches · ${totalPlayers} players
</div>

${state.user==='admin' ? `
<button class="btn btn-danger mt-10"
onclick="event.stopPropagation();deleteTournament('${t.id}')">
Delete
</button>
` : ''}
`;
  return el;
}

function deleteTournament(id){

if(!confirm("Delete this tournament?")) return;

// Try server delete first, fallback locally
(async()=>{
  try{
    const res = await apiDeleteTournament(id);
    if(res && res.status === 'success'){
      state.tournaments = state.tournaments.filter(t => t.id !== id);
      renderAdminHome();
      return;
    }
  } catch(e){}
  // fallback
  state.tournaments = state.tournaments.filter(t => t.id !== id);
  try{ localStorage.setItem("fantasy_tournaments", JSON.stringify(state.tournaments)); }catch(e){}
  renderAdminHome();
})();

}
// ── User Home ─────────────────────────────────────
function renderUserHome() {
  const grid = document.getElementById('user-tournaments-grid');
  grid.innerHTML = '';
  if(!state.tournaments.length) {
    grid.innerHTML = '<div class="ta-center txt-dim" style="padding:80px"><div style="font-size:48px;margin-bottom:16px">🏆</div>No tournaments yet. Check back soon!</div>';
    return;
  }
  state.tournaments.forEach(t => {
    grid.appendChild(tournamentCard(t, () => openTournament(t.id)));
  });
}

// ── Admin Home ────────────────────────────────────
function renderAdminHome() {
  const grid = document.getElementById('admin-tournaments-grid');
  grid.innerHTML = '';
  if(!state.tournaments.length) {
    grid.innerHTML = `<div class="ta-center" style="padding:60px;grid-column:1/-1">
      <div style="font-size:52px;margin-bottom:16px">🏆</div>
      <div class="fw-800 txt-main" style="font-size:20px;margin-bottom:8px">No tournaments yet</div>
      <div class="txt-dim mb-24">Create one and upload your team Excel sheet</div>
      <button class="btn btn-primary" style="padding:14px 36px;font-size:15px" onclick="goNewTournament()">+ Create Tournament & Upload Teams</button>
    </div>`;
    return;
  }
  state.tournaments.forEach(t => {
    grid.appendChild(tournamentCard(t, () => openTournament(t.id)));
  });
}

function openTournament(tId) {
  state.tId = tId;
  currentTab = 'leaderboard';
  goPage('tournament');
}

function goNewTournament() {
  state.wiz = { tName:'', sid:'', parsedTeams:[], suggestions:{}, choices:{} };
  goPage('new-tournament');
}

// ═══════════════════════════════════════════════════
// WIZARD — NEW TOURNAMENT
// ═══════════════════════════════════════════════════
function renderNewTournament() {
  document.getElementById('wiz-name').value = state.wiz.tName || '';
  document.getElementById('wiz-sid').value = state.wiz.sid || '';
  document.getElementById('wiz-upload-msg').style.display = 'none';
  updateWizParsedBanner();
}

function updateWizParsedBanner() {
  const banner = document.getElementById('wiz-parsed-banner');
  const nextBtn = document.getElementById('wiz-next-btn');
  const hint = document.getElementById('wiz-next-hint');
  if(state.wiz.parsedTeams.length) {
    const total = state.wiz.parsedTeams.reduce((s,t)=>s+t.players.length,0);
    const owners = state.wiz.parsedTeams.map(t=>t.owner||t.name).join(', ');
    banner.innerHTML = `✅ <strong>${state.wiz.parsedTeams.length} owner teams</strong> parsed · <strong>${total} players</strong> total<br><span style="font-size:11px;opacity:.8">Owners: ${escHtml(owners)}</span>`;
    banner.style.display = 'block';
    nextBtn.style.display = 'block';
    hint.style.display = 'none';
  } else {
    banner.style.display = 'none';
    nextBtn.style.display = 'none';
    hint.style.display = 'block';
  }
}

function handleWizFile(input) {
  const file = input.files[0];
  input.value = '';
  if(file) parseExcel(file);
}

function handleWizDrop(event) {
  const file = event.dataTransfer.files[0];
  if(file) parseExcel(file);
}

function parseExcel(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const msgEl = document.getElementById('wiz-upload-msg');
  if(!['xlsx','xls','csv'].includes(ext)) {
    msgEl.textContent = '❌ Upload .xlsx, .xls or .csv'; msgEl.style.display='block'; return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, {type:'binary'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});

      const teams = parseAuctionSheet(rows);

      if(!teams.length) {
        msgEl.textContent = '❌ No teams found. Make sure the sheet follows the auction format (owner names in row 1, players below).';
        msgEl.style.display='block'; return;
      }

      // API-based name validation (async, show results after)
      msgEl.style.display='none';
      state.wiz.parsedTeams = teams;
      state.wiz.suggestions = {};
      state.wiz.choices = {};
      updateWizParsedBanner();

      // Kick off async API name check in background
      validateNamesViaAPI(teams).then(sugg => {
        state.wiz.suggestions = sugg;
        updateWizParsedBanner();
      });

    } catch(err) {
      msgEl.textContent = '❌ Error: ' + err.message;
      msgEl.style.display = 'block';
    }
  };
  reader.readAsBinaryString(file);
}

// Parse auction-style sheet:
// Row 0: [maybe_empty, Owner1, Price_header_or_empty, maybe_empty, Owner2, ...]
// Row 1+: [maybe_empty, PlayerName, Price, maybe_empty, PlayerName, Price, ...]
// IMPORTANT: Col A may or may not exist as a cell — XLSX sparse arrays
// So we scan ALL columns (0 onwards) for owner names
function parseAuctionSheet(rows) {
  if(!rows.length) return [];

  const isText  = v => { const s=String(v||'').trim(); return s.length>=2 && /[a-zA-Z]/.test(s) && !/^\d+(\.\d+)?$/.test(s); };
  const isNum   = v => { const s=String(v||'').trim(); return s!=='' && !isNaN(parseFloat(s)); };
  const clean   = v => String(v||'').trim();

  // ── Step 1: Find the owner row ─────────────────────────────
  // It's the FIRST row that has ≥2 text cells (owner names).
  // Works regardless of whether col A exists or is blank.
  let ownerRow = null, ownerRowIdx = 0;
  for(let r = 0; r < Math.min(6, rows.length); r++) {
    const row = rows[r] || [];
    const textCount = row.filter(isText).length;
    if(textCount >= 2) { ownerRow = row; ownerRowIdx = r; break; }
    // Also accept 1 text cell if it has at least one numeric sibling (single-team edge case)
    if(textCount === 1 && row.filter(isNum).length >= 1) { ownerRow = row; ownerRowIdx = r; break; }
  }
  if(!ownerRow) return [];

  // ── Step 2: Locate each team's name column and price column ─
  // Scan ALL columns (0-based) — handles both col-A-missing and col-A-present cases.
  const teamCols = [];
  for(let c = 0; c < ownerRow.length; c++) {
    if(!isText(ownerRow[c])) continue;
    const owner = clean(ownerRow[c]);

    // Find the price column: first numeric cell in data rows starting from c+1
    // Look in cols c+1 and c+2 (in case there's a gap)
    let priceCol = -1;
    for(let pc = c+1; pc <= c+2 && pc < (ownerRow.length + 2); pc++) {
      // Check 2-3 data rows to confirm it's consistently numeric
      let numericCount = 0;
      for(let r = ownerRowIdx+1; r < Math.min(ownerRowIdx+4, rows.length); r++) {
        if(isNum((rows[r]||[])[pc])) numericCount++;
      }
      if(numericCount >= 1) { priceCol = pc; break; }
    }
    if(priceCol === -1) priceCol = c + 1; // fallback

    teamCols.push({ nameCol: c, priceCol, owner });
  }
  if(!teamCols.length) return [];

  // ── Step 3: Collect players for each team ──────────────────
  return teamCols.map(({ nameCol, priceCol, owner }) => {
    const players = [];
    for(let r = ownerRowIdx + 1; r < rows.length; r++) {
      const row  = rows[r] || [];
      const name = clean(row[nameCol]);
      if(name.length >= 3 && /[a-zA-Z]/.test(name) && !isNum(name)) {
        players.push({ name, price: parseFloat(row[priceCol]) || 0, owner });
      }
    }
    return players.length ? { name: owner, owner, players } : null;
  }).filter(Boolean);
}

// Use CricAPI players search to validate names
async function validateNamesViaAPI(teams) {
  const sugg = {};
  const allNames = [...new Set(teams.flatMap(t => t.players.map(p => p.name)))];
  // Only check names that don't closely match our local known list
  const suspicious = allNames.filter(name => {
    const best = fuzzySuggest(name);
    return !best.length || best[0].score < 0.85;
  });
  if(!suspicious.length) return sugg;

  // Show validating message
  const banner = document.getElementById('wiz-parsed-banner');
  if(banner) banner.textContent += ' — 🔍 Validating names via API...';

  for(const name of suspicious.slice(0, 10)) { // limit API calls
    try {
      const data = await cricFetch(`https://api.cricapi.com/v1/players?apikey=${API_KEYS.players}&search=${encodeURIComponent(name)}&offset=0`);
      if(data?.status === 'success' && data.data?.length) {
        const matches = data.data.slice(0,3).map(p => ({name: p.name, score: 0.9}));
        // Only flag if API returns different name
        if(matches.length && norm(matches[0].name) !== norm(name)) {
          sugg[name] = matches;
        }
      }
    } catch(e) {
      // API failed, fall back to local fuzzy for this name
      const local = fuzzySuggest(name);
      if(local.length && local[0].score < 0.98) sugg[name] = local;
    }
  }
  if(banner) banner.textContent = banner.textContent.replace(' — 🔍 Validating names via API...', ' — ✅ Names validated');
  return sugg;
}

function wizNext() {
  state.wiz.tName = document.getElementById('wiz-name').value.trim();
  state.wiz.sid   = document.getElementById('wiz-sid').value.trim();
  if(!state.wiz.tName){ alert('Please enter a tournament name.'); return; }
  if(!state.wiz.sid){ alert('Series ID is required — paste it from CricAPI.'); return; }
  const hasSugg = Object.keys(state.wiz.suggestions).length > 0;
  goPage(hasSugg ? 'resolve' : 'preview');
}

const modal = document.getElementById("rulesModal");

function openModal() {
    modal.style.display = "block";
    document.body.style.overflow = "hidden"; // Prevent background scroll
}

function closeModal() {
    modal.style.display = "none";
    document.body.style.overflow = "auto"; // Restore scroll
}

// Close if user clicks outside the box
window.onclick = function(event) {
    if (event.target == modal) {
        closeModal();
    }
}
// ═══════════════════════════════════════════════════
// FUZZY NAME MATCHING
// ═══════════════════════════════════════════════════
const KNOWN = [
  "Virat Kohli","Rohit Sharma","Shubman Gill","KL Rahul","Shreyas Iyer",
  "Ravindra Jadeja","Hardik Pandya","Jasprit Bumrah","Arshdeep Singh",
  "Kuldeep Yadav","Mohammed Siraj","Rishabh Pant","Suryakumar Yadav",
  "Ishan Kishan","Sanju Samson","Abhishek Sharma","Rinku Singh","Shivam Dube",
  "Axar Patel","Varun Chakaravarthy","Ravi Bishnoi","Harshit Rana",
  "MS Dhoni","Yuzvendra Chahal","Washington Sundar","Prasidh Krishna",
  "Nitish Kumar Reddy","Tilak Varma","Yashasvi Jaiswal",
  "Joe Root","Ben Stokes","Jos Buttler","Ben Duckett","Harry Brook",
  "Jonny Bairstow","Zak Crawley","Jofra Archer","Mark Wood","Adil Rashid",
  "Daryl Mitchell","Kane Williamson","Devon Conway","Glenn Phillips",
  "Rachin Ravindra","Mitchell Santner","Tim Southee","Trent Boult",
  "Matt Henry","Kyle Jamieson","Ish Sodhi","Lockie Ferguson","Will Young",
  "Henry Nicholls","Michael Bracewell","Aiden Markram","Temba Bavuma",
  "Quinton de Kock","David Miller","Heinrich Klaasen","Kagiso Rabada",
  "Brydon Carse","Will Jacks","Jamie Smith","Saqib Mahmood","Wiaan Mulder",
  "Keshav Maharaj","Ryan Rickelton","Dewald Brevis","Nandre Burger",
  "Finn Allen","Matthew Breetzke","Senuran Muthusamy","Bevon Jacobs"
];



// updateCaptainPlayers moved into renderSubCaptain block

function fuzzySuggest(name) {
  const nn = norm(name);
  return KNOWN.map(p => {
    const np = norm(p);
    if(np===nn) return {name:p,score:1};
    if(np.includes(nn)||nn.includes(np)) return {name:p,score:0.9};
    let m=0; for(let c of (nn.length<np.length?nn:np)) if((nn.length>=np.length?nn:np).includes(c)) m++;
    return {name:p, score:m/Math.max(nn.length,np.length)};
  }).filter(p=>p.score>=0.55).sort((a,b)=>b.score-a.score).slice(0,3);
}

// ═══════════════════════════════════════════════════
// RESOLVE PAGE
// ═══════════════════════════════════════════════════
function renderResolve() {
  const container = document.getElementById('resolve-items');
  container.innerHTML = '';
  const entries = Object.entries(state.wiz.suggestions);
  entries.forEach(([orig, suggs]) => {
    const card = document.createElement('div');
    card.className = 'card mb-16';
    card.style.border = '1px solid rgba(251,191,36,.25)';
    card.innerHTML = `
      <div class="flex items-center gap-14 mb-12">
        <span style="font-size:18px">⚠️</span>
        <div>
          <div class="txt-dim fs-11">Found in Excel:</div>
          <div class="fw-800 txt-warn" style="font-size:15px">"${escHtml(orig)}"</div>
        </div>
      </div>
      <div class="txt-dim fs-12 mb-8">Did you mean?</div>
      <div class="flex" style="flex-wrap:wrap;gap:8px" id="pills-${escId(orig)}">
        ${suggs.map(s=>`
          <button class="name-pill ${state.wiz.choices[orig]===s.name?'selected':''}"
            onclick="pickName('${escId(orig)}','${escAttr(orig)}','${escAttr(s.name)}')">
            ${escHtml(s.name)} <span style="color:var(--dim);font-size:10px;margin-left:6px">${Math.round(s.score*100)}%</span>
          </button>
        `).join('')}
        <button class="name-pill keep-orig ${state.wiz.choices[orig]===orig?'selected':''}"
          onclick="pickName('${escId(orig)}','${escAttr(orig)}','__KEEP__')">
          Keep "${escHtml(orig)}"
        </button>
      </div>
    `;
    container.appendChild(card);
  });
  updateResolveBtn();
}

function pickName(escapedOrig, orig, chosen) {
  state.wiz.choices[orig] = chosen==='__KEEP__' ? orig : chosen;
  // Re-render pills for this item
  const pillsEl = document.getElementById('pills-'+escapedOrig);
  if(pillsEl) {
    pillsEl.querySelectorAll('.name-pill').forEach(btn => {
      const isKeep = btn.classList.contains('keep-orig');
      const btnText = btn.textContent.trim().split(' ')[0]; // rough match
      btn.classList.remove('selected');
      if(isKeep && state.wiz.choices[orig]===orig) btn.classList.add('selected');
      else if(!isKeep && state.wiz.choices[orig] && btn.textContent.includes(state.wiz.choices[orig])) btn.classList.add('selected');
    });
    // Simpler: just re-render the whole resolve page
    renderResolve();
  }
  updateResolveBtn();
}

function updateResolveBtn() {
  const entries = Object.entries(state.wiz.suggestions);
  const allDone = entries.every(([o])=>state.wiz.choices[o]);
  const btn = document.getElementById('resolve-confirm-btn');
  if(btn){ btn.disabled = !allDone; }
  const hint = document.getElementById('resolve-hint');
  if(hint){ hint.style.display = allDone?'none':'block'; }
}

function resolveConfirm() { goPage('preview'); }
function resolveSkip() { state.wiz.choices = {}; goPage('preview'); }

// ═══════════════════════════════════════════════════
// PREVIEW PAGE
// ═══════════════════════════════════════════════════
function renderPreview() {
  const { parsedTeams, choices, tName, sid } = state.wiz;
  const total = parsedTeams.reduce((s, t) => s + t.players.length, 0);

  document.getElementById("preview-summary").innerHTML = `
    <div class="preview-stat">
      <div class="stat-label">Tournament</div>
      <div class="stat-value">${escHtml(tName) || "(no name)"}</div>
    </div>

    <div class="preview-stat">
      <div class="stat-label">Teams</div>
      <div class="stat-value">${parsedTeams.length}</div>
    </div>

    <div class="preview-stat">
      <div class="stat-label">Players</div>
      <div class="stat-value">${total}</div>
    </div>

    ${
      sid
        ? `<div class="preview-stat">
            <div class="stat-label">Series</div>
            <div class="stat-value small">${escHtml(sid.slice(0, 28))}…</div>
           </div>`
        : ""
    }
  `;

  const grid = document.getElementById("preview-teams");
  grid.innerHTML = "";

  parsedTeams.forEach((team) => {
    const card = document.createElement("div");
    card.className = "preview-card";

    const playerList = team.players
      .map((p) => {
        const res = choices[p.name];
        const corrected = res && res !== p.name;
        const display = res || p.name;

        return `
        <div class="player-row">
          <span class="player-name ${corrected ? "corrected" : ""}">
            ${escHtml(display)}
          </span>
          ${
            p.price
              ? `<span class="player-price">${p.price}Cr</span>`
              : ""
          }
        </div>`;
      })
      .join("");

    card.innerHTML = `
      <div class="preview-card-header">
        <div>
          <div class="team-owner">${escHtml(team.owner || team.name)}</div>
          <div class="team-meta">${team.players.length} players</div>
        </div>
      </div>

      <div class="player-list">
        ${playerList}
      </div>
    `;

    grid.appendChild(card);
  });

  const noNameWarn = document.getElementById("preview-no-name-warn");
  const createBtn = document.getElementById("preview-create-btn");

  if (!tName.trim()) {
    noNameWarn.style.display = "block";
    createBtn.disabled = true;
  } else {
    noNameWarn.style.display = "none";
    createBtn.disabled = false;
  }
}

function createTournament() {
  const {tName, sid, parsedTeams, choices} = state.wiz;
  if(!tName.trim()) return;
  if(!sid.trim()) { alert('Series ID is required!'); return; }
  const teams = parsedTeams.map(team => ({
    id: makeId('t'),
    name: team.name,
    owner: team.owner || team.name,
    players: team.players.map(p => ({
      id: makeId('p'),
      name: choices[p.name] || p.name,
      originalName: p.name,
      price: p.price || 0,
      owner: team.owner || team.name,
      totalPoints:0, battingPoints:0, bowlingPoints:0, fieldingPoints:0,
      matchPoints:{}, isInjured:false
    }))
  }));
  const newT = {
    id: Date.now().toString(),
    name: tName, weeklyCaptains:{}, seriesId: sid, status:'active',
    startDate: new Date().toISOString().split('T')[0],
    teams, matches:[], createdAt:Date.now()
  };
  state.tournaments.push(newT);
  // Persist to server (if available) otherwise keep local copy
  (async()=>{
    try{
      const payload = { ...newT };
      // send full tournament structure (teams/players)
      const resp = await apiSaveTournament(payload);
      if(resp && resp.status === 'success' && resp.id){
        // use server id
        newT.id = String(resp.id);
        // reload from server to get consistent IDs, but simple replace for now
      }
    }catch(e){
      try{ localStorage.setItem("fantasy_tournaments", JSON.stringify(state.tournaments)); }catch(err){}
    }
  })();
  state.wiz = { tName:'', sid:'', parsedTeams:[], suggestions:{}, choices:{} };
  goPage('admin-home');
}

// ═══════════════════════════════════════════════════
// TOURNAMENT VIEW
// ═══════════════════════════════════════════════════
let currentTab = 'leaderboard';

function renderTournamentContent() {
  const t = getTournament();
  if(!t) return;

  // Show/hide manage tab
  document.getElementById('tab-btn-manage').style.display = state.user==='admin' ? 'block' : 'none';

  renderLeaderboard(t);
  renderMatchesList(t);
  if(state.user==='admin') renderManage(t);
  switchTab(currentTab);
}

function switchTab(tab) {
  currentTab = tab;
  ['leaderboard','matches','manage'].forEach(k => {
    const content = document.getElementById('tab-'+k);
    const btn = document.getElementById('tab-btn-'+k);
    if(content) content.style.display = k===tab ? 'block' : 'none';
    if(btn){ btn.classList.toggle('active', k===tab); }
  });
}

// ── Leaderboard ───────────────────────────────────
function renderLeaderboard(t) {
  const teams = t.teams||[];
  // ── Weekly-scoped captain multiplier ─────────────────────────
  // Captain/VC bonus applies ONLY to match points earned in that Mon-Sun week.
  // Each match has a date; we look up which week it falls in, then check
  // whether the player was C/VC for that week and apply 2× or 1.5× per match.
  function playerTotalWithCap(player) {
    const wc = t.weeklyCaptains || {};
    const matches = t.matches || [];
    // Map matchId → weekKey (Monday date)
    const matchWeek = {};
    matches.forEach(m => { if(m.date) matchWeek[m.id] = weekKey(new Date(m.date)); });
    // Map weekKey → boost for this player
    const boostForWeek = {};
    Object.entries(wc).forEach(([wk, teamSels]) => {
      Object.values(teamSels).forEach(sel => {
        if(player.id === sel.captain) boostForWeek[wk] = Math.max(boostForWeek[wk]||1, 2);
        else if(player.id === sel.vc) boostForWeek[wk] = Math.max(boostForWeek[wk]||1, 1.5);
      });
    });
    const mp = player.matchPoints || {};
    let total = 0;
    Object.entries(mp).forEach(([matchId, pts]) => {
      const raw = (pts.batting||0) + (pts.bowling||0) + (pts.fielding||0);
      const wk  = matchWeek[matchId];
      total += raw * (boostForWeek[wk] || 1);
    });
    // Fallback for players with totalPoints but no matchPoints breakdown
    if(!Object.keys(mp).length) total = player.totalPoints || 0;
    return Math.round(total * 10) / 10;
  }

  // Captain badge: latest week where player is C or VC
  function captainBadge(playerId) {
    const wc = t.weeklyCaptains || {};
    const sortedWks = Object.keys(wc).sort().reverse();
    for(const wk of sortedWks) {
      for(const sel of Object.values(wc[wk]||{})) {
        if(playerId === sel.captain) return 'C';
        if(playerId === sel.vc)      return 'VC';
      }
    }
    return null;
  }

  const ranked = [...teams]
    .map(tm => ({
      ...tm,
      total: (tm.players||[]).reduce((s,p) => s + playerTotalWithCap(p), 0)
    }))
    .sort((a,b) => b.total - a.total);

  const allP = teams.flatMap(tm =>
    (tm.players||[]).map(p => ({
      ...p,
      teamName:   tm.name,
      ownerName:  tm.owner || tm.name,
      cricketTeam: p.cricketTeam || p.country || '',
      capBadge:   captainBadge(p.id),
      totalWithCap: playerTotalWithCap(p)
    }))
  ).sort((a,b) => b.totalWithCap - a.totalWithCap);

  // Top performers
  const medals = ['🥇','🥈','🥉'];
  const tpBlock = document.getElementById('top-performers');
  const tpList  = document.getElementById('top-performers-list');
  if(allP.length) {
    tpBlock.style.display = 'block';
    tpList.innerHTML = allP.map((p,i) => {
      const medalColor = ['var(--gold)','var(--silver)','var(--bronze)'][i] || 'var(--dim)';
      const pts        = p.totalWithCap || p.totalPoints || 0;
      // C/VC badge pill
      const badge = p.capBadge ? `<span style="display:inline-flex;align-items:center;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;margin-right:6px;${p.capBadge==='C'?'background:rgba(251,191,36,.2);color:#fbbf24;border:1px solid rgba(251,191,36,.4)':'background:rgba(139,92,246,.2);color:#a78bfa;border:1px solid rgba(139,92,246,.35)'}">${p.capBadge}</span>` : '';
      // National team line
      const natLine = p.cricketTeam
        ? `<div style="font-size:12px;color:var(--dim);margin-top:3px">🏏 ${escHtml(p.cricketTeam)}</div>` : '';
      // Fantasy owner (always show, no duplication)
      const ownerLine = `<div style="font-size:12px;color:var(--acc);margin-top:2px">👤 ${escHtml(p.ownerName||p.teamName)}</div>`;
      return `
        <div class="flex items-center gap-12" style="padding:11px 0;border-bottom:1px solid var(--bdr)">
          <span style="font-size:20px;min-width:28px;text-align:center;font-weight:900;color:${medalColor}">
            ${medals[i]||i+1}
          </span>
          <div class="flex-1" style="min-width:0">
            <div class="fw-700 txt-main" style="font-size:14px;display:flex;align-items:center;flex-wrap:wrap">
              ${badge}${escHtml(p.name)}
            </div>
            ${natLine}
            ${ownerLine}
          </div>
          <div class="ta-right" style="flex-shrink:0">
            <div class="txt-acc fw-800" style="font-size:18px">${pts}</div>
            <div class="fs-10 txt-dim">pts</div>
          </div>
        </div>`;
    }).join('');
  } else {
    tpBlock.style.display = 'none';
  }

  // Standings
  const standList = document.getElementById('standings-list');
  if(!ranked.length){ standList.innerHTML='<div class="txt-dim ta-center" style="padding:30px">No teams yet</div>'; return; }
  standList.innerHTML = '';
  const leaderPoints = ranked[0]?.total || 0;

  ranked.forEach((team,i) => {
    const isLeader  = i === 0;
    const diff      = leaderPoints - (team.total||0);
    const rankColor = isLeader ? '#10b981' : '#f87171';
    const statusLbl = isLeader
      ? '🟢 Leader'
      : `🔴 ${diff % 1 === 0 ? diff : diff.toFixed(1)} pts behind`;
    const ownerTag  = team.owner && norm(team.owner)!==norm(team.name)
      ? `<span style="color:var(--acc)">👤 ${escHtml(team.owner)}</span>` : '';
    const displayTotal = (team.total||0) % 1 === 0 ? (team.total||0) : (team.total||0).toFixed(1);

    const row = document.createElement('div');
    row.className = 'team-row';
    row.innerHTML = `
      <span style="width:32px;text-align:center;font-size:18px;font-weight:900;color:${['var(--gold)','var(--silver)','var(--bronze)'][i]||'var(--dim)'}">
        ${['🥇','🥈','🥉'][i]||i+1}
      </span>
      <div class="flex-1">
        <div class="fw-800 txt-main" style="font-size:16px">${escHtml(team.name)}</div>
        <div style="margin-top:3px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:11px;font-weight:700;color:${rankColor}">${statusLbl}</span>
          ${ownerTag ? `<span class="fs-11">${ownerTag}</span>` : ''}
        </div>
      </div>
      <div class="ta-right" style="margin-right:10px">
        <div style="font-size:22px;font-weight:800;color:${rankColor}">${displayTotal}</div>
        <div class="fs-10 txt-dim">TOTAL PTS</div>
      </div>
      <span class="txt-dim fs-13" id="arrow-${i}">▼</span>
    `;

    // ── Expanded: group players by national cricket team ──
    const detail = document.createElement('div');
    detail.style.cssText = 'display:none;padding:0 0 14px 46px';

    const groupMap = {};
    (team.players||[]).forEach(p => {
      const nat = p.cricketTeam || p.country || '—';
      if(!groupMap[nat]) groupMap[nat] = [];
      groupMap[nat].push(p);
    });
    const groupKeys = Object.keys(groupMap).sort((a,b) => {
      if(a==='—') return 1; if(b==='—') return -1;
      return a.localeCompare(b);
    });
    groupKeys.forEach(g => groupMap[g].sort((a,b) => playerTotalWithCap(b)-playerTotalWithCap(a)));

    detail.innerHTML = groupKeys.map(nat => {
      const natLabel = nat === '—' ? 'Other / Unknown' : nat;
      const playerRows = groupMap[nat].map(p => {
        const badge = captainBadge(p.id);
        const badgePill = badge
          ? `<span style="font-size:9px;font-weight:800;padding:1px 5px;border-radius:5px;margin-right:5px;${badge==='C'?'background:rgba(251,191,36,.2);color:#fbbf24':'background:rgba(139,92,246,.2);color:#a78bfa'}">${badge}</span>`
          : '';
        const pPts = playerTotalWithCap(p);
        return `
          <div class="player-row" style="${p.isInjured?'opacity:.5':''}">
            ${p.isInjured ? '<span style="font-size:13px">🩹</span>' : ''}
            <div class="flex-1">
              <div class="${p.isInjured?'txt-dim':'txt-main'} fw-600" style="font-size:14px;${p.isInjured?'text-decoration:line-through':''}">
                ${badgePill}${escHtml(p.name)}${p.price?`<span style="font-size:10px;color:var(--warn);margin-left:6px;font-weight:400">${p.price}Cr</span>`:''}
              </div>
              <div class="fs-11 txt-dim">🏏 ${p.battingPoints||0} · ⚾ ${p.bowlingPoints||0} · 🧤 ${p.fieldingPoints||0}</div>
            </div>
            <span style="color:#7dd3fc;font-weight:700;font-size:15px">${pPts}</span>
          </div>`;
      }).join('');
      return `
        <div style="margin-top:10px">
          <div style="font-size:10px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:var(--acc);padding:4px 0 5px;border-bottom:1px solid var(--bdr);margin-bottom:4px">
            🏏 ${escHtml(natLabel)}
          </div>
          ${playerRows}
        </div>`;
    }).join('');

    let open = false;
    row.onclick = () => {
      open = !open;
      detail.style.display = open ? 'block' : 'none';
      const arr = document.getElementById('arrow-'+i);
      if(arr) arr.textContent = open ? '▲' : '▼';
    };
    standList.appendChild(row);
    standList.appendChild(detail);
  });
}

// ── Matches ───────────────────────────────────────
function renderMatchesList(t) {
  const matches = t.matches||[];
  const el = document.getElementById('matches-content');
  if(!matches.length){ el.innerHTML='<div class="txt-dim ta-center" style="padding:60px;font-size:15px">🏏<br><br>No matches processed yet<br><span class="fs-12">Use Admin → Manage → Fetch Scores to load matches</span></div>'; return; }
  const sorted = [...matches].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  el.innerHTML = sorted.map(m=>{
    const ti = m.teamInfo||[];
    const teamImgs = ti.slice(0,2).map(team=>`
      <div style="display:flex;align-items:center;gap:7px;min-width:0">
        <img src="${team.img||''}" style="width:28px;height:28px;border-radius:50%;background:#1e293b;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'"/>
        <span style="font-weight:700;font-size:13px;color:var(--txt);white-space:nowrap">${escHtml(team.shortname||team.name)}</span>
      </div>
    `).join('<span style="color:var(--dim);font-size:12px;padding:0 4px">vs</span>');
    const hasTeamInfo = ti.length >= 2;
    return `
      <div class="card mb-12" onclick="showMatchDetail('${m.id}')" style="cursor:pointer;transition:background .15s" onmouseenter="this.style.background='var(--surfh)'" onmouseleave="this.style.background=''">
        ${hasTeamInfo ? `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            ${teamImgs}
          </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="min-width:0">
            <div class="fw-700 txt-main" style="font-size:13px;line-height:1.4">${escHtml(m.name)}</div>
            ${m.venue?`<div class="txt-dim" style="font-size:11px;margin-top:3px">📍 ${escHtml(m.venue)}</div>`:''}
            <div class="txt-dim" style="font-size:11px;margin-top:2px">📅 ${m.date||''}</div>
          </div>
          <span class="badge"
style="
background:${
m.status==='completed'
?'rgba(52,211,153,.15)'
:m.status==='live'
?'rgba(251,191,36,.15)'
:'rgba(56,189,248,.15)'
};
border:1px solid ${
m.status==='completed'
?'rgba(52,211,153,.35)'
:m.status==='live'
?'rgba(251,191,36,.35)'
:'rgba(56,189,248,.35)'
};
color:${
m.status==='completed'
?'#34d399'
:m.status==='live'
?'#fbbf24'
:'#38bdf8'
};
">
${m.status}
</span>

        </div>
        ${m.result?`<div style="color:var(--ok);font-size:12px;font-weight:600;margin-top:8px;padding-top:8px;border-top:1px solid var(--bdr)">🏆 ${escHtml(m.result)}</div>`:''}
      </div>
    `;
  }).join('');
}

async function showMatchDetail(matchId) {
  const t = getTournament();
  const match = (t.matches||[]).find(m=>m.id===matchId);
  if(!match) return;

  const el = document.getElementById('matches-content');
  const ti = match.teamInfo||[];

  const teamBanner = ti.length>=2 ? `
    <div style="display:flex;align-items:center;gap:16px;background:var(--accd);border:1px solid var(--bdra);border-radius:12px;padding:14px 18px;margin-bottom:16px;flex-wrap:wrap">
      ${ti.map(team=>`
        <div style="display:flex;align-items:center;gap:10px">
          <img src="${team.img||''}" style="width:36px;height:36px;border-radius:50%;background:#1e293b;object-fit:cover" onerror="this.style.display='none'"/>
          <div>
            <div style="font-weight:800;color:var(--txt);font-size:15px">${escHtml(team.name||'')}</div>
            <div style="color:var(--dim);font-size:11px">${escHtml(team.shortname||'')}</div>
          </div>
        </div>
      `).join('<div style="flex:1;text-align:center;color:var(--dim);font-weight:900;font-size:18px">vs</div>')}
    </div>` : '';

  const scorePills = (match.score||[]).map(s=>`
    <span style="background:var(--surf1);border:1px solid var(--bdr);border-radius:8px;padding:4px 12px;font-size:13px;font-weight:700;color:var(--txt)">
      ${escHtml(s.inning||'')} &nbsp;
      <span style="color:var(--acc)">${s.r}/${s.w}</span>
      <span style="color:var(--dim);font-size:11px;margin-left:4px">(${s.o} ov)</span>
    </span>`).join('');

  el.innerHTML = `
    <button class="btn btn-ghost mb-20" onclick="renderMatchesList(getTournament())">← Back</button>
    ${teamBanner}
    <div class="fw-800 txt-main" style="font-size:18px;margin-bottom:4px">${escHtml(match.name)}</div>
    ${match.venue?`<div class="txt-dim fs-12" style="margin-bottom:6px">📍 ${escHtml(match.venue)}</div>`:''}
    ${scorePills?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${scorePills}</div>`:''}
    <div style="color:var(--ok);font-weight:600;font-size:13px;margin-bottom:20px">🏆 ${escHtml(match.result||match.status||'')}</div>

    <div style="display:flex;gap:4px;background:rgba(255,255,255,.04);border-radius:10px;padding:4px;margin-bottom:20px">
      <button id="md-tab-pts" class="tab-btn active" style="flex:1" onclick="mdSwitchTab('pts')">🏆 Fantasy Points</button>
      <button id="md-tab-sc"  class="tab-btn"        style="flex:1" onclick="mdSwitchTab('sc')">📋 Full Scorecard</button>
    </div>

    <div id="md-pane-pts"></div>
    <div id="md-pane-sc" style="display:none">
      <div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--dim)">
        <div style="width:20px;height:20px;border:2px solid var(--acc);border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite"></div>
        Loading scorecard…
      </div>
    </div>
  `;

  // Render fantasy points immediately
  const ptsEl = document.getElementById('md-pane-pts');
  const teamsSorted = (t.teams||[])
    .map(team=>{
      const active=(team.players||[]).filter(p=>{
        const mp=(p.matchPoints||{})[matchId];
        return mp&&((mp.batting||0)+(mp.bowling||0)+(mp.fielding||0))!==0;
      });
      const total=active.reduce((s,p)=>{
        const mp=p.matchPoints[matchId]||{};
        return s+(mp.batting||0)+(mp.bowling||0)+(mp.fielding||0);
      },0);
      return {team,active,total};
    })
    .filter(x=>x.active.length)
    .sort((a,b)=>b.total-a.total);

  if(!teamsSorted.length){
    ptsEl.innerHTML=`<div class="txt-dim ta-center" style="padding:30px">No fantasy points recorded for this match yet.</div>`;
  } else {
    ptsEl.innerHTML = teamsSorted.map(obj=>{
      const sorted=[...obj.active].sort((a,b)=>{
        const ta=a.matchPoints[matchId]||{},tb=b.matchPoints[matchId]||{};
        return ((tb.batting||0)+(tb.bowling||0)+(tb.fielding||0))-((ta.batting||0)+(ta.bowling||0)+(ta.fielding||0));
      });
      return `
        <div class="card mb-14">
          <div class="lbl txt-acc">${escHtml(obj.team.name)} — ${obj.total} pts</div>
          ${sorted.map(p=>{
            const mp=p.matchPoints[matchId]||{};
            const tot=(mp.batting||0)+(mp.bowling||0)+(mp.fielding||0);
            return `
              <div class="flex gap-10" style="padding:8px 0;border-bottom:1px solid var(--bdr)">
                <div class="flex-1">
                  <div class="fw-600 txt-main">${escHtml(p.name)}</div>
                  <div class="fs-11 txt-dim">🏏 ${mp.batting||0} · 🎳 ${mp.bowling||0} · 🧤 ${mp.fielding||0}</div>
                </div>
                <span class="txt-acc fw-700" style="font-size:15px">${tot}</span>
              </div>`;
          }).join('')}
        </div>`;
    }).join('');
  }

  // Fetch full scorecard in background (0 API hits if already stored in DB)
window._mdMatchId = matchId;

try {
  let scorecardData = null;

// 1️⃣ Try DB first
try {
  const r = await fetch(`api/get_scorecard.php?match_id=${encodeURIComponent(matchId)}&tournament_id=${t.id}`);
  const j = await r.json();
  if (j.status === 'success' && j.data) {
    scorecardData = j.data;
  }
} catch(e){}

const scPane = document.getElementById('md-pane-sc');

// 2️⃣ If not in DB → call API
if(!scorecardData){

  const sc = await cricFetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${API_KEYS.scorecard}&id=${matchId}`);

  if(sc?.status === 'success' && sc.data){

    scorecardData = sc.data;
    bumpHits(1);

    // ✅ SAVE FIRST
    await fetch('api/save_scorecard.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        match_id: matchId,
        tournament_id: t.id,
        scorecard: sc.data
      })
    });

    // ✅ PREVENT DOUBLE SCORING
    const alreadyScored = (t.teams || []).every(tm =>
      (tm.players || []).every(p =>
        p.matchPoints && p.matchPoints[matchId]
      )
    );

    if(!alreadyScored){
      const normalized = normalizeScorecard(sc.data);
      let fresh = getTournament();
      let updated = applyMatch(fresh, match, normalized);
      updateTournament(updated);
    }
  }
}

// 3️⃣ Render (ONLY ONCE)
if(scorecardData && window._mdMatchId === matchId){
  const normalized = normalizeScorecard(scorecardData);
  renderFullScorecard(matchId, normalized);
}

// 4️⃣ If nothing found
else if(scPane){
  scPane.innerHTML = `
    <div class="txt-dim ta-center" style="padding:30px">
      📭 No scorecard available for this match yet.
    </div>`;
}

} catch(e){
  const scPane = document.getElementById('md-pane-sc');
  if(scPane){
    scPane.innerHTML = `
      <div class="txt-dim fs-12" style="padding:20px">
        Could not load scorecard: ${escHtml(e.message)}
      </div>`;
  }
}
}

function mdSwitchTab(tab) {
  document.getElementById('md-pane-pts').style.display = tab==='pts'?'block':'none';
  document.getElementById('md-pane-sc').style.display  = tab==='sc' ?'block':'none';
  document.getElementById('md-tab-pts').classList.toggle('active', tab==='pts');
  document.getElementById('md-tab-sc').classList.toggle('active',  tab==='sc');
}

function renderFullScorecard(matchId, data) {
  const el = document.getElementById('md-pane-sc');
  if(!el || window._mdMatchId!==matchId) return;

  const innings = data.scorecard || data.innings || [];
  if(!innings.length){
    el.innerHTML=`<div style="color:#555;padding:30px;text-align:center">Scorecard not available yet.</div>`;
    return;
  }

  const t = getTournament();
  const fantasyNames = new Set(
    (t.teams||[]).flatMap(tm=>(tm.players||[]).map(p=>norm(p.name)))
  );

  const innHtml = innings.map(inn=>{
    const batting  = inn.batting  || [];
    const bowling  = inn.bowling  || [];
    const catching = inn.catching || [];

    // 🎨 Runs color logic
    const getRunColor = (r) =>
      r >= 50 ? '#16a34a' :   // green
      r == 0 ? 'red' :
      '#111';

    const batRows = batting.map(b=>{
      const name  = b.batsman?.name || b.name || '—';
      const isF   = fantasyNames.has(norm(name));
      const dis   = b['dismissal-text'] || 'not out';
      const runs  = b.r ?? 0;

      return `
        <tr style="border-bottom:1px solid #eee;${isF?'background:#fff7ed':''}">
          <td style="padding:10px">
            <div style="font-weight:600;color:#111;display:flex;align-items:center;gap:6px">
              ${escHtml(name)}
              ${isF?'<span style="font-size:9px;background:#f59e0b;color:#fff;border-radius:4px;padding:2px 6px">F</span>':''}
            </div>
            <div style="font-size:11px;color:#777">${escHtml(dis)}</div>
          </td>

          <td style="text-align:center;font-weight:800;font-size:16px;color:${getRunColor(runs)}">
            ${runs}
          </td>

          <td style="text-align:center;color:#666">${b.b??'—'}</td>
          <td style="text-align:center;color:#666">${b['4s']??0}</td>
          <td style="text-align:center;color:#666">${b['6s']??0}</td>

          <td style="text-align:right;color:#444;font-size:12px">
            ${b.sr!=null?Number(b.sr).toFixed(1):'—'}
          </td>
        </tr>`;
    }).join('');

    const bowlRows = bowling.map(bw=>{
      const name = bw.bowler?.name || bw.name || '—';
      const isF  = fantasyNames.has(norm(name));
      const wkts = bw.w ?? 0;

      const wColor =
        wkts >= 3 ? '#16a34a' :
        wkts >= 1 ? '#2563eb' :
        '#111';

      return `
        <tr style="border-bottom:1px solid #eee;${isF?'background:#fff7ed':''}">
          <td style="padding:10px;font-weight:600;color:#111">
            ${escHtml(name)}
            ${isF?'<span style="font-size:9px;background:#f59e0b;color:#fff;border-radius:4px;padding:2px 6px;margin-left:6px">F</span>':''}
          </td>

          <td style="text-align:center;color:#666">${bw.o??'—'}</td>
          <td style="text-align:center;color:#666">${bw.m??0}</td>
          <td style="text-align:center;color:#666">${bw.r??'—'}</td>

          <td style="text-align:center;font-weight:800;font-size:16px;color:${wColor}">
            ${wkts}
          </td>

          <td style="text-align:right;color:#444;font-size:12px">
            ${bw.eco??'—'}
          </td>
        </tr>`;
    }).join('');

    const fieldRows = catching
      .filter(c=>(c.catch||0)+(c.stumped||0)+(c.runout||0)>0)
      .map(c=>{
        const name  = c.catcher?.name || c.name || '—';
        const isF   = fantasyNames.has(norm(name));

        const parts = [];
        if(c.catch)   parts.push(`${c.catch} C`);
        if(c.stumped) parts.push(`${c.stumped} ST`);
        if(c.runout)  parts.push(`${c.runout} RO`);

        return `
          <tr style="border-bottom:1px solid #eee;${isF?'background:#fff7ed':''}">
            <td style="padding:10px;font-weight:600;color:#111">
              ${escHtml(name)}
              ${isF?'<span style="font-size:9px;background:#f59e0b;color:#fff;border-radius:4px;padding:2px 6px;margin-left:6px">F</span>':''}
            </td>
            <td style="padding:10px;color:#555">${parts.join(' · ')}</td>
          </tr>`;
      }).join('');

    return `
      <div style="
        background:#fff;
        border-radius:14px;
        padding:16px;
        margin-bottom:16px;
        box-shadow:0 4px 14px rgba(0,0,0,0.06)
      ">

        <div style="font-weight:800;font-size:16px;color:#111;margin-bottom:12px">
          🏏 ${escHtml(inn.inning||'')}
        </div>

        <!-- Batting -->
        <div style="font-size:12px;font-weight:700;color:#888;margin-bottom:6px">BATTING</div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
          <thead>
            <tr style="font-size:11px;color:#888;text-transform:uppercase">
              <th align="left">Batter</th>
              <th>R</th>
              <th>B</th>
              <th>4s</th>
              <th>6s</th>
              <th align="right">SR</th>
            </tr>
          </thead>
          <tbody>${batRows}</tbody>
        </table>

        <!-- Bowling -->
        <div style="font-size:12px;font-weight:700;color:#888;margin-bottom:6px">BOWLING</div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
          <thead>
            <tr style="font-size:11px;color:#888;text-transform:uppercase">
              <th align="left">Bowler</th>
              <th>O</th>
              <th>M</th>
              <th>R</th>
              <th>W</th>
              <th align="right">Eco</th>
            </tr>
          </thead>
          <tbody>${bowlRows}</tbody>
        </table>

        ${fieldRows ? `
        <div style="font-size:12px;font-weight:700;color:#888;margin-bottom:6px">FIELDING</div>
        <table style="width:100%;border-collapse:collapse">
          <tbody>${fieldRows}</tbody>
        </table>
        ` : ''}
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="margin-bottom:12px;color:#666;font-size:12px">
      <span style="background:#f59e0b;color:#fff;border-radius:4px;padding:2px 6px;font-weight:700">F</span>
      = your fantasy player
    </div>
    ${innHtml}`;
}
// ── Manage Tab ────────────────────────────────────
let currentSubTab = 'upload';

function switchSubTab(sub) {
  currentSubTab = sub;

  const t = getTournament();   // get tournament data

  ['upload','scores','captain','injury','manual'].forEach(k => {
    const el = document.getElementById('sub-'+k);
    const btn = document.getElementById('sub-btn-'+k);

    if(el) el.style.display = k===sub ? 'block' : 'none';
    if(btn) btn.classList.toggle('active', k===sub);
  });

  // render tab content
  if(sub === 'manual') renderSubManual(t);
}

function renderSubManual(t){
  const el = document.getElementById('sub-manual');
  const matches  = (t.matches||[]).filter(m=>m.status==='completed')
    .map(m=>`<option value="${escHtml(m.id)}">${escHtml(m.name)}</option>`).join('');
  const players  = (t.teams||[]).flatMap(tm=>
    (tm.players||[]).map(p=>`<option value="${p.id}">[${escHtml(tm.name)}] ${escHtml(p.name)}</option>`)
  ).join('');
  const teams    = (t.teams||[]).map(tm=>`<option value="${tm.id}">${escHtml(tm.name)}</option>`).join('');

  el.innerHTML = `

  <!-- ── Player bonus/penalty ── -->
  <div class="card mb-14">
    <div class="lbl">🎯 Player Bonus / Penalty</div>
    <div class="txt-dim fs-12" style="margin:8px 0 14px;line-height:1.6">
      Apply extra points (positive or negative) to a specific player for a match.
      e.g. Man of the Match +100, missed run-out -10.
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div>
        <div class="lbl fs-11">Player</div>
        <select class="inp" id="manual-player" style="margin-top:6px">${players}</select>
      </div>
      <div>
        <div class="lbl fs-11">Match (optional)</div>
        <select class="inp" id="manual-match" style="margin-top:6px">
          <option value="">— Any match —</option>
          ${matches}
        </select>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px">
      <div>
        <div class="lbl fs-11">Preset</div>
        <select class="inp" id="manual-type" style="margin-top:6px" onchange="fillManualPreset()">
          <option value="custom">Custom amount</option>
          <option value="mom">Man of the Match (+100)</option>
          <option value="hatrick">Hat-trick (+100)</option>
          <option value="potw">Player of the Week (+150)</option>
          <option value="6s">6 Sixes in over (+100)</option>
          <option value="4s">6 Fours in over (+50)</option>
          <option value="penalty">Penalty (-50)</option>
        </select>
      </div>
      <div>
        <div class="lbl fs-11">Points</div>
        <input class="inp" id="manual-pts" type="number" value="100" style="margin-top:6px"/>
      </div>
      <div>
        <div class="lbl fs-11">Category</div>
        <select class="inp" id="manual-cat" style="margin-top:6px">
          <option value="bowling">Bowling</option>
          <option value="batting">Batting</option>
          <option value="fielding">Fielding</option>
        </select>
      </div>
    </div>

    <div style="margin-bottom:14px">
      <div class="lbl fs-11">Reason (shown in log)</div>
      <input class="inp" id="manual-reason" placeholder="e.g. Man of the Match award" style="margin-top:6px"/>
    </div>

    <button class="btn btn-success" style="width:100%" onclick="applyManualPoints()">✅ Apply Points</button>
    <div id="manual-msg" style="margin-top:10px;display:none"></div>
  </div>

  <!-- ── Team-wide award ── -->
  <div class="card mb-14">
    <div class="lbl">🏅 Team Award / Penalty</div>
    <div class="txt-dim fs-12" style="margin:8px 0 14px">
      Apply points to every non-injured player in a team. Useful for team bonuses or penalties.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div>
        <div class="lbl fs-11">Team</div>
        <select class="inp" id="award-team" style="margin-top:6px">${teams}</select>
      </div>
      <div>
        <div class="lbl fs-11">Points per player</div>
        <input class="inp" id="award-pts" type="number" value="50" style="margin-top:6px"/>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <div class="lbl fs-11">Reason</div>
      <input class="inp" id="award-reason" placeholder="e.g. Win bonus" style="margin-top:6px"/>
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="applyTeamAward()">🏆 Apply Team Award</button>
    <div id="award-msg" style="margin-top:10px;display:none"></div>
  </div>

  <!-- ── Tournament Awards ── -->
  <div class="card">
    <div class="lbl">🎖 Tournament Awards</div>
    <div class="txt-dim fs-12" style="margin:8px 0 14px">Seasonal awards — applied once at end of tournament (+200 pts each).</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div>
        <div class="lbl fs-11">Player</div>
        <select class="inp" id="award-player" style="margin-top:6px">${players}</select>
      </div>
      <div>
        <div class="lbl fs-11">Award</div>
        <select class="inp" id="award-type" style="margin-top:6px">
          <option value="purple">🟣 Purple Cap (+200)</option>
          <option value="orange">🟠 Orange Cap (+200)</option>
          <option value="pot">🏆 Player of Tournament (+200)</option>
          <option value="emerging">⭐ Emerging Player (+200)</option>
        </select>
      </div>
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="applyTournamentAward()">Give Award</button>
  </div>

  `;
}

function fillManualPreset() {
  const presets = {custom:null,mom:100,hatrick:100,potw:150,'6s':100,'4s':50,penalty:-50};
  const type = document.getElementById('manual-type')?.value;
  const labels = {mom:'Man of the Match',hatrick:'Hat-trick',potw:'Player of the Week','6s':'6 Sixes in over','4s':'6 Fours in over',penalty:'Penalty'};
  const pts = document.getElementById('manual-pts');
  const rsn = document.getElementById('manual-reason');
  if(type && presets[type]!=null){ if(pts) pts.value=presets[type]; }
  if(type && labels[type] && rsn) rsn.value=labels[type];
}

async function applyManualPoints(){
  const t        = getTournament();
  const matchId  = document.getElementById('manual-match')?.value||'';
  const playerId = document.getElementById('manual-player')?.value||'';
  const pts      = parseInt(document.getElementById('manual-pts')?.value||'0');
  const cat      = document.getElementById('manual-cat')?.value||'bowling';
  const reason   = (document.getElementById('manual-reason')?.value||'Manual').trim();
  const msgEl    = document.getElementById('manual-msg');

  if(!playerId){ if(msgEl){msgEl.innerHTML='<div class="alert alert-err">Select a player.</div>';msgEl.style.display='block';} return; }
  if(!pts){ if(msgEl){msgEl.innerHTML='<div class="alert alert-err">Enter non-zero points.</div>';msgEl.style.display='block';} return; }

  // Try server-side first
  try {
    const numericId = parseInt(playerId); // DB id is numeric
    if(!isNaN(numericId)){
      const res = await fetch(`${API_BASE}manual_points.php`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({type:'player',player_id:numericId,match_id:matchId,points:pts,category:cat,reason})
      });
      const j = await res.json();
      if(j.status==='success'){
        await loadTournamentsFromServer();
        renderLeaderboard(getTournament());
        if(msgEl){msgEl.innerHTML=`<div class="alert alert-ok">✅ ${escHtml(j.player)}: ${pts>0?'+':''}${pts} pts applied (${escHtml(reason)})</div>`;msgEl.style.display='block';}
        return;
      }
    }
  } catch(e){}

  // Fallback: apply in JS state
  const updated = {...t, teams: t.teams.map(tm=>({...tm, players: tm.players.map(p=>{
    if(p.id !== playerId) return p;
    const mp = {...(p.matchPoints||{})};
    if(matchId){
      const cur = mp[matchId]||{batting:0,bowling:0,fielding:0};
      cur[cat] = (cur[cat]||0) + pts;
      mp[matchId] = cur;
    }
    return {...p, matchPoints:mp, totalPoints:(p.totalPoints||0)+pts,
      battingPoints: cat==='batting'  ? (p.battingPoints||0)+pts  : (p.battingPoints||0),
      bowlingPoints: cat==='bowling'  ? (p.bowlingPoints||0)+pts  : (p.bowlingPoints||0),
      fieldingPoints:cat==='fielding' ? (p.fieldingPoints||0)+pts : (p.fieldingPoints||0),
    };
  })}))}; 
  updateTournament(updated);
  renderLeaderboard(getTournament());
  if(msgEl){msgEl.innerHTML=`<div class="alert alert-ok">✅ ${pts>0?'+':''}${pts} pts applied (offline mode)</div>`;msgEl.style.display='block';}
}

async function applyTeamAward(){
  const t      = getTournament();
  const teamId = document.getElementById('award-team')?.value||'';
  const pts    = parseInt(document.getElementById('award-pts')?.value||'0');
  const reason = (document.getElementById('award-reason')?.value||'Award').trim();
  const msgEl  = document.getElementById('award-msg');
  if(!teamId||!pts){ if(msgEl){msgEl.innerHTML='<div class="alert alert-err">Select team and enter points.</div>';msgEl.style.display='block';} return; }

  try {
    const res = await fetch(`${API_BASE}manual_points.php`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type:'team',team_id:parseInt(teamId),points:pts,reason})
    });
    const j = await res.json();
    if(j.status==='success'){
      await loadTournamentsFromServer();
      renderLeaderboard(getTournament());
      if(msgEl){msgEl.innerHTML=`<div class="alert alert-ok">✅ ${pts>0?'+':''}${pts} pts applied to ${j.players_updated} players</div>`;msgEl.style.display='block';}
      return;
    }
  } catch(e){}

  // Fallback JS
  const updated = {...t, teams: t.teams.map(tm=>{
    if(tm.id!==teamId) return tm;
    return {...tm, players:(tm.players||[]).map(p=>({...p,totalPoints:(p.totalPoints||0)+pts}))};
  })};
  updateTournament(updated);
  renderLeaderboard(getTournament());
  if(msgEl){msgEl.innerHTML=`<div class="alert alert-ok">✅ Team award applied (offline)</div>`;msgEl.style.display='block';}
}

function applyTournamentAward(){
  const t        = getTournament();
  const playerId = document.getElementById('award-player')?.value||'';
  const type     = document.getElementById('award-type')?.value||'';
  if(!playerId) return;
  const bonus = 200;
  const updated = {...t, teams: t.teams.map(tm=>({...tm, players: tm.players.map(p=>{
    if(p.id!==playerId) return p;
    return {...p, totalPoints:(p.totalPoints||0)+bonus};
  })}))};
  updateTournament(updated);
  renderLeaderboard(getTournament());
  const labels = {purple:'🟣 Purple Cap',orange:'🟠 Orange Cap',pot:'🏆 Player of Tournament',emerging:'⭐ Emerging Player'};
  const toast=document.createElement('div');
  toast.style.cssText='position:fixed;top:22px;left:50%;transform:translateX(-50%);background:#f59e0b;color:#000;padding:10px 22px;border-radius:12px;font-weight:700;font-size:13px;z-index:9999';
  toast.textContent=`${labels[type]||type} awarded! +${bonus} pts`;
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(),2800);
}

// saveCaptain moved into renderSubCaptain block
function renderManage(t){
  renderSubUpload(t);
  renderSubScores(t);
  renderSubInjury(t);
  renderSubCaptain(t); // add
  }

// ── Upload More Teams ─────────────────────────────
let uploadState = { parsedTeams:[], suggestions:{}, choices:{}, stage:'idle' };

function renderSubUpload(t) {
  const el = document.getElementById('sub-upload');
  const existing = (t.teams||[]).map(x=>`
    <span style="background:var(--accd);border:1px solid var(--bdra);border-radius:8px;padding:6px 12px;font-size:13px;color:var(--txt);margin:3px;display:inline-block">
      ${escHtml(x.name)} <span class="txt-dim">(${x.players?.length||0})</span>
    </span>
  `).join('');

  el.innerHTML = `
    <div class="dropzone" id="upload-dropzone" onclick="document.getElementById('upload-file').click()"
      ondragover="event.preventDefault();this.classList.add('drag')"
      ondragleave="this.classList.remove('drag')"
      ondrop="event.preventDefault();this.classList.remove('drag');handleUploadDrop(event)">
      <div style="font-size:44px;margin-bottom:12px">📤</div>
      <div class="fw-800 txt-main" style="font-size:18px;margin-bottom:8px">Upload Teams Excel</div>
      <div class="txt-dim fs-13" style="line-height:1.8">
        Drag & drop <strong class="txt-acc">.xlsx</strong> or <span class="txt-acc" style="text-decoration:underline">click to browse</span><br>
        <span class="fs-12">Each sheet tab = one team · Each row = one player</span>
      </div>
      <input type="file" id="upload-file" accept=".xlsx,.xls,.csv" onchange="handleUploadFile(this)"/>
    </div>
    <div id="upload-msg" style="display:none;margin-top:14px"></div>
    ${(t.teams||[]).length?`<div class="card mt-20"><div class="lbl">Existing Teams (${t.teams.length})</div><div style="margin-top:10px">${existing}</div></div>`:''}
  `;
}

function handleUploadFile(input) {
  const file = input.files[0]; input.value='';
  if(file) parseExcelForUpload(file);
}
function handleUploadDrop(e) { if(e.dataTransfer.files[0]) parseExcelForUpload(e.dataTransfer.files[0]); }

function parseExcelForUpload(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const msgEl = document.getElementById('upload-msg');
  if(!['xlsx','xls','csv'].includes(ext)) {
    msgEl.innerHTML='<div class="alert alert-err">❌ Upload .xlsx, .xls or .csv</div>';
    msgEl.style.display='block'; return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result,{type:'binary'});
      const skip=['batsman','bowler','catcher','processed','matchinfo','errorlog','sheet10','rules','points'];
      const hkw=['player','name','team','no','sl','sr','runs','balls','wickets','overs','economy','points'];
      const teams=[];
      wb.SheetNames.forEach(sn=>{
        if(skip.includes(sn.toLowerCase())) return;
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:''});
        const names=[];
        rows.forEach(row=>{for(let cell of row){const v=String(cell||'').trim();if(!v||v.length<2||!/[a-zA-Z]/.test(v)||/^\d+$/.test(v))continue;if(hkw.some(h=>v.toLowerCase()===h))continue;names.push(v);break;}});
        if(names.length>=2) teams.push({name:sn,players:[...new Set(names)]});
      });
      if(!teams.length){ msgEl.innerHTML='<div class="alert alert-err">❌ No teams found.</div>'; msgEl.style.display='block'; return; }
      const sugg={};
      teams.forEach(t=>t.players.forEach(p=>{const m=fuzzySuggest(p);if(!m.find(x=>norm(x.name)===norm(p))&&m.length&&m[0].score<0.98)sugg[p]=m;}));
      uploadState = { parsedTeams:teams, suggestions:sugg, choices:{}, stage: Object.keys(sugg).length?'resolve':'preview' };
      showUploadStage();
    } catch(err) {
      msgEl.innerHTML=`<div class="alert alert-err">❌ ${err.message}</div>`; msgEl.style.display='block';
    }
  };
  reader.readAsBinaryString(file);
}

function showUploadStage() {
  const el = document.getElementById('sub-upload');
  const {stage, parsedTeams, suggestions, choices} = uploadState;

  if(stage==='resolve') {
    const entries = Object.entries(suggestions);
    const allDone = entries.every(([o])=>choices[o]);
    el.innerHTML = `
      <div class="alert alert-warn mb-16"><div class="fw-700">⚠️ ${entries.length} name(s) need confirmation</div></div>
      ${entries.map(([orig,suggs])=>`
        <div class="card mb-14" style="border:1px solid rgba(251,191,36,.25)">
          <div class="mb-8"><span class="txt-dim fs-12">Found: </span><strong class="txt-warn">"${escHtml(orig)}"</strong></div>
          <div class="flex" style="flex-wrap:wrap;gap:8px">
            ${suggs.map(s=>`<button class="name-pill ${choices[orig]===s.name?'selected':''}" onclick="uploadPickName('${escAttr(orig)}','${escAttr(s.name)}')">${escHtml(s.name)} <span style="color:var(--dim);font-size:10px;margin-left:5px">${Math.round(s.score*100)}%</span></button>`).join('')}
            <button class="name-pill keep-orig ${choices[orig]===orig?'selected':''}" onclick="uploadPickName('${escAttr(orig)}','__KEEP__')">Keep "${escHtml(orig)}"</button>
          </div>
        </div>
      `).join('')}
      <div class="flex gap-12">
        <button class="btn btn-success" ${allDone?'':'disabled'} onclick="uploadState.stage='preview';showUploadStage()">Confirm →</button>
        <button class="btn btn-ghost" onclick="uploadState.choices={};uploadState.stage='preview';showUploadStage()">Skip</button>
        <button class="btn btn-ghost" onclick="renderSubUpload(getTournament())">Cancel</button>
      </div>
    `;
  } else if(stage==='preview') {
    el.innerHTML = `
      <div class="fw-700 txt-main mb-16" style="font-size:16px">Preview — ${parsedTeams.length} team(s)</div>
      ${parsedTeams.map(team=>`
        <div class="card mb-14">
          <div class="flex jc-between mb-12"><div class="fw-800 txt-main fs-15">${escHtml(team.name)}</div><span class="badge" style="background:var(--accd);border:1px solid var(--bdra);color:var(--acc)">${team.players.length} players</span></div>
          <div>${team.players.map(p=>{const res=choices[p];const cor=res&&res!==p;return`<span class="ptag ${cor?'corrected':''}">${escHtml(res||p)}${cor?'<span style="font-size:9px"> ✓</span>':''}</span>`;}).join('')}</div>
        </div>
      `).join('')}
      <div class="flex gap-12">
        <button class="btn btn-success" onclick="saveUploadedTeams()">✅ Save Teams</button>
        <button class="btn btn-ghost" onclick="renderSubUpload(getTournament())">Cancel</button>
      </div>
    `;
  }
}

function uploadPickName(orig, chosen) {
  uploadState.choices[orig] = chosen==='__KEEP__' ? orig : chosen;
  showUploadStage();
}

function saveUploadedTeams() {
  const t = getTournament();
  const {parsedTeams, choices} = uploadState;
  const existing = (t.teams||[]).map(x=>norm(x.name));
  const toAdd = parsedTeams
    .filter(team=>!existing.includes(norm(team.name)))
    .map(team=>({
      id:makeId('t'), name:team.name,
      players:team.players.map(p=>({id:makeId('p'),name:choices[p]||p,originalName:p,totalPoints:0,battingPoints:0,bowlingPoints:0,fieldingPoints:0,matchPoints:{},isInjured:false}))
    }));
  const updated = {...t, teams:[...(t.teams||[]),...toAdd]};
  updateTournament(updated);
  uploadState = {parsedTeams:[],suggestions:{},choices:{},stage:'idle'};
  renderSubUpload(updated);
  const msgEl = document.getElementById('upload-msg');
  if(msgEl){ msgEl.innerHTML=`<div class="alert alert-ok">✅ Added ${toAdd.length} team(s)!</div>`; msgEl.style.display='block'; }
}

// ── Fetch Scores ──────────────────────────────────
function renderSubScores(t) {
  const el = document.getElementById('sub-scores');
  const hitsLeft = 100 - getHits();
  const allMatches = t.matches||[];
  const scored     = allMatches.filter(m=>m.isScored||false).length;
  const unscored   = allMatches.filter(m=>!m.isScored && m.status==='completed').length;

  const keyCard = `
    <div class="card mb-14" style="border:1px solid var(--bdra)">
      <div class="lbl" style="margin-bottom:10px">🔑 API Keys <span class="txt-dim fs-11">(stored locally — different keys for diff purposes)</span></div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 12px;align-items:center">
        <span class="fs-12 txt-dim">Series fetch</span>
        <input id="ak-series"    class="inp" style="font-family:monospace;font-size:12px" value="${escHtml(API_KEYS.series)}"    placeholder="Key for series_info"/>
        <span class="fs-12 txt-dim">Scorecards</span>
        <input id="ak-scorecard" class="inp" style="font-family:monospace;font-size:12px" value="${escHtml(API_KEYS.scorecard)}" placeholder="Key for match_scorecard"/>
        <span class="fs-12 txt-dim">Players</span>
        <input id="ak-players"   class="inp" style="font-family:monospace;font-size:12px" value="${escHtml(API_KEYS.players)}"   placeholder="Key for player search"/>
      </div>
      <button class="btn btn-ghost" style="margin-top:10px;font-size:12px" onclick="saveApiKeysFromUI()">💾 Save Keys</button>
      <div class="fs-11 txt-dim" style="margin-top:6px">
        Each key has 100 hits/day. Use separate keys to get 300 total hits.
      </div>
    </div>`;

  el.innerHTML = `
    ${keyCard}

    <!-- ── Section 1: Fetch match list from series ── -->
    <div class="card mb-14">
      <div class="lbl">📋 Step 1 — Fetch Match Schedule</div>
      <div class="txt-dim fs-12" style="margin:8px 0 14px;line-height:1.6">
        Pulls the full match list from CricAPI series_info (<b>1 hit</b>) and stores
        only <b>new matches</b> into the database. Duplicate match IDs are ignored.
        Matches are ordered by match number (1st, 2nd…) then by date for knockouts.
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input id="scores-sid" class="inp flex-1" placeholder="Paste CricAPI Series ID" value="${escHtml(t.seriesId||'')}"/>
        <button class="btn btn-primary" onclick="fetchSeriesMatches()" style="white-space:nowrap">📥 Fetch Schedule</button>
      </div>
      <div class="txt-dim fs-12 mb-8">Quick pick:</div>
      ${[
        ['5978f057-af70-4dcf-b9ee-04831b8df947','ICC T20 WC 2026'],
        ['d5a498c8-7596-4b93-8ab0-e0efc3345312','IPL 2025'],
        ['b31173af-1e08-4359-8a7e-1521b9847e54','NZ Tour India 2026']
      ].map(([id,nm])=>`
        <button class="w100 ta-left" style="background:none;border:1px solid var(--bdr);border-radius:8px;padding:8px 12px;cursor:pointer;font-size:13px;margin-bottom:6px;color:var(--txt)"
          onmouseover="this.style.borderColor='var(--bdra)'" onmouseout="this.style.borderColor='var(--bdr)'"
          onclick="document.getElementById('scores-sid').value='${id}'">
          <b>${nm}</b> <span class="txt-dim fs-11" style="font-family:monospace">${id.slice(0,10)}…</span>
        </button>`).join('')}
    </div>

    <!-- ── Section 2: Score today's matches ── -->
    <div class="card mb-14">
      <div class="lbl">⚡ Step 2 — Score Today's Matches</div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0 14px">
        <div class="fs-12 txt-dim">
          Total matches in DB: <b>${allMatches.length}</b> ·
          Scored: <b style="color:var(--ok)">${scored}</b> ·
          Completed &amp; unscored: <b style="color:var(--warn)">${unscored}</b>
        </div>
        <span class="badge" style="background:${hitsLeft<20?'rgba(248,113,113,.2)':'rgba(52,211,153,.15)'};border:1px solid ${hitsLeft<20?'rgba(248,113,113,.4)':'rgba(52,211,153,.35)'};color:${hitsLeft<20?'var(--err)':'var(--ok)'}">
          ${hitsLeft}/100 hits left today
        </span>
      </div>
      <div class="txt-dim fs-12" style="margin-bottom:14px;line-height:1.6">
        Fetches scorecards for all <b>completed but unscored</b> matches (<b>1 hit each</b>, max 10 per click).
        The nightly cron runs this automatically at 23:50 every night.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-success" onclick="fetchScores()" style="flex:1;min-width:160px">⚡ Sync Scorecards Now</button>
        <button class="btn" onclick="triggerNightlySync()" style="flex:1;min-width:160px;background:var(--surf1)">🌙 Run Nightly Job</button>
      </div>
      <div class="fs-11 txt-dim" style="margin-top:10px">
        🕙 Nightly cron: <code>20 18 * * * php /path/to/api/nightly_sync.php</code> (18:20 UTC = 23:50 IST)
      </div>
    </div>

    <div id="scores-log" class="log-box" style="display:none;margin-top:0"></div>
  `;
}

function addScoreLog(line, color='var(--dim)') {
  const log = document.getElementById('scores-log');
  if(!log) return;
  log.style.display='block';
  const d=document.createElement('div');
  d.style.cssText=`color:${color};margin-bottom:4px`;
  d.textContent=line;
  log.appendChild(d);
  log.scrollTop=log.scrollHeight;
}

// ── Save API keys from UI inputs ──────────────────────────────────────────────
function saveApiKeysFromUI() {
  const s  = document.getElementById('ak-series')?.value.trim();
  const sc = document.getElementById('ak-scorecard')?.value.trim();
  const pl = document.getElementById('ak-players')?.value.trim();
  if(s)  { API_KEYS.series    = s;  localStorage.setItem('cric_key_series',    s);  }
  if(sc) { API_KEYS.scorecard = sc; localStorage.setItem('cric_key_scorecard', sc); }
  if(pl) { API_KEYS.players   = pl; localStorage.setItem('cric_key_players',   pl); }
  // Show toast
  const toast=document.createElement('div');
  toast.style.cssText='position:fixed;top:22px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:10px 22px;border-radius:12px;font-weight:700;font-size:13px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.4)';
  toast.textContent='✅ API keys saved';
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(), 2400);
}

// ── Fetch match schedule from series (Step 1) ─────────────────────────────────
// Calls /api/fetch_series_matches.php — 1 API hit, stores NEW matches only
async function fetchSeriesMatches() {
  const sid = (document.getElementById('scores-sid')?.value||'').trim();
  const log = document.getElementById('scores-log');
  if(log){ log.innerHTML=''; log.style.display='block'; }
  if(!sid){ addScoreLog('⚠️ Enter a Series ID first.','var(--warn)'); return; }

  const t = getTournament();
  if(!t){ addScoreLog('❌ No tournament selected.','var(--err)'); return; }

  addScoreLog('📡 Fetching match schedule from series_info… (1 API hit)');

  try {
    // Prefer server-side endpoint if API available
    const res = await fetch(`${API_BASE}fetch_series_matches.php`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ tournament_id: t.id, series_id: sid, api_key: API_KEYS.series })
    });
    const j = await res.json();
    if(j.status==='success'){
      addScoreLog(`✅ "${j.series_name}" — ${j.total} matches in series`, 'var(--ok)');
      addScoreLog(`📥 New: ${j.new} added · Already in DB: ${j.existing}`, 'var(--acc)');
      if(j.errors?.length) j.errors.forEach(e=>addScoreLog(`⚠️ ${e}`,'var(--warn)'));
      // Also re-load tournament to get the new matches
      await loadTournamentsFromServer();
      renderMatchesList(getTournament());
      renderSubScores(getTournament());
    } else {
      // Fallback: direct CricAPI call (client-side, 1 hit)
      addScoreLog('ℹ️ Server endpoint unavailable — fetching directly…','var(--dim)');
      await fetchSeriesMatchesDirect(sid, t);
    }
  } catch(e) {
    addScoreLog('ℹ️ No server — fetching directly…','var(--dim)');
    await fetchSeriesMatchesDirect(sid, t);
  }
}

// Client-side fallback for fetchSeriesMatches
async function fetchSeriesMatchesDirect(sid, t) {
  let seriesData;
  try {
    seriesData = await cricFetch(`https://api.cricapi.com/v1/series_info?apikey=${API_KEYS.series}&id=${sid}&offset=0`);
    bumpHits(1);
  } catch(e) {
    addScoreLog('❌ '+e.message,'var(--err)'); return;
  }
  if(seriesData?.status!=='success'){
    addScoreLog('❌ '+(seriesData?.reason||'Series not found'),'var(--err)'); return;
  }

  const allMatches = seriesData.data?.matchList || [];
  const seriesName = seriesData.data?.info?.name || sid;
  addScoreLog(`✅ "${seriesName}" — ${allMatches.length} matches found`,'var(--ok)');

  const existingIds = new Set((t.matches||[]).map(m=>m.id));

  // Parse match number from name
  function parseMatchNum(name) {
    const m = name.match(/\b(\d+)(?:st|nd|rd|th)\s+match/i);
    return m ? parseInt(m[1]) : null;
  }

  // Sort: numbered first, then by date
  const sorted = [...allMatches].sort((a,b)=>{
    const na=parseMatchNum(a.name||''), nb=parseMatchNum(b.name||'');
    if(na!=null && nb!=null) return na-nb;
    if(na!=null) return -1; if(nb!=null) return 1;
    return new Date(a.date||0)-new Date(b.date||0);
  });

  let added=0, skipped=0;
  let updated = {...t, matches:[...(t.matches||[])]};

  sorted.forEach(m=>{
    if(!m.id||existingIds.has(m.id)){ skipped++; return; }
    let status='upcoming';
    if(m.matchEnded) status='completed';
    else if(m.matchStarted) status='live';
    updated.matches.push({
      id:m.id, name:m.name, date:m.date, venue:m.venue||'',
      status, result:m.status||'', teamInfo:m.teamInfo||[],
      matchNumber:parseMatchNum(m.name||''), isScored:false
    });
    added++;
  });

  updateTournament(updated);
  renderMatchesList(getTournament());
  renderSubScores(getTournament());
  addScoreLog(`📥 Added ${added} new · Skipped ${skipped} (already in DB)`,'var(--acc)');
}

// ── Trigger nightly sync manually ────────────────────────────────────────────
async function triggerNightlySync() {
  const t = getTournament();
  if(!t){ addScoreLog('❌ No tournament selected.','var(--err)'); return; }
  const log = document.getElementById('scores-log');
  if(log){ log.innerHTML=''; log.style.display='block'; }
  addScoreLog('🌙 Triggering nightly sync…');
  try {
    const res = await fetch(`${API_BASE}nightly_sync.php?secret=cricket_nightly_2026&tournament_id=${t.id}`);
    const j = await res.json();
    if(j.status==='success'){
      addScoreLog(`✅ Scored ${j.matches_scored}/${j.matches_found} matches · Hits used: ${j.api_hits_used}`,'var(--ok)');
      (j.log||[]).forEach(l=>addScoreLog(l,'var(--dim)'));
      await loadTournamentsFromServer();
      renderLeaderboard(getTournament());
      renderMatchesList(getTournament());
    } else {
      addScoreLog('❌ '+(j.reason||'Failed'),'var(--err)');
    }
  } catch(e) {
    addScoreLog('❌ Could not reach nightly_sync.php: '+e.message,'var(--err)');
  }
}

// CORS-safe fetch with multiple proxy fallbacks
async function cricFetch(url) {
  const proxies = [
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];
  try {
    const r = await fetch(url, {mode:'cors'});
    if(r.ok) return await r.json();
  } catch(e) {}
  for(const px of proxies) {
    try {
      const r = await fetch(px(url), {signal: AbortSignal.timeout(8000)});
      if(!r.ok) continue;
      const txt = await r.text();
      try { const j=JSON.parse(txt); if(j.contents) return JSON.parse(j.contents); return j; } catch(e2){}
    } catch(e) {}
  }
  throw new Error('All CORS proxies failed — try a browser CORS extension.');
}

// Cache for player -> country lookups
const PLAYER_COUNTRY_CACHE = {};

// Try to fetch player's country/team from CricAPI (returns empty string if unknown)
async function getPlayerCountry(name) {
  if(!name) return '';
  if(PLAYER_COUNTRY_CACHE[name]) return PLAYER_COUNTRY_CACHE[name];
  try {
    const data = await cricFetch(`https://api.cricapi.com/v1/players?apikey=${API_KEYS.players}&search=${encodeURIComponent(name)}&offset=0`);
    if(data && Array.isArray(data.data) && data.data.length) {
      const p = data.data[0];
      const country = p.country || p.country_name || p.team || p.nationality || p.teamName || p.nationalityName || '';
      PLAYER_COUNTRY_CACHE[name] = country || '';
      return PLAYER_COUNTRY_CACHE[name];
    }
  } catch(e) {
    // ignore and fallback to empty
  }
  PLAYER_COUNTRY_CACHE[name] = '';
  return '';
}

// Lookup helper: try exact, then normalized match in PLAYER_COUNTRY_CACHE
function lookupCountryFromCache(name) {
  if(!name) return '';
  if(PLAYER_COUNTRY_CACHE[name]) return PLAYER_COUNTRY_CACHE[name];
  const nn = norm(name);
  for(const k of Object.keys(PLAYER_COUNTRY_CACHE)){
    if(norm(k) === nn) return PLAYER_COUNTRY_CACHE[k];
  }
  return '';
}

// Load full players list from CricAPI and populate PLAYER_COUNTRY_CACHE (with simple caching)
async function loadPlayersList(force=false) {
  const key = 'cric_players_cache_v1';
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if(cached && !force && (Date.now() - (cached.ts||0) < 1000*60*60*24*7)) {
      Object.assign(PLAYER_COUNTRY_CACHE, cached.data || {});
      return;
    }
  } catch(e) {}

  // Fetch pages of players. Stop when empty page returned or safety cap reached.
  const pageSize = 1000;
  let offset = 0;
  const maxOffset = 50000;
  const accumulated = {};
  while(offset <= maxOffset){
    try{
      const url = `https://api.cricapi.com/v1/players?apikey=${API_KEYS.players}&offset=${offset}`;
      const res = await cricFetch(url);
      if(!res || !Array.isArray(res.data) || res.data.length === 0) break;
      res.data.forEach(p => { if(p && p.name) accumulated[p.name] = p.country || p.country_name || ''; });
      if(res.data.length < pageSize) break;
      offset += pageSize;
    } catch(e){
      break;
    }
  }
  Object.assign(PLAYER_COUNTRY_CACHE, accumulated);
  try{ localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: accumulated })); }catch(e){}
}

// Populate all top-performer country spans asynchronously using the players list first
async function populateTopPerformerCountries() {
  // ensure we have players list cached (non-forced)
  try{ await loadPlayersList(false); }catch(e){}
  const els = Array.from(document.querySelectorAll('.tp-country'));
  els.forEach(async el => {
    const name = el.dataset.playerName;
    if(!name) return;
    let country = lookupCountryFromCache(name);
    if(!country) {
      // fallback to search-by-name API
      try { country = await getPlayerCountry(name); } catch(e) { country = ''; }
    }
    el.textContent = country || '';
  });
}

async function fetchScores() {

  const sid = (document.getElementById('scores-sid')?.value || '').trim();
  const log = document.getElementById('scores-log');

  if(log){
    log.innerHTML='';
    log.style.display='block';
  }

  const t = getTournament();
  if(!t){
    addScoreLog('❌ No tournament selected.','var(--err)');
    return;
  }

  if(!Array.isArray(t.matches)){
    t.matches=[];
  }

  if(getHits() >= 95){
    addScoreLog('❌ API limit near (95+). Try tomorrow.','var(--err)');
    return;
  }

  if(!sid){
    addScoreLog('⚠️ Enter a Series ID.','var(--warn)');
    return;
  }

  const alreadyDone = new Set((t.matches||[]).map(m=>m.id));

  // ───── STEP 1: SERIES INFO ─────

  addScoreLog('📡 Fetching series info... (1 API hit)');

  let seriesData;

  try{

    seriesData = await cricFetch(
      `https://api.cricapi.com/v1/series_info?apikey=${API_KEYS.series}&id=${sid}&offset=0`
    );

    bumpHits(1);

  }catch(err){
    addScoreLog('❌ '+err.message,'var(--err)');
    return;
  }

  if(seriesData?.status!=='success'){
    addScoreLog('❌ '+(seriesData?.reason||'Series not found'),'var(--err)');
    return;
  }

  const allMatches = seriesData.data?.matchList || [];
  const seriesName = seriesData.data?.info?.name || sid;

  addScoreLog(`✅ "${seriesName}" — ${allMatches.length} matches found`,'var(--ok)');

  let updated = {
    ...t,
    teams:(t.teams||[]).map(x=>({...x,players:[...(x.players||[])]}))
  };

  // ───── MATCH STATUS COUNTERS ─────

  let upcoming = 0;
  let live = 0;
  let completed = 0;

  allMatches.forEach(m=>{
    if(m.matchEnded) completed++;
    else if(m.matchStarted) live++;
    else upcoming++;
  });

  addScoreLog(`📅 Upcoming: ${upcoming} · 🔴 Live: ${live} · ✅ Finished: ${completed}`,'var(--dim)');

  // ───── RECORD COMPLETED MATCH META ─────

  let metaAdded=0;

  allMatches.forEach(m=>{

if(alreadyDone.has(m.id)) return;

let status = "upcoming";

if(m.matchEnded) status = "completed";
else if(m.matchStarted) status = "live";

updated.matches.push({
  id: m.id,
  name: m.name,
  date: m.date,
  venue: m.venue || "",
  status: status,
  result: m.status || "",
  teamInfo: m.teamInfo || [],
  teams: m.teams || []
});

});

  if(metaAdded){
    addScoreLog(`📋 ${metaAdded} completed match results recorded`,'var(--acc)');
  }

  // ───── FIND MATCHES THAT NEED SCORING ─────

  const scoredMatchIds = new Set(
    (t.teams||[]).flatMap(tm=>
      (tm.players||[]).flatMap(p=>Object.keys(p.matchPoints||{}))
    )
  );

  const needScoring = allMatches.filter(m=>{

    if(scoredMatchIds.has(m.id)) return false;

    if(!m.matchEnded) return false;

    return true;

  }).sort((a,b)=>new Date(b.date)-new Date(a.date));

  // ───── NO MATCHES READY ─────

  if(!needScoring.length){

    if(completed===0){
      addScoreLog('ℹ️ No matches finished yet. Scores will appear after matches end.','var(--dim)');
    }else{
      addScoreLog('✅ All completed matches already scored.','var(--ok)');
    }

    updateTournament(updated);
    renderLeaderboard(getTournament());
    renderMatchesList(getTournament());

    return;
  }

  // ───── LIMIT API HITS ─────

  const remaining = Math.min(94-getHits(),10);

  const toScore = needScoring.slice(0,remaining);

  const skipped = needScoring.length - toScore.length;

  addScoreLog(`🏏 Scoring ${toScore.length} completed match(es)`,'var(--acc)');

  // ───── FETCH SCORECARDS ─────

  let scorecardHits=0;

  for(const match of toScore){

    if(getHits()>=94){
      addScoreLog('⚠️ Hit limit close — stopping.','var(--warn)');
      break;
    }

    const label = match.name.split(',')[0];

    addScoreLog(`⬇️ ${label}...`);

    try{

      const sc = await cricFetch(
        `https://api.cricapi.com/v1/match_scorecard?apikey=${API_KEYS.scorecard}&id=${match.id}`
      );

      scorecardHits++;
      bumpHits(1);

      if(sc?.status==='success' && sc.data){

        const ptsBefore = updated.teams.flatMap(t=>t.players)
          .reduce((s,p)=>s+(p.totalPoints||0),0);

        const normalized = normalizeScorecard(sc.data);

        updated = applyMatch(updated,match,normalized);

        const ptsAfter = updated.teams.flatMap(t=>t.players)
          .reduce((s,p)=>s+(p.totalPoints||0),0);

        const newPts = ptsAfter-ptsBefore;

        const innings = normalized.innings||[];

        if(!innings.length){

          addScoreLog('⚠️ Scorecard exists but innings not ready yet','var(--warn)');

        }else{

          const batRows = innings.reduce((s,i)=>s+(i.batting||[]).length,0);
          const bowlRows = innings.reduce((s,i)=>s+(i.bowling||[]).length,0);
          const fieldRows = innings.reduce((s,i)=>s+(i.catching||[]).length,0);

          addScoreLog(
            `✅ ${innings.length} innings · ${batRows} bat · ${bowlRows} bowl · ${fieldRows} field · +${newPts} pts`,
            'var(--ok)'
          );

        }

      }

    }catch(e){

      scorecardHits++;
      bumpHits(1);

      addScoreLog(`❌ ${e.message}`,'var(--err)');

    }

  }

  // ───── UPDATE UI ─────

  updateTournament(updated);

  renderLeaderboard(getTournament());
  renderMatchesList(getTournament());

  const totalHits = 1 + scorecardHits;

  addScoreLog(`✅ Sync finished · Hits used: ${totalHits} · Today: ${getHits()}/100`,'var(--ok)');

  if(skipped>0){
    addScoreLog(`ℹ️ Sync again to score ${skipped} remaining match(es)`,'var(--dim)');
  }

}

function recordMatchOnly(tournament, matchInfo) {
  if((tournament.matches||[]).find(m => m.id === matchInfo.id)) return tournament;
  return {
    ...tournament,
    matches: [...(tournament.matches||[]), {
      id:       matchInfo.id,
      name:     matchInfo.name,
      date:     matchInfo.date,
      venue:    matchInfo.venue || '',
      status:   'completed',
      result:   matchInfo.status || '',
      teamInfo: matchInfo.teamInfo || []
    }]
  };
}

// ✅ Keep this OUTSIDE (important)
function isSamePlayer(a, b){
  if(!a || !b) return false;

  const na = norm(a);
  const nb = norm(b);

  if(na === nb) return true;

  const la = na.split(' ').pop();
  const lb = nb.split(' ').pop();

  if(la === lb) return true;

  if(na[0] === nb[0] && la === lb) return true;

  if(na.includes(nb) || nb.includes(na)) return true;

  return false;
}

function applyMatch(tournament, matchInfo, scorecard) {
  const mid = matchInfo.id;

  const updatedTeams = (tournament.teams || []).map(team => ({
    ...team,
    players: (team.players || []).map(player => {

      if(player.isInjured) return player;

      let bat = 0, bowl = 0, field = 0;
      let foundBat = false, foundBowl = false;
      let cricketTeam = player.cricketTeam || '';

      (scorecard.innings || []).forEach(inn => {

        const innTeam = (inn.inning || '')
          .replace(/\s*(\d+\w*)?\s*(inning|innings).*/i,'')
          .trim();

        // ── BATTING ─────────────────────────────────────
        (inn.batting || []).forEach(b => {

          const rawName = b.batsman?.name || b.name || '';
          if(!isSamePlayer(player.name, rawName)) return;

          foundBat = true;

          if(!cricketTeam && innTeam) cricketTeam = innTeam;

          const runs  = +(b.r  ?? b.runs  ?? 0);
          const balls = +(b.b  ?? b.balls ?? 0);
          const fours = +(b['4s'] ?? b.fours ?? 0);
          const sixes = +(b['6s'] ?? b.sixes ?? 0);

          const sr = b.sr
            ? parseFloat(b.sr)
            : (balls > 0 ? (runs / balls) * 100 : 0);

          const duck = runs === 0 && balls > 0;

          const notOut = ((b.dismissal || '') + (b['dismissal-text'] || ''))
            .toLowerCase()
            .includes('not out');

          bat += calcBat(runs, balls, fours, sixes, sr, duck, notOut);
        });

        // ── BOWLING ─────────────────────────────────────
        (inn.bowling || []).forEach(bw => {

          const rawName = bw.bowler?.name || bw.name || '';
          if(!isSamePlayer(player.name, rawName)) return;

          foundBowl = true;

          const wkts   = +(bw.w ?? bw.wickets ?? 0);
          const maiden = +(bw.m ?? bw.maidens ?? 0);
          const runs_g = +(bw.r ?? bw.runs ?? 0);

          const oversStr = String(bw.o ?? bw.overs ?? '0');
          const oversDec = parseOvers(oversStr);

          const eco = bw.eco
            ? parseFloat(bw.eco)
            : (oversDec > 0 ? runs_g / oversDec : 0);

          bowl += calcBowl(wkts, maiden, runs_g, oversDec, eco);
        });

        // ── FIELDING ────────────────────────────────────
        (inn.catching || []).forEach(c => {

          const rawName = c.catcher?.name || c.name || '';
          if(!isSamePlayer(player.name, rawName)) return;

          const catches   = +(c.catch   || 0);
          const runouts   = +(c.runout  || 0);
          const stumpings = +(c.stumped || 0);

          field += catches * 10;
          field += runouts * 10;
          field += stumpings * 15;
        });

      });

      const mp = { batting: bat, bowling: bowl, fielding: field };

      return {
        ...player,
        cricketTeam,
        matchPoints:    { ...(player.matchPoints || {}), [mid]: mp },
        battingPoints:  (player.battingPoints  || 0) + bat,
        bowlingPoints:  (player.bowlingPoints  || 0) + bowl,
        fieldingPoints: (player.fieldingPoints || 0) + field,
        totalPoints:    (player.totalPoints    || 0) + bat + bowl + field,
      };
    })
  }));

  // ── MATCH UPDATE ─────────────────────────────────────
  const newMatches = (tournament.matches || []).some(m => m.id === mid)
    ? tournament.matches.map(m =>
        m.id === mid
          ? {
              ...m,
              status: 'completed',
              result: matchInfo.status,
              teamInfo: matchInfo.teamInfo || m.teamInfo || [],
              isScored: true   // ✅ IMPORTANT
            }
          : m
      )
    : [
        ...(tournament.matches || []),
        {
          id: mid,
          name: matchInfo.name,
          date: matchInfo.date,
          venue: matchInfo.venue || '',
          status: 'completed',
          result: matchInfo.status,
          teamInfo: matchInfo.teamInfo || [],
          isScored: true
        }
      ];

  return {
    ...tournament,
    teams: updatedTeams,
    matches: newMatches
  };
}
// Convert CricAPI overs string "3.4" (3 overs, 4 balls) to decimal (3.667)
function parseOvers(oversStr) {
  const parts = String(oversStr||'0').split('.');
  const fullOvers = parseInt(parts[0]) || 0;
  const balls     = parseInt(parts[1]) || 0;
  return fullOvers + (balls / 6);
}

function calcBat(runs, balls, fours, sixes, sr, duck, notOut=false) {
  // Exactly matches GAS sheet formulas:
  // J  = duck (faced ball, 0 runs) → -10, else runs * 1  (1pt/run)
  // K  = cumulative milestones: +25 at each of 25,50,75,100,125,150,175,200 crossed
  // L  = SR bonus/penalty (GAS formula exactly, using API-provided SR)
  // M  = L if balls >= 25, else 0   (GAS: IF(balls>=25, L, 0))
  // N  = fours * 1
  // O  = sixes * 2
  // Total = J + K + M + N + O

  // J — base
  const J = duck ? -10 : runs;

  // K — cumulative milestone bonus
  let K = 0;
  for(const t of [25,50,75,100,125,150,175,200]) { if(runs >= t) K += 25; }

  // L — SR bonus/penalty decoded from GAS:
  // IF(SR<75,-20,0)+IF(SR<100,-10,0)+IF(SR<=125,-10,0)+IF(SR<=150,0)
  // +IF(SR>=150,10)+IF(SR>=175,10)+IF(SR>=200,20)+IF(SR>=250,20)
  // +IF(SR>=300,20)+IF(SR>=350,20)+IF(SR>=400,20)
  let L = 0;
  if(sr < 75)  L += -20;
  if(sr < 100) L += -10;
  if(sr <= 125) L += -10;
  // 126-149: no change
  if(sr >= 150) L += 10;
  if(sr >= 175) L += 10;
  if(sr >= 200) L += 20;
  if(sr >= 250) L += 20;
  if(sr == 300 && sr<=350) L += 80;
  
  if(sr > 350) L += 100;

  // M — SR bonus only if 25+ balls faced
  const M = balls >= 25 ? L : 0;

  // N, O — boundaries
  const N = fours * 1;
  const O = sixes * 2;

  return J + K + M + N + O;
}

function calcBowl(wkts, maidens, runs, oversDec, eco) {

let pts = 0;

// Wickets
pts += wkts * 25;

// Wicket haul bonus
if(wkts >= 8) pts += 175;
else if(wkts == 7) pts += 150;
else if(wkts == 6) pts += 125;
else if(wkts == 5) pts += 100;
else if(wkts == 4) pts += 75;
else if(wkts == 3) pts += 50;

// Maiden overs
pts += maidens * 40;

// Economy (min 2 overs)
if(oversDec >= 2){

  if(eco < 1) pts += 100;
  else if(eco < 2) pts += 80;
  else if(eco < 4) pts += 40;
  else if(eco < 6) pts += 20;
  else if(eco < 8) pts += 10;
  else if(eco <= 10) pts += 0;
  if(eco > 16) pts -= 60;
else if(eco > 14) pts -= 40;
else if(eco > 12) pts -= 20;
else if(eco > 10) pts -= 10;

}

return pts;

}
// ── Injury Panel ──────────────────────────────────
function renderSubInjury(t) {
  const el = document.getElementById('sub-injury');
  el.innerHTML = `
    <div class="card">
      <div class="lbl">🩹 Injury Replacement</div>
      <div class="txt-dim fs-13" style="margin:10px 0 20px;line-height:1.7">Mark a player injured and add a replacement. All points transfer automatically.</div>
      <div id="injury-msg" style="display:none;margin-bottom:14px"></div>
      <div class="flex flex-col gap-14">
        <div>
          <div class="lbl">Team</div>
          <select class="inp" id="inj-team" onchange="updateInjuryPlayers()">
            <option value="">— Select team —</option>
            ${(t.teams||[]).map(tm=>`<option value="${tm.id}">${escHtml(tm.name)}</option>`).join('')}
          </select>
        </div>
        <div id="inj-player-block" style="display:none">
          <div class="lbl">Injured Player</div>
          <select class="inp" id="inj-player"><option value="">— Select player —</option></select>
        </div>
        <div id="inj-rep-block" style="display:none">
          <div class="lbl">Replacement Player Name</div>
          <input class="inp" id="inj-rep" placeholder="Type replacement player's full name"/>
        </div>
        <button class="btn btn-danger" id="inj-submit-btn" style="display:none" onclick="processInjury()">⚡ Process Replacement</button>
      </div>
      ${buildCurrentInjuries(t)}
    </div>
  `;
}

function updateInjuryPlayers() {
  const teamId = document.getElementById('inj-team')?.value;
  const t = getTournament();
  const team = (t?.teams||[]).find(x=>x.id===teamId);
  const pb = document.getElementById('inj-player-block');
  const rb = document.getElementById('inj-rep-block');
  const sb = document.getElementById('inj-submit-btn');
  if(!team){ if(pb)pb.style.display='none'; if(rb)rb.style.display='none'; if(sb)sb.style.display='none'; return; }
  const ps = document.getElementById('inj-player');
  ps.innerHTML = '<option value="">— Select player —</option>' +
    (team.players||[]).filter(p=>!p.isInjured).map(p=>`<option value="${p.id}">${escHtml(p.name)} (${p.totalPoints||0} pts)</option>`).join('');
  if(pb)pb.style.display='block';
  if(rb)rb.style.display='block';
  if(sb)sb.style.display='block';
}

function buildCurrentInjuries(t) {
  const injured = (t.teams||[]).flatMap(tm=>(tm.players||[]).filter(p=>p.isInjured).map(p=>({...p,teamName:tm.name})));
  if(!injured.length) return '';
  return `<div style="margin-top:24px"><div class="lbl">Current Injuries</div><div style="margin-top:10px">${
    injured.map(p=>`<div class="flex jc-between" style="padding:8px 0;border-bottom:1px solid var(--bdr)"><div><span style="color:var(--err)">🩹 ${escHtml(p.name)}</span><span class="txt-dim fs-12" style="margin-left:8px">${escHtml(p.teamName)}</span></div><span class="badge" style="background:rgba(248,113,113,.15);border:1px solid rgba(248,113,113,.35);color:var(--err)">injured</span></div>`).join('')
  }</div></div>`;
}

function normalizeScorecard(apiData){
  // GAS confirmed: API returns data.scorecard[]
  // Each item has: inning (e.g. "India Inning 1"), batting[], bowling[], catching[]
  const src = apiData.scorecard || apiData.innings || [];
  return {
    ...apiData,
    innings: src.map(sc => ({
      inning:   sc.inning  || sc.team || '',
      batting:  sc.batting  || [],
      bowling:  sc.bowling  || [],
      catching: sc.catching || []
    }))
  };
}
function processInjury() {
  const teamId = document.getElementById('inj-team')?.value;
  const playerId = document.getElementById('inj-player')?.value;
  const repName = (document.getElementById('inj-rep')?.value||'').trim();
  const msgEl = document.getElementById('injury-msg');

  if(!teamId||!playerId||!repName){ if(msgEl){msgEl.innerHTML='<div class="alert alert-err">Fill all fields.</div>';msgEl.style.display='block';} return; }
  const t = getTournament();
  const team = (t.teams||[]).find(x=>x.id===teamId);
  const injured = (team?.players||[]).find(p=>p.id===playerId);
  if(!injured) return;

  const rep = {id:makeId('rep'),name:repName,originalName:repName,totalPoints:injured.totalPoints||0,battingPoints:injured.battingPoints||0,bowlingPoints:injured.bowlingPoints||0,fieldingPoints:injured.fieldingPoints||0,matchPoints:{...(injured.matchPoints||{})},isInjured:false,replacedFor:injured.name};
  const newTeams = (t.teams||[]).map(tm=>{
    if(tm.id!==teamId) return tm;
    return {...tm, players:[...tm.players.map(p=>p.id===playerId?{...p,isInjured:true}:p), rep]};
  });
  updateTournament({...t, teams:newTeams});
  if(msgEl){msgEl.innerHTML=`<div class="alert alert-ok">✅ ${escHtml(injured.name)} → ${escHtml(repName)}. ${injured.totalPoints||0} pts transferred.</div>`;msgEl.style.display='block';}
  renderSubInjury(getTournament());
}

// ═══════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════
function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s){ return String(s||'').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }
function escId(s){ return String(s||'').replace(/[^a-zA-Z0-9]/g,'_'); }

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
document.getElementById('page-login').classList.add('active');

// On load, attempt to fetch tournaments from server
loadTournamentsFromServer().then(()=>{
  // render current page if needed
  if(state.page === 'user-home') renderUserHome();
  if(state.page === 'admin-home') renderAdminHome();
});
