// Rapid vote input console: keyboard-driven, one keypress = one vote event.
// Perf: single round trip per action, optimistic UI, reconciled with the server response.
// Offline: votes always go through a persisted FIFO queue. Offline just means the queue
// doesn't drain yet — the vote is never silently lost, and the UI never pretends it's synced.
(function () {
  const QUEUE_KEY = 'offlineVoteQueue';

  const state = {
    election: null,
    candidates: [],       // [{id, candidate_number, name}]
    activeTps: null,      // {id, tps_number, status} | null while switching
    summary: {},          // candidate_id -> count, 'invalid' -> count
    recentTps: [],        // recent tps_number list, most recent first
    localHistory: [],     // stack of candidateNumber, for optimistic undo (this session only)
    switchToken: 0,       // guards against out-of-order TPS switch responses
    queue: [],            // pending vote items not yet confirmed by the server
    flushing: false,
    snapshots: new Map(), // tps_number -> {tps, summary} from the last server read
  };

  const el = {
    connState: document.getElementById('connState'),
    activeTpsNumber: document.getElementById('activeTpsNumber'),
    tpsStatusBadge: document.getElementById('tpsStatusBadge'),
    tpsSwitchInput: document.getElementById('tpsSwitchInput'),
    candidateGrid: document.getElementById('candidateGrid'),
    tpsTotal: document.getElementById('tpsTotal'),
    lastInput: document.getElementById('lastInput'),
    recentTps: document.getElementById('recentTps'),
    toast: document.getElementById('toast'),
    lockedBanner: document.getElementById('lockedBanner'),
    statusDot: document.getElementById('statusDot'),
    statusLineText: document.getElementById('statusLineText'),
  };

  // "Live Counting" reads better than the shared "Sedang Menghitung" on this
  // one status line — everywhere else in the app uses statusLabelId() directly.
  const STATUS_LINE_LABEL_ID = { counting: 'Live Counting' };

  function showToast(message, type) {
    el.toast.textContent = message;
    el.toast.className = type || '';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.className = 'hidden'; }, 3000);
  }

  function loadQueue() {
    try {
      state.queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch (_) {
      state.queue = [];
    }
  }

  function persistQueue() {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(state.queue));
  }

  function updateConnState() {
    if (!navigator.onLine) {
      const n = state.queue.length;
      el.connState.textContent = n > 0 ? `OFFLINE — ${n} suara menunggu sinkron` : 'OFFLINE ●';
      el.connState.className = 'conn-offline';
      return;
    }
    if (state.queue.length > 0 || state.flushing) {
      el.connState.textContent = `SYNCING ${state.queue.length} EVENTS`;
      el.connState.className = 'conn-syncing';
      return;
    }
    el.connState.textContent = 'ONLINE ● semua tersinkron';
    el.connState.className = 'conn-online';
  }

  // Row nodes are looked up once here; the hot path (every keypress) then writes
  // straight to them instead of re-querying the DOM for each candidate.
  const rows = new Map(); // summary key -> {btn, count, bar}

  function renderCandidateGrid() {
    const frag = document.createDocumentFragment();
    rows.clear();

    const build = (key, number, label, extraClass) => {
      const btn = document.createElement('button');
      btn.className = 'ledger-row' + (extraClass ? ' ' + extraClass : '');
      btn.dataset.candidateNumber = number;
      btn.innerHTML = `
        <span class="num">${number}</span>
        <span class="name">${escapeHtml(label)}</span>
        <span class="count">0</span>
        <span class="row-progress"><span class="row-progress-fill"></span></span>
      `;
      btn.addEventListener('click', () => castVote(number));
      frag.appendChild(btn);
      rows.set(key, {
        btn,
        count: btn.querySelector('.count'),
        bar: btn.querySelector('.row-progress-fill'),
      });
    };

    state.candidates.forEach((c) => build(c.id, c.candidate_number, c.name));
    build('invalid', 0, 'Tidak Sah', 'invalid');

    el.candidateGrid.replaceChildren(frag);
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // Coalesced to one write per frame: holding a key down fires far faster than the
  // screen refreshes, and only the last state of a frame is ever visible.
  let summaryFrame = 0;

  function renderSummary() {
    if (summaryFrame) return;
    summaryFrame = requestAnimationFrame(() => {
      summaryFrame = 0;
      paintSummary();
    });
  }

  function paintSummary() {
    let total = 0;
    rows.forEach((_, key) => { total += state.summary[key] || 0; });

    rows.forEach((row, key) => {
      const count = state.summary[key] || 0;
      animateNumber(row.count, count, 400);
      row.bar.style.width = (total ? (count / total) * 100 : 0) + '%';
    });

    animateNumber(el.tpsTotal, total, 400);
  }

  // summaryRows: [{candidate_id, vote_count}] from a combined RPC response.
  function applySummaryRows(summaryRows) {
    const summary = {};
    (summaryRows || []).forEach((row) => {
      summary[row.candidate_id === null ? 'invalid' : row.candidate_id] = row.vote_count;
    });
    state.summary = summary;
  }

  // Any vote for this TPS still sitting in the offline queue hasn't reached the
  // server's summary yet — layer it on top so the count never understates reality.
  function applyQueuedDeltas(tpsId) {
    state.queue
      .filter((item) => item.tpsId === tpsId)
      .forEach((item) => {
        const key = item.candidateId || 'invalid';
        state.summary[key] = (state.summary[key] || 0) + 1;
      });
    renderSummary();
  }

  function renderActiveTps(loading) {
    if (!state.activeTps) {
      el.activeTpsNumber.textContent = '--';
      el.tpsStatusBadge.textContent = '-';
      el.statusDot.className = 'status-dot';
      el.statusLineText.textContent = 'Pilih TPS';
      el.candidateGrid.classList.remove('locked');
      el.lockedBanner.classList.add('hidden');
      return;
    }
    el.activeTpsNumber.textContent = padTps(state.activeTps.tps_number);
    el.tpsStatusBadge.textContent = loading ? 'Memuat' : statusLabelId(state.activeTps.status);
    el.tpsStatusBadge.className = 'badge ' + (loading ? 'status-not_started' : 'status-' + state.activeTps.status);
    el.statusDot.className = 'status-dot ' + (loading ? '' : state.activeTps.status);
    el.statusLineText.textContent = loading ? 'Memuat...' : (STATUS_LINE_LABEL_ID[state.activeTps.status] || statusLabelId(state.activeTps.status));
    const isLocked = !loading && state.activeTps.status === 'locked';
    el.candidateGrid.classList.toggle('locked', isLocked);
    el.lockedBanner.classList.toggle('hidden', !isLocked);
  }

  function renderRecentTps() {
    el.recentTps.innerHTML = '';
    state.recentTps.forEach((num) => {
      const btn = document.createElement('button');
      btn.textContent = padTps(num);
      if (state.activeTps && state.activeTps.tps_number === num) {
        btn.classList.add('active');
      }
      btn.addEventListener('click', () => switchTps(num));
      el.recentTps.appendChild(btn);
    });
  }

  function pushRecentTps(num) {
    state.recentTps = [num, ...state.recentTps.filter((n) => n !== num)].slice(0, 6);
    localStorage.setItem('recentTps', JSON.stringify(state.recentTps));
  }

  // Single round trip: tps row + summary together. A TPS visited before repaints
  // from cache on the same frame and the network response just reconciles it, so
  // hopping between TPS never blocks on latency.
  async function switchTps(tpsNumber) {
    const token = ++state.switchToken;
    const cached = state.snapshots.get(tpsNumber);

    if (cached) {
      state.activeTps = cached.tps;
      state.localHistory = [];
      applySummaryRows(cached.summary);
      renderActiveTps(false);
      applyQueuedDeltas(cached.tps.id);
    } else {
      state.activeTps = { tps_number: tpsNumber, id: null, status: state.activeTps?.status || 'not_started' };
      renderActiveTps(true);
      state.summary = {};
      renderSummary();
    }

    localStorage.setItem('activeTpsNumber', String(tpsNumber));
    pushRecentTps(tpsNumber);
    renderRecentTps();

    if (!navigator.onLine) {
      if (!cached) {
        showToast('Offline — tidak bisa muat data TPS lain sekarang.', 'error');
        state.activeTps = null;
        renderActiveTps();
      }
      return;
    }

    const { data, error } = await sb.rpc('get_tps_snapshot', {
      p_election_id: state.election.id,
      p_tps_number: tpsNumber,
    });

    if (token !== state.switchToken) return; // a newer switch already superseded this one

    if (error || !data || !data.tps) {
      if (cached) return; // keep showing the cached tally rather than blanking the console
      showToast(`TPS ${tpsNumber} tidak ditemukan.`, 'error');
      state.activeTps = null;
      renderActiveTps();
      return;
    }

    state.snapshots.set(tpsNumber, { tps: data.tps, summary: data.summary });
    state.activeTps = data.tps;
    state.localHistory = [];
    renderActiveTps(false);
    applySummaryRows(data.summary);
    applyQueuedDeltas(data.tps.id);
  }

  async function castVote(candidateNumber) {
    if (!state.activeTps || !state.activeTps.id) {
      showToast('TPS belum siap, tunggu sebentar.', 'error');
      return;
    }
    if (state.activeTps.status === 'locked') {
      showToast(`TPS ${padTps(state.activeTps.tps_number)} terkunci. Input ditolak.`, 'error');
      return;
    }

    let candidateId = null;
    let voteType = 'invalid';
    let candidateLabel = 'Tidak Sah';
    if (candidateNumber !== 0) {
      const candidate = state.candidates.find((c) => c.candidate_number === candidateNumber);
      if (!candidate) return;
      candidateId = candidate.id;
      voteType = 'candidate';
      candidateLabel = candidate.name;
    }

    // optimistic: bump the UI instantly, before the network call resolves (or even fires)
    const summaryKey = candidateId || 'invalid';
    state.summary[summaryKey] = (state.summary[summaryKey] || 0) + 1;
    renderSummary();
    flashButton(candidateNumber);
    state.localHistory.push(candidateNumber);

    const item = {
      clientEventId: generateClientEventId(),
      electionId: state.election.id,
      tpsId: state.activeTps.id,
      tpsNumber: state.activeTps.tps_number,
      candidateId,
      candidateNumber,
      voteType,
    };
    state.queue.push(item);
    persistQueue();

    const suffix = navigator.onLine ? '' : ' (menunggu sinkron)';
    el.lastInput.textContent = `+1 ${candidateLabel} — TPS ${padTps(state.activeTps.tps_number)} — ${formatTime(new Date())}${suffix}`;

    updateConnState();
    attemptFlush();
  }

  async function undoLastVote() {
    if (!state.activeTps || !state.activeTps.id) return;

    const tpsIdAtRequest = state.activeTps.id;

    // undoing a vote that's still sitting in the local queue: just drop it, never sent
    const queuedIdx = findLastQueuedIndexForTps(tpsIdAtRequest);
    if (queuedIdx !== -1) {
      const item = state.queue[queuedIdx];
      state.queue.splice(queuedIdx, 1);
      persistQueue();
      const key = item.candidateId || 'invalid';
      state.summary[key] = Math.max((state.summary[key] || 1) - 1, 0);
      renderSummary();
      state.localHistory.pop();
      const label = item.candidateId
        ? (state.candidates.find((c) => c.id === item.candidateId) || {}).name || '?'
        : 'Tidak Sah';
      el.lastInput.textContent = `UNDO (belum tersinkron) — ${label} — TPS ${padTps(state.activeTps.tps_number)} — ${formatTime(new Date())}`;
      showToast('Undo berhasil.', 'success');
      updateConnState();
      return;
    }

    if (!navigator.onLine) {
      showToast('Undo vote yang sudah tersinkron perlu koneksi internet.', 'error');
      return;
    }

    const lastCandidateNumber = state.localHistory[state.localHistory.length - 1];

    // optimistic decrement, only if we know what the last local vote was
    if (lastCandidateNumber !== undefined) {
      const candidate = lastCandidateNumber === 0
        ? null
        : state.candidates.find((c) => c.candidate_number === lastCandidateNumber);
      const summaryKey = candidate ? candidate.id : 'invalid';
      state.summary[summaryKey] = Math.max((state.summary[summaryKey] || 1) - 1, 0);
      renderSummary();
    }

    const { data, error } = await sb.rpc('undo_last_vote', { p_tps_id: tpsIdAtRequest });

    if (error) {
      // revert the optimistic decrement
      if (lastCandidateNumber !== undefined) {
        const candidate = lastCandidateNumber === 0
          ? null
          : state.candidates.find((c) => c.candidate_number === lastCandidateNumber);
        const summaryKey = candidate ? candidate.id : 'invalid';
        state.summary[summaryKey] = (state.summary[summaryKey] || 0) + 1;
        renderSummary();
      }
      showToast('Tidak ada vote untuk di-undo.', 'error');
      return;
    }

    state.localHistory.pop();

    const label = data.event.candidate_id
      ? (state.candidates.find((c) => c.id === data.event.candidate_id) || {}).name || '?'
      : 'Tidak Sah';
    el.lastInput.textContent = `UNDO — ${label} — TPS ${padTps(state.activeTps.tps_number)} — ${formatTime(new Date())}`;
    showToast('Undo berhasil.', 'success');

    const cachedAfterUndo = state.snapshots.get(state.activeTps.tps_number);
    if (cachedAfterUndo) cachedAfterUndo.summary = data.summary;

    if (state.activeTps && state.activeTps.id === tpsIdAtRequest) {
      applySummaryRows(data.summary);
      applyQueuedDeltas(tpsIdAtRequest);
    }
  }

  function findLastQueuedIndexForTps(tpsId) {
    for (let i = state.queue.length - 1; i >= 0; i--) {
      if (state.queue[i].tpsId === tpsId) return i;
    }
    return -1;
  }

  // Drains the offline queue strictly FIFO so vote order (and audit timestamps) stays
  // correct. Stops on the first network failure and lets 'online' / the retry timer
  // pick it back up. An application-level rejection (e.g. TPS got locked meanwhile)
  // is surfaced and dropped — retrying the exact same request would just fail again.
  async function attemptFlush() {
    if (state.flushing) return;
    state.flushing = true;
    updateConnState();

    while (state.queue.length > 0 && navigator.onLine) {
      const item = state.queue[0];
      let result;
      try {
        result = await sb.rpc('cast_vote', {
          p_client_event_id: item.clientEventId,
          p_election_id: item.electionId,
          p_tps_id: item.tpsId,
          p_candidate_id: item.candidateId,
          p_vote_type: item.voteType,
        });
      } catch (networkErr) {
        break; // transient network failure, retry later
      }

      if (result.error) {
        showToast(`Vote TPS ${padTps(item.tpsNumber)} ditolak server: ${result.error.message}`, 'error');
        state.queue.shift();
        persistQueue();
        continue;
      }

      state.queue.shift();
      persistQueue();

      const cached = state.snapshots.get(item.tpsNumber);
      if (cached) {
        cached.summary = result.data.summary;
        cached.tps.status = result.data.tps_status;
      }

      if (state.activeTps && state.activeTps.id === item.tpsId) {
        state.activeTps.status = result.data.tps_status;
        renderActiveTps(false);
        applySummaryRows(result.data.summary);
        applyQueuedDeltas(item.tpsId);
      }
    }

    state.flushing = false;
    updateConnState();
  }

  const flashTimers = new Map();

  function flashButton(candidateNumber) {
    const key = candidateNumber === 0
      ? 'invalid'
      : (state.candidates.find((c) => c.candidate_number === candidateNumber) || {}).id;
    const row = rows.get(key);
    if (!row) return;
    row.btn.classList.add('flash');
    clearTimeout(flashTimers.get(key));
    flashTimers.set(key, setTimeout(() => row.btn.classList.remove('flash'), 150));
  }

  function handleKeydown(e) {
    if (e.repeat) return; // ignore OS key auto-repeat, not a real distinct vote
    const activeEl = document.activeElement;
    const typingInSwitchBox = activeEl === el.tpsSwitchInput;

    if (typingInSwitchBox) return; // let the switch input handle its own keys

    if (e.key >= '1' && e.key <= '5') {
      e.preventDefault();
      castVote(Number(e.key));
      return;
    }
    if (e.key === '0') {
      e.preventDefault();
      castVote(0);
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      undoLastVote();
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      el.tpsSwitchInput.focus();
      el.tpsSwitchInput.value = '/';
    }
  }

  function handleSwitchInputKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = el.tpsSwitchInput.value.trim();
      const match = raw.match(/^\/?(\d{1,2})$/);
      el.tpsSwitchInput.value = '';
      el.tpsSwitchInput.blur();
      if (match) {
        switchTps(Number(match[1]));
      } else {
        showToast('Format: /7', 'error');
      }
    }
    if (e.key === 'Escape') {
      el.tpsSwitchInput.value = '';
      el.tpsSwitchInput.blur();
    }
  }

  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = '../login.html';
      return;
    }

    const { data: election, error: electionError } = await sb
      .from('elections')
      .select('id, name, village_name')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (electionError || !election) {
      showToast('Election aktif tidak ditemukan.', 'error');
      return;
    }
    state.election = election;

    const { data: candidates, error: candidatesError } = await sb
      .from('candidates')
      .select('id, candidate_number, name')
      .eq('election_id', election.id)
      .eq('is_active', true)
      .order('candidate_number', { ascending: true });

    if (candidatesError) {
      showToast('Gagal muat kandidat: ' + candidatesError.message, 'error');
      return;
    }
    state.candidates = candidates || [];
    renderCandidateGrid();

    try {
      state.recentTps = JSON.parse(localStorage.getItem('recentTps') || '[]');
    } catch (_) {
      state.recentTps = [];
    }
    renderRecentTps();

    loadQueue();
    if (state.queue.length > 0) {
      showToast(`${state.queue.length} vote belum tersinkron dari sesi sebelumnya, mencoba sinkron...`, 'error');
      attemptFlush();
    }

    const lastActive = Number(localStorage.getItem('activeTpsNumber')) || 1;
    await switchTps(lastActive);

    updateConnState();
    window.addEventListener('online', () => { updateConnState(); attemptFlush(); });
    window.addEventListener('offline', updateConnState);
    setInterval(() => { if (state.queue.length > 0) attemptFlush(); }, 5000);

    document.addEventListener('keydown', handleKeydown);
    el.tpsSwitchInput.addEventListener('keydown', handleSwitchInputKeydown);
  }

  init();
})();
