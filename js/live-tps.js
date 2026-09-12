// Public per-TPS browser: pick a TPS from the grid, read its tally. No auth needed —
// every query here hits public RLS policies (candidates/tps/vote_summary select-all).
(function () {
  const state = {
    election: null,
    candidates: [],
    overview: [],
    activeTpsNumber: null,
    channel: null,
    cardsBuiltFor: null,
    tallies: new Map(), // tps_id -> {candidate_id|'invalid' -> count}
  };

  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const el = {
    name: document.getElementById('electionName'),
    village: document.getElementById('electionVillage'),
    resultStatus: document.getElementById('resultStatus'),
    statTpsDone: document.getElementById('statTpsDone'),
    statValid: document.getElementById('statValid'),
    statInvalid: document.getElementById('statInvalid'),
    navGrid: document.getElementById('tpsNavGrid'),
    heading: document.getElementById('tpsHeading'),
    candidateGrid: document.getElementById('candidateGrid'),
    detailTableTitle: document.getElementById('detailTableTitle'),
    detailRows: document.getElementById('detailRows'),
    updatedAt: document.getElementById('updatedAt'),
  };

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function pct(count, total) {
    if (!total) return '0.00';
    return ((count / total) * 100).toFixed(2);
  }

  function idNum(n) {
    return Number(n).toLocaleString('id-ID');
  }

  function animateNumber(node, to, format) {
    const from = Number(node.dataset.value || 0);
    node.dataset.value = String(to);
    if (REDUCED_MOTION || from === to) {
      node.textContent = format(to);
      return;
    }
    const start = performance.now();
    const duration = 520;
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = format(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function renderHeaderStats() {
    const done = state.overview.filter((r) => r.status === 'locked' || r.status === 'completed').length;
    const allLocked = state.overview.length > 0 && state.overview.every((r) => r.status === 'locked');
    const totalValid = state.overview.reduce((s, r) => s + Number(r.valid_votes), 0);
    const totalInvalid = state.overview.reduce((s, r) => s + Number(r.invalid_votes), 0);

    el.statTpsDone.textContent = `${done} TPS`;
    el.statValid.textContent = `${idNum(totalValid)} SAH`;
    el.statInvalid.textContent = `${idNum(totalInvalid)} TIDAK SAH`;
    el.resultStatus.classList.toggle('final', allLocked);
    el.resultStatus.querySelector('span:last-child').textContent = allLocked ? 'Selesai' : 'Live Count';
  }

  function renderNavGrid() {
    el.navGrid.innerHTML = state.overview.map((r) => {
      const active = r.tps_number === state.activeTpsNumber ? ' is-active' : '';
      return `<button type="button" class="tps-btn status-${r.status}${active}" data-num="${r.tps_number}">${padTps(r.tps_number)}</button>`;
    }).join('');

    el.navGrid.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => selectTps(Number(btn.dataset.num)));
    });
  }

  function renderCandidateCards(byCandidate, validTotal) {
    if (state.cardsBuiltFor !== state.candidates.length) {
      el.candidateGrid.innerHTML = state.candidates.map((c) => {
        const photo = c.photo_url
          ? `<img src="${escapeHtml(c.photo_url)}" alt="" />`
          : 'Foto Calon';
        return `
          <div class="report-card">
            <div class="report-card-num">${c.candidate_number}</div>
            <div class="report-card-body">
              <div class="report-card-photo">${photo}</div>
              <div class="report-card-result">
                <span class="pct" id="tpsPct-${c.id}">0,00%</span>
                <span class="votes" id="tpsVotes-${c.id}">0 Suara</span>
              </div>
            </div>
            <div class="report-card-footer">${escapeHtml(c.name)}</div>
          </div>
        `;
      }).join('');
      el.candidateGrid.style.setProperty('--cards', String(state.candidates.length));
      state.cardsBuiltFor = state.candidates.length;
    }

    state.candidates.forEach((c) => {
      const count = byCandidate[c.id] || 0;
      const votesEl = document.getElementById(`tpsVotes-${c.id}`);
      if (votesEl) animateNumber(votesEl, count, (v) => `${idNum(Math.round(v))} Suara`);
      const pctEl = document.getElementById(`tpsPct-${c.id}`);
      if (pctEl) animateNumber(pctEl, Number(pct(count, validTotal)), (v) => v.toFixed(2).replace('.', ',') + '%');
    });
  }

  function renderDetailTable(row, byCandidate, validTotal, invalid) {
    const candidateRows = state.candidates.map((c) => {
      const count = byCandidate[c.id] || 0;
      return `
        <tr>
          <th scope="row">${c.candidate_number}. ${escapeHtml(c.name)}</th>
          <td>${idNum(count)}</td>
          <td>${pct(count, validTotal).replace('.', ',')}%</td>
        </tr>
      `;
    }).join('');

    const verified = row.is_verified;
    el.detailRows.innerHTML = `
      ${candidateRows}
      <tr class="row-sum">
        <th scope="row">Suara Sah</th>
        <td>${idNum(validTotal)}</td>
        <td>—</td>
      </tr>
      <tr class="row-sum">
        <th scope="row">Suara Tidak Sah</th>
        <td>${idNum(invalid)}</td>
        <td>—</td>
      </tr>
      <tr class="row-total">
        <th scope="row">Total Suara</th>
        <td>${idNum(validTotal + invalid)}</td>
        <td>—</td>
      </tr>
      <tr class="row-verify">
        <th scope="row">Terverifikasi</th>
        <td colspan="2">
          <span class="verify-flag ${verified ? 'is-done' : 'is-pending'}">
            ${verified ? 'Terverifikasi Selesai' : 'Belum Terverifikasi'}
          </span>
        </td>
      </tr>
    `;
  }

  async function selectTps(tpsNumber) {
    state.activeTpsNumber = tpsNumber;
    history.replaceState(null, '', `?n=${tpsNumber}`);
    renderNavGrid();
    await loadDetail(tpsNumber);
    subscribeToTps(tpsNumber);
  }

  async function loadDetail(tpsNumber) {
    const row = state.overview.find((r) => r.tps_number === tpsNumber);
    if (!row) return;

    el.heading.textContent = `TPS No. ${padTps(tpsNumber)}`;
    el.detailTableTitle.textContent = `TPS ${padTps(tpsNumber)} · ${statusLabelId(row.status)}`;

    // Paint a previously loaded tally straight away, then reconcile with the
    // server — switching between TPS shouldn't wait on a round trip.
    const cached = state.tallies.get(row.tps_id);
    if (cached) paintTps(row, cached);

    const { data: summaryRows, error } = await sb
      .from('vote_summary')
      .select('candidate_id, vote_count')
      .eq('tps_id', row.tps_id);

    if (error) return;

    const byCandidate = {};
    (summaryRows || []).forEach((r) => { byCandidate[r.candidate_id === null ? 'invalid' : r.candidate_id] = r.vote_count; });
    state.tallies.set(row.tps_id, byCandidate);

    paintTps(row, byCandidate);
  }

  function paintTps(row, byCandidate) {
    const validTotal = state.candidates.reduce((s, c) => s + (byCandidate[c.id] || 0), 0);
    const invalid = byCandidate.invalid || 0;

    renderCandidateCards(byCandidate, validTotal);
    renderDetailTable(row, byCandidate, validTotal, invalid);

    el.updatedAt.textContent = `Terakhir diperbarui: ${formatTime(new Date())}`;
  }

  function subscribeToTps(tpsNumber) {
    if (state.channel) {
      sb.removeChannel(state.channel);
    }
    const row = state.overview.find((r) => r.tps_number === tpsNumber);
    if (!row) return;

    state.channel = sb
      .channel(`tps-detail-${row.tps_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vote_summary', filter: `tps_id=eq.${row.tps_id}` }, () => {
        scheduleDetail(tpsNumber);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tps', filter: `id=eq.${row.tps_id}` }, async () => {
        await refreshOverview();
        scheduleDetail(tpsNumber);
      })
      .subscribe();
  }

  // One read per burst: a TPS being counted emits an event per vote, and there is
  // nothing to gain from firing a query for each of them.
  let detailPending = false;

  function scheduleDetail(tpsNumber) {
    if (detailPending) return;
    detailPending = true;
    setTimeout(() => {
      detailPending = false;
      if (state.activeTpsNumber === tpsNumber && !document.hidden) loadDetail(tpsNumber);
    }, 600);
  }

  async function refreshOverview() {
    const { data } = await sb.rpc('get_tps_overview', { p_election_id: state.election.id });
    state.overview = data || [];
    renderNavGrid();
    renderHeaderStats();
  }

  async function init() {
    const { data: election, error } = await sb
      .from('elections')
      .select('id, name, village_name')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !election) {
      el.name.textContent = 'Belum ada election aktif.';
      return;
    }
    state.election = election;
    el.name.textContent = election.name;
    el.village.textContent = election.village_name;

    const { data: candidates } = await sb
      .from('candidates')
      .select('id, candidate_number, name, photo_url')
      .eq('election_id', election.id)
      .eq('is_active', true)
      .order('candidate_number');
    state.candidates = candidates || [];

    await refreshOverview();

    const params = new URLSearchParams(location.search);
    const requested = Number(params.get('n')) || 1;
    await selectTps(requested);
  }

  init();
})();
