// Public per-TPS browser: nav grid for TPS 01-40, click to load detail. No auth needed.
(function () {
  const state = {
    election: null,
    candidates: [],
    overview: [],
    activeTpsNumber: null,
    channel: null,
  };

  const el = {
    village: document.getElementById('electionVillage'),
    navGrid: document.getElementById('tpsNavGrid'),
    detailTpsNumber: document.getElementById('detailTpsNumber'),
    detailStatus: document.getElementById('detailStatus'),
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

  function renderNavGrid() {
    el.navGrid.innerHTML = state.overview.map((r) => {
      const cls = (r.status === 'locked' || r.status === 'completed') ? 'locked' : r.status;
      const active = r.tps_number === state.activeTpsNumber ? ' active' : '';
      return `<button class="tps-dot ${cls}${active}" data-num="${r.tps_number}" style="cursor:pointer;">${padTps(r.tps_number)}</button>`;
    }).join('');

    el.navGrid.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => selectTps(Number(btn.dataset.num)));
    });
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

    el.detailTpsNumber.textContent = padTps(tpsNumber);
    el.detailStatus.textContent = statusLabelId(row.status);
    el.detailStatus.className = 'badge status-' + row.status;

    const { data: summaryRows } = await sb
      .from('vote_summary')
      .select('candidate_id, vote_count')
      .eq('tps_id', row.tps_id);

    const byCandidate = {};
    (summaryRows || []).forEach((r) => { byCandidate[r.candidate_id === null ? 'invalid' : r.candidate_id] = r.vote_count; });

    const validTotal = state.candidates.reduce((s, c) => s + (byCandidate[c.id] || 0), 0);
    const invalid = byCandidate.invalid || 0;

    el.detailRows.innerHTML = [
      ...state.candidates.map((c) => {
        const count = byCandidate[c.id] || 0;
        return `<div class="detail-row"><span>${c.candidate_number}. ${escapeHtml(c.name)}</span><span class="val">${count} (${pct(count, validTotal)}%)</span></div>`;
      }),
      `<div class="detail-row"><span>Tidak Sah</span><span class="val">${invalid}</span></div>`,
      `<div class="detail-row"><span>Suara Sah</span><span class="val">${validTotal}</span></div>`,
      `<div class="detail-row total"><span>Total Suara</span><span class="val">${validTotal + invalid}</span></div>`,
      `<div class="detail-row"><span>Terverifikasi</span><span class="val">${row.is_verified ? 'Ya' : 'Belum'}</span></div>`,
    ].join('');

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
        loadDetail(tpsNumber);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tps', filter: `id=eq.${row.tps_id}` }, async () => {
        await refreshOverview();
        loadDetail(tpsNumber);
      })
      .subscribe();
  }

  async function refreshOverview() {
    const { data } = await sb.rpc('get_tps_overview', { p_election_id: state.election.id });
    state.overview = data || [];
    renderNavGrid();
  }

  async function init() {
    const { data: election, error } = await sb
      .from('elections')
      .select('id, village_name')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !election) return;
    state.election = election;
    el.village.textContent = election.village_name;

    const { data: candidates } = await sb
      .from('candidates')
      .select('id, candidate_number, name')
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
