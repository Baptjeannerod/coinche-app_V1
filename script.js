(() => {
  'use strict';

  /*** ---------- Utilities ---------- ***/
  const KEY = 'coinche_v1';
  const VERSION = '1.0.0';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const nowISO = () => new Date().toISOString();
  const todayISODate = () => new Date().toISOString().slice(0, 10);

  const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const slugify = (s) => normalize(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const shortId = () => Math.random().toString(36).slice(2, 6);
  const playerIdFromName = (name) => `${slugify(name)}-${shortId()}`;

  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const fmtEUR = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
  const qCSV = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;

  const toast = (msg, ms = 1600) => {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), ms);
  };

  /*** ---------- State ---------- ***/
  const defaultState = () => ({
    version: VERSION,
    settings: { theme: 'auto', euroPerLoss: 5 },
    players: [],
    sessions: []
  });

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      if (!data.version) data.version = VERSION;
      if (!data.settings) data.settings = { theme: 'auto', euroPerLoss: 5 };
      if (!('euroPerLoss' in data.settings)) data.settings.euroPerLoss = 5;
      data.players ??= [];
      data.sessions ??= [];
      return data;
    } catch {
      return defaultState();
    }
  }
  function saveState() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  /*** ---------- Theme ---------- ***/
  const themeSelect = $('#themeSelect');
  function applyTheme() {
    const val = state.settings.theme || 'auto';
    document.documentElement.setAttribute('data-theme', val);
  }
  themeSelect.addEventListener('change', () => {
    state.settings.theme = themeSelect.value;
    saveState();
    applyTheme();
  });

  /*** ---------- Players ---------- ***/
  const playerNameInput = $('#playerName');
  const addPlayerBtn = $('#addPlayerBtn');
  const playersList = $('#playersList');
  const resetPlayersBtn = $('#resetPlayersBtn');

  function addPlayer(name) {
    name = name.trim();
    if (!name) return toast('Nom vide');
    const exists = state.players.some(p => normalize(p.name).toLowerCase() === normalize(name).toLowerCase());
    if (exists) return toast('Nom déjà utilisé');
    const p = { id: playerIdFromName(name), name, createdAt: nowISO() };
    state.players.push(p);
    state.players.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    saveState();
    renderPlayers();
    renderAttendanceGrid();
    toast(`Ajouté : ${name}`);
  }

  function renamePlayer(id, newName) {
    newName = newName.trim();
    if (!newName) return toast('Nom vide');
    const exists = state.players.some(p => normalize(p.name).toLowerCase() === normalize(newName).toLowerCase() && p.id !== id);
    if (exists) return toast('Nom déjà utilisé');
    const p = state.players.find(p => p.id === id);
    if (!p) return;
    p.name = newName;
    saveState();
    renderPlayers();
    renderAttendanceGrid();
    renderAll();
  }

  function deletePlayer(id) {
    if (!confirm('Supprimer ce joueur ?')) return;
    state.players = state.players.filter(p => p.id !== id);
    // Propagation: retirer de présences, tables
    for (const s of state.sessions) {
      s.attendance = s.attendance.filter(pid => pid !== id);
      for (const r of s.rounds ?? []) {
        for (const t of r.tables ?? []) {
          t.A = t.A.filter(pid => pid !== id);
          t.B = t.B.filter(pid => pid !== id);
        }
      }
    }
    saveState();
    renderPlayers();
    renderAttendanceGrid();
    renderRounds();
    renderStats();
    toast('Joueur supprimé');
  }

  function renderPlayers() {
    playersList.innerHTML = '';
    for (const p of state.players) {
      const li = document.createElement('li');
      li.className = 'player-item';
      li.innerHTML = `
        <div class="player-name">${p.name}</div>
        <div class="player-actions">
          <button class="btn outline btn-rename" data-id="${p.id}" aria-label="Renommer ${p.name}">Renommer</button>
        </div>
        <div class="player-actions">
          <button class="btn danger outline btn-delete" data-id="${p.id}" aria-label="Supprimer ${p.name}">Supprimer</button>
        </div>
      `;
      playersList.appendChild(li);
    }
    playersList.addEventListener('click', handlePlayersClick, { once: true });
  }

  function handlePlayersClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains('btn-rename')) {
      const p = state.players.find(x => x.id === id);
      const nn = prompt('Nouveau nom', p?.name || '');
      if (nn != null) renamePlayer(id, nn);
    } else if (btn.classList.contains('btn-delete')) {
      deletePlayer(id);
    }
    playersList.addEventListener('click', handlePlayersClick, { once: true });
  }

  addPlayerBtn.addEventListener('click', () => {
    addPlayer(playerNameInput.value);
    playerNameInput.value = '';
    playerNameInput.blur();
  });
  playerNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayerBtn.click(); });
  resetPlayersBtn.addEventListener('click', () => {
    if (!confirm('Réinitialiser la liste des joueurs ?')) return;
    state.players = [];
    // vider présences de toutes les sessions
    for (const s of state.sessions) s.attendance = [];
    saveState();
    renderPlayers();
    renderAttendanceGrid();
    renderRounds();
    renderStats();
  });

  /*** ---------- Sessions & Attendance ---------- ***/
  const sessionDateInput = $('#sessionDate');
  const createSessionBtn = $('#createSessionBtn');
  const exportCsvBtn = $('#exportCsvBtn');
  const attendanceGrid = $('#attendanceGrid');
  const sessionsHistory = $('#sessionsHistory');

  function ensureSessionFields(s) {
    s.rounds ??= [];
    s.attendance ??= [];
    s.waitlist ??= [];
  }

  function createSession(dateISO) {
    const s = {
      id: `S-${Date.parse(dateISO || todayISODate())}`,
      date: dateISO || todayISODate(),
      attendance: [],
      waitlist: [],
      rounds: []
    };
    state.sessions.push(s);
    saveState();
    renderSessionsHistory();
    renderAttendanceGrid();
    renderRounds();
    toast('Session créée');
  }

  function activeSession() {
    if (state.sessions.length === 0) return null;
    return state.sessions[state.sessions.length - 1];
  }

  function renderSessionsHistory() {
    sessionsHistory.innerHTML = '';
    if (state.sessions.length === 0) return;
    const span = document.createElement('div');
    span.innerHTML = `<strong>Sessions :</strong> ` + state.sessions.map(s => `<span class="tag">${s.date}</span>`).join(' ');
    sessionsHistory.appendChild(span);
  }

  function renderAttendanceGrid() {
    attendanceGrid.innerHTML = '';
    const s = activeSession();
    if (!s) return;
    ensureSessionFields(s);
    for (const p of state.players) {
      const id = `att-${p.id}`;
      const wrap = document.createElement('label');
      wrap.className = 'chip';
      wrap.setAttribute('for', id);
      wrap.innerHTML = `
        <span>${p.name}</span>
        <input id="${id}" type="checkbox" ${s.attendance.includes(p.id) ? 'checked' : ''} data-id="${p.id}" aria-label="Présent ${p.name}" />
      `;
      attendanceGrid.appendChild(wrap);
    }
    attendanceGrid.onchange = (e) => {
      const cb = e.target;
      if (!(cb instanceof HTMLInputElement)) return;
      const pid = cb.dataset.id;
      const s2 = activeSession();
      if (!s2) return;
      if (cb.checked) {
        if (!s2.attendance.includes(pid)) s2.attendance.push(pid);
      } else {
        s2.attendance = s2.attendance.filter(x => x !== pid);
        // si dans waitlist, retirer
        s2.waitlist = s2.waitlist.filter(x => x !== pid);
      }
      saveState();
      updateRoundButtonsState();
      renderWaitlist();
    };
    updateRoundButtonsState();
    renderWaitlist();
  }

  sessionDateInput.value = todayISODate();
  createSessionBtn.addEventListener('click', () => createSession(sessionDateInput.value));
  exportCsvBtn.addEventListener('click', exportCSV);

  /*** ---------- Rounds / Pairings ---------- ***/
  const createRoundBtn = $('#createRoundBtn');
  const undoRoundBtn = $('#undoRoundBtn');
  const roundsList = $('#roundsList');
  const waitlistInfo = $('#waitlistInfo');

  function updateRoundButtonsState() {
    const s = activeSession();
    if (!s) {
      createRoundBtn.disabled = true;
      undoRoundBtn.disabled = true;
      return;
    }
    const present = (s.attendance || []).filter(id => state.players.some(p => p.id === id));
    createRoundBtn.disabled = present.length < 4;
    undoRoundBtn.disabled = (s.rounds || []).length === 0;
  }

  function renderWaitlist() {
    const s = activeSession();
    if (!s) { waitlistInfo.hidden = true; return; }
    const names = s.waitlist.filter(id => s.attendance.includes(id)).map(id => playerName(id));
    if (names.length === 0) {
      waitlistInfo.hidden = true;
    } else {
      waitlistInfo.hidden = false;
      waitlistInfo.textContent = `En attente (prioritaires prochain round) : ${names.join(', ')}`;
    }
  }

  function playerName(id) {
    return state.players.find(p => p.id === id)?.name ?? '??';
  }

  function createRound() {
    const s = activeSession();
    if (!s) return;
    ensureSessionFields(s);

    // Build pool: waitlist first (shuffled), then others (shuffled)
    const present = s.attendance.filter(pid => state.players.some(p => p.id === pid));
    if (present.length < 4) return toast('Au moins 4 présents requis');

    const wait = s.waitlist.filter(pid => present.includes(pid));
    const others = present.filter(pid => !wait.includes(pid));
    const pool = [...shuffle(wait.slice()), ...shuffle(others.slice())];

    const tables = [];
    while (pool.length >= 4) {
      const four = pool.splice(0, 4);
      const mix = shuffle(four.slice());
      const A = mix.slice(0, 2);
      const B = mix.slice(2, 4);
      tables.push({ A, B, scoreA: null, scoreB: null, winner: null, loserPaysPerPlayer: state.settings.euroPerLoss, losersChargedAt: null, notes: '' });
    }
    const leftover = pool.slice();

    const round = {
      id: `R-${Date.now()}`,
      createdAt: nowISO(),
      tables,
      // Garder l'historique d'attente pour annuler proprement
      waitlistBefore: s.waitlist.slice(),
      waitlistAfter: leftover.slice()
    };
    s.rounds.push(round);
    s.waitlist = leftover;
    saveState();
    renderRounds();
    renderStats();
    toast(`Round #${s.rounds.length} créé`);
  }

  function undoRound() {
    const s = activeSession();
    if (!s || s.rounds.length === 0) return;
    if (!confirm('Annuler le dernier round ?')) return;
    const r = s.rounds.pop();
    // Restaurer la waitlist précédente si connue
    if (r && Array.isArray(r.waitlistBefore)) {
      s.waitlist = r.waitlistBefore.filter(pid => s.attendance.includes(pid));
    } else {
      s.waitlist = [];
    }
    saveState();
    renderRounds();
    renderStats();
    toast('Dernier round annulé');
  }

  function renderRounds() {
    roundsList.innerHTML = '';
    const s = activeSession();
    if (!s || !s.rounds?.length) { updateRoundButtonsState(); renderWaitlist(); return; }

    s.rounds.forEach((r, idx) => {
      const card = document.createElement('div');
      card.className = 'round-card';
      card.innerHTML = `<h4>Round ${idx + 1}</h4>`;
      r.tables.forEach((t, ti) => {
        const tc = document.createElement('div');
        tc.className = 'table-card';
        tc.dataset.roundId = r.id;
        tc.dataset.tableIndex = String(ti);
        tc.innerHTML = `
          <div class="teams">
            <div class="team">
              <h5>Équipe A</h5>
              <div class="names">${t.A.map(playerName).join(' & ')}</div>
            </div>
            <div class="team">
              <h5>Équipe B</h5>
              <div class="names">${t.B.map(playerName).join(' & ')}</div>
            </div>
          </div>
          <div class="scores">
            <div class="score-input">
              <label>Score A</label>
              <input type="number" inputmode="numeric" pattern="[0-9]*" class="scoreA" value="${t.scoreA ?? ''}" aria-label="Score A table ${ti+1}" />
            </div>
            <div class="score-input">
              <label>Score B</label>
              <input type="number" inputmode="numeric" pattern="[0-9]*" class="scoreB" value="${t.scoreB ?? ''}" aria-label="Score B table ${ti+1}" />
            </div>
          </div>
          <div class="winbar">
            <button class="btn winA ${t.winner === 'A' ? 'active' : ''}">Victoire A</button>
            <button class="btn winB ${t.winner === 'B' ? 'active' : ''}">Victoire B</button>
          </div>
        `;
        roundsList.appendChild(card).appendChild(tc);
      });
    });

    roundsList.oninput = handleScoreInput;
    roundsList.onclick = handleWinClick;
    updateRoundButtonsState();
    renderWaitlist();
    updatePotBadge();
  }

  function locateTable(target) {
    const tableCard = target.closest('.table-card');
    if (!tableCard) return {};
    const roundId = tableCard.dataset.roundId;
    const tableIndex = Number(tableCard.dataset.tableIndex);
    const s = activeSession();
    if (!s) return {};
    const r = s.rounds.find(x => x.id === roundId);
    const t = r?.tables?.[tableIndex];
    return { s, r, t, tableCard };
  }

  function handleScoreInput(e) {
    const { r, t } = locateTable(e.target);
    if (!r || !t) return;
    if (e.target.classList.contains('scoreA')) {
      const v = e.target.value.trim();
      t.scoreA = v === '' ? null : parseInt(v, 10);
    } else if (e.target.classList.contains('scoreB')) {
      const v = e.target.value.trim();
      t.scoreB = v === '' ? null : parseInt(v, 10);
    }
    saveState();
  }

  function handleWinClick(e) {
    const btn = e.target.closest('.winA, .winB');
    if (!btn) return;
    const { r, t, tableCard } = locateTable(btn);
    if (!r || !t) return;
    const was = t.winner;
    const set = btn.classList.contains('winA') ? 'A' : 'B';
    t.winner = was === set ? null : set;
    if (t.winner) {
      if (!t.losersChargedAt) t.losersChargedAt = nowISO();
      t.loserPaysPerPlayer ??= state.settings.euroPerLoss;
    } else {
      t.losersChargedAt = null;
    }
    // Toggle UI
    tableCard.querySelector('.winA').classList.toggle('active', t.winner === 'A');
    tableCard.querySelector('.winB').classList.toggle('active', t.winner === 'B');
    saveState();
    updatePotBadge();
    renderStats();
  }

  function updatePotBadge() {
    const euros = totalPot();
    $('#potBadge').textContent = fmtEUR(euros);
  }

  function totalPot() {
    let sum = 0;
    for (const s of state.sessions) {
      for (const r of s.rounds ?? []) {
        for (const t of r.tables ?? []) {
          if (!t.winner) continue;
          const losers = t[t.winner === 'A' ? 'B' : 'A'] ?? [];
          sum += (t.loserPaysPerPlayer ?? state.settings.euroPerLoss) * losers.length;
        }
      }
    }
    return sum;
  }

  createRoundBtn.addEventListener('click', createRound);
  undoRoundBtn.addEventListener('click', undoRound);

  /*** ---------- Stats ---------- ***/
  const recalcStatsBtn = $('#recalcStatsBtn');
  const statsTableBody = $('#statsTable tbody');
  const rankingSort = $('#rankingSort');
  const euroPerLossInput = $('#euroPerLoss');
  const advancedStatsBox = $('#advancedStats');

  euroPerLossInput.value = state.settings.euroPerLoss;
  euroPerLossInput.addEventListener('change', () => {
    const v = parseInt(euroPerLossInput.value, 10);
    state.settings.euroPerLoss = isNaN(v) ? 5 : Math.max(0, v);
    // N'affecte pas l'historique : seules nouvelles tables stockeront la valeur actuelle
    saveState();
    renderStats();
  });

  rankingSort.addEventListener('change', renderStats);
  recalcStatsBtn.addEventListener('click', renderStats);

  function computeStats() {
    const map = new Map(); // id -> stats
    for (const p of state.players) {
      map.set(p.id, { id: p.id, name: p.name, presence: 0, games: 0, wins: 0, losses: 0, euros: 0 });
    }
    for (const s of state.sessions) {
      // Presences
      for (const pid of s.attendance ?? []) {
        if (map.has(pid)) map.get(pid).presence += 1;
      }
      // Tables
      for (const r of s.rounds ?? []) {
        for (const t of r.tables ?? []) {
          const A = t.A ?? [];
          const B = t.B ?? [];
          const euro = t.loserPaysPerPlayer ?? state.settings.euroPerLoss;
          for (const pid of A) if (map.has(pid)) map.get(pid).games += 1;
          for (const pid of B) if (map.has(pid)) map.get(pid).games += 1;
          if (t.winner === 'A') {
            for (const pid of A) if (map.has(pid)) map.get(pid).wins += 1;
            for (const pid of B) if (map.has(pid)) { map.get(pid).losses += 1; map.get(pid).euros += euro; }
          } else if (t.winner === 'B') {
            for (const pid of B) if (map.has(pid)) map.get(pid).wins += 1;
            for (const pid of A) if (map.has(pid)) { map.get(pid).losses += 1; map.get(pid).euros += euro; }
          }
        }
      }
    }
    // Compute rate
    const list = Array.from(map.values()).filter(x => x.games > 0 || x.presence > 0);
    for (const s of list) {
      s.rate = s.games ? Math.round(1000 * (s.wins / s.games)) / 10 : 0;
    }
    return list;
  }

  function renderStats() {
    const list = computeStats();
    const sortBy = rankingSort.value;
    list.sort((a, b) => {
      if (sortBy === 'wins') return b.wins - a.wins || a.euros - b.euros || a.name.localeCompare(b.name, 'fr');
      if (sortBy === 'rate') return b.rate - a.rate || b.wins - a.wins || a.euros - b.euros || a.name.localeCompare(b.name, 'fr');
      if (sortBy === 'euros') return a.euros - b.euros || b.wins - a.wins || a.name.localeCompare(b.name, 'fr');
      return a.name.localeCompare(b.name, 'fr');
    });

    statsTableBody.innerHTML = list.map(s => `
      <tr>
        <td>${s.name}</td>
        <td>${s.presence}</td>
        <td>${s.games}</td>
        <td style="color:var(--success);font-weight:600">${s.wins}</td>
        <td style="color:var(--danger);font-weight:600">${s.losses}</td>
        <td>${s.rate.toFixed(1).replace('.', ',')} %</td>
        <td style="text-align:right">${fmtEUR(s.euros)}</td>
      </tr>
    `).join('');

    // Advanced (binômes les plus fréquents)
    renderAdvancedStats();
    updatePotBadge();
  }

  function renderAdvancedStats() {
    // Binômes les plus fréquents (globaux)
    const pairKey = (a, b) => [a, b].sort().join('::');
    const pairCount = new Map(); // key -> {count, wins}
    for (const s of state.sessions) {
      for (const r of s.rounds ?? []) {
        for (const t of r.tables ?? []) {
          if ((t.A?.length || 0) === 2) {
            const k = pairKey(t.A[0], t.A[1]);
            const obj = pairCount.get(k) || { count: 0, wins: 0 };
            obj.count++; if (t.winner === 'A') obj.wins++;
            pairCount.set(k, obj);
          }
          if ((t.B?.length || 0) === 2) {
            const k = pairKey(t.B[0], t.B[1]);
            const obj = pairCount.get(k) || { count: 0, wins: 0 };
            obj.count++; if (t.winner === 'B') obj.wins++;
            pairCount.set(k, obj);
          }
        }
      }
    }
    const entries = Array.from(pairCount.entries()).map(([key, v]) => {
      const [p1, p2] = key.split('::');
      const names = `${playerName(p1)} & ${playerName(p2)}`;
      const wr = v.count ? Math.round(1000 * (v.wins / v.count)) / 10 : 0;
      return { names, count: v.count, wr };
    }).sort((a, b) => b.count - a.count || b.wr - a.wr).slice(0, 6);

    advancedStatsBox.innerHTML = `
      <div class="stat-box">
        <h5>Top binômes</h5>
        ${entries.length ? entries.map(e => `<div>${q(e.names)} — ${e.count} parties · ${e.wr.toFixed(1).replace('.', ',')} %</div>`).join('') : '<div>Aucune donnée</div>'}
      </div>
    `;

    function q(s) { return s.replace(/&/g, '&amp;'); }
  }

  /*** ---------- Export / Import ---------- ***/
  const exportJsonBtn = $('#exportJsonBtn');
  const importJsonInput = $('#importJsonInput');

  exportJsonBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `coinche_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  importJsonInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (typeof data !== 'object') throw new Error('Format invalide');
      if (!data.players || !data.sessions) throw new Error('Champs manquants');
      const mode = confirm('Importer en REMPLAÇANT les données existantes ?\nAnnuler = Fusionner') ? 'replace' : 'merge';
      if (mode === 'replace') {
        state = data;
      } else {
        // Merge basique : dédupe par id
        const byId = new Map(state.players.map(p => [p.id, p]));
        for (const p of data.players) byId.set(p.id, p);
        const sessById = new Map(state.sessions.map(s => [s.id, s]));
        for (const s of data.sessions) sessById.set(s.id, s);
        state = {
          version: data.version || state.version || VERSION,
          settings: { ...state.settings, ...(data.settings || {}) },
          players: Array.from(byId.values()).sort((a,b)=>a.name.localeCompare(b.name,'fr')),
          sessions: Array.from(sessById.values()).sort((a,b)=>a.date.localeCompare(b.date))
        };
      }
      saveState();
      renderAll();
      toast('Import réussi');
    } catch (err) {
      console.error(err);
      toast('Import échoué');
    } finally {
      importJsonInput.value = '';
    }
  });

  function exportCSV() {
    const rows = [];
    rows.push(['SessionID','Date','RoundID','Table','TeamA','TeamB','ScoreA','ScoreB','Winner','LosersEuroEach'].map(qCSV).join(','));
    for (const s of state.sessions) {
      for (const r of s.rounds ?? []) {
        r.tables?.forEach((t, idx) => {
          const TeamA = t.A.map(playerName).join(' & ');
          const TeamB = t.B.map(playerName).join(' & ');
          rows.push([
            s.id, s.date, r.id, `Table ${idx+1}`,
            TeamA, TeamB,
            t.scoreA ?? '', t.scoreB ?? '',
            t.winner ?? '', t.loserPaysPerPlayer ?? state.settings.euroPerLoss
          ].map(qCSV).join(','));
        });
      }
    }
    const blob = new Blob([rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `coinche_tables_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 0);
  }

  /*** ---------- PWA / Install ---------- ***/
  const installBtn = $('#installBtn');
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  const clearPwaCacheBtn = $('#clearPwaCacheBtn');
  clearPwaCacheBtn.addEventListener('click', async () => {
    if (!('caches' in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    if (navigator.serviceWorker?.controller) {
      try { await navigator.serviceWorker.getRegistration()?.then(r => r?.update()); } catch {}
    }
    toast('Cache PWA vidé');
    location.reload();
  });

  /*** ---------- Maintenance ---------- ***/
  $('#forceRerenderBtn').addEventListener('click', renderAll);
  $('#resetDataBtn').addEventListener('click', () => {
    if (!confirm('Effacer toutes les données locales ?')) return;
    localStorage.removeItem(KEY);
    state = defaultState();
    saveState();
    renderAll();
    toast('Réinitialisé');
  });

  /*** ---------- Initial Render ---------- ***/
  function renderAll() {
    // controls
    themeSelect.value = state.settings.theme || 'auto';
    applyTheme();

    if (!activeSession()) {
      sessionDateInput.value = todayISODate();
    }
    renderPlayers();
    renderSessionsHistory();
    renderAttendanceGrid();
    renderRounds();
    euroPerLossInput.value = state.settings.euroPerLoss;
    renderStats();
  }

  // Seed demo data if fresh install (optional small demo)
  if (state.players.length === 0 && state.sessions.length === 0) {
    const demo = ['Alexandre','Marie','Paul','Luc','Sophie','Nina','Hugo','Leo','Chloé','Maxime','Camille','Tom'];
    demo.forEach(n => addPlayer(n));
    createSession(todayISODate());
    const s = activeSession();
    s.attendance = state.players.slice(0, 8).map(p => p.id);
    saveState();
    createRound(); // 2 tables
    // set winners
    const r = s.rounds[0];
    r.tables[0].winner = 'A';
    r.tables[0].loserPaysPerPlayer = state.settings.euroPerLoss;
    r.tables[1].winner = 'B';
    r.tables[1].loserPaysPerPlayer = state.settings.euroPerLoss;
    saveState();
  }

  renderAll();

})();