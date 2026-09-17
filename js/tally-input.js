// Input Rekap TPS: bulk/final-tally entry per TPS, additive across resubmits.
// Reads/writes vote_summary directly via submit_tps_tally — never touches
// vote_events (that table models discrete per-keypress votes; this doesn't).
(function () {
  const state = {
    election: null,
    overview: [],
    candidates: [],
    selectedTpsId: null,
  };

  const el = {
    grid: document.getElementById('tallyTpsGrid'),
    panel: document.getElementById('tallyPanel'),
    toast: document.getElementById('toast'),
  };

  function showToast(message, type) {
    el.toast.textContent = message;
    el.toast.className = type || '';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.className = 'hidden'; }, 3000);
  }

  function renderGrid() {
    el.grid.innerHTML = state.overview.map((r) => {
      const selected = r.tps_id === state.selectedTpsId ? ' is-selected' : '';
      return `<button type="button" class="tally-tps-btn status-${r.status}${selected}" data-tps-id="${r.tps_id}">${padTps(r.tps_number)}</button>`;
    }).join('');

    el.grid.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => selectTps(btn.dataset.tpsId));
    });
  }

  async function loadOverview() {
    const { data, error } = await sb.rpc('get_tps_overview', { p_election_id: state.election.id });
    if (error) {
      showToast('Gagal muat data TPS: ' + error.message, 'error');
      return;
    }
    state.overview = data || [];
    renderGrid();
  }

  function selectTps(tpsId) {
    state.selectedTpsId = tpsId;
    renderGrid();
    el.panel.innerHTML = '<div class="tally-placeholder">Memuat...</div>';
  }

  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = '../login.html';
      return;
    }

    const { data: election, error } = await sb
      .from('elections')
      .select('id')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !election) {
      showToast('Election aktif tidak ditemukan.', 'error');
      return;
    }
    state.election = election;

    await loadOverview();
  }

  init();
})();
