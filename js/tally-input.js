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

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  async function selectTps(tpsId) {
    state.selectedTpsId = tpsId;
    renderGrid();

    const row = state.overview.find((r) => r.tps_id === tpsId);
    if (!row) return;

    el.panel.innerHTML = '<div class="tally-placeholder">Memuat...</div>';

    const { data: summaryRows, error } = await sb
      .from('vote_summary')
      .select('candidate_id, vote_count')
      .eq('tps_id', tpsId);

    if (error) {
      showToast('Gagal muat rekap TPS: ' + error.message, 'error');
      el.panel.innerHTML = '<div class="tally-placeholder">Gagal muat data.</div>';
      return;
    }

    const current = {};
    (summaryRows || []).forEach((r) => {
      current[r.candidate_id === null ? 'invalid' : r.candidate_id] = r.vote_count;
    });
    state.currentSummary = current;

    renderForm(row);
  }

  function renderForm(row) {
    const locked = row.status === 'locked';
    const lockedBanner = locked
      ? '<div class="tally-locked-banner">TPS ini terkunci — input ditolak. Buka kunci lewat halaman TPS.</div>'
      : '';

    const candidateRows = state.candidates.map((c) => `
      <div class="tally-row">
        <span class="num">${c.candidate_number}</span>
        <span>${escapeHtml(c.name)}</span>
        <span class="current">Saat ini: ${state.currentSummary[c.id] || 0}</span>
        <input type="number" inputmode="numeric" data-candidate-id="${c.id}" placeholder="Tambahkan" ${locked ? 'disabled' : ''} />
      </div>
    `).join('');

    const invalidRow = `
      <div class="tally-row">
        <span class="num"></span>
        <span>Tidak Sah</span>
        <span class="current">Saat ini: ${state.currentSummary.invalid || 0}</span>
        <input type="number" inputmode="numeric" data-candidate-id="invalid" placeholder="Tambahkan" ${locked ? 'disabled' : ''} />
      </div>
    `;

    el.panel.innerHTML = `
      <div class="tally-form-head">
        <span class="num">TPS ${padTps(row.tps_number)}</span>
        <span class="badge status-${row.status}">${statusLabelId(row.status)}</span>
      </div>
      ${lockedBanner}
      ${candidateRows}
      ${invalidRow}
      <div class="tally-actions">
        <button id="tallySubmitBtn" ${locked ? 'disabled' : ''}>Simpan</button>
      </div>
    `;
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

    const { data: candidates, error: candError } = await sb
      .from('candidates')
      .select('id, candidate_number, name')
      .eq('election_id', election.id)
      .eq('is_active', true)
      .order('candidate_number');

    if (candError) {
      showToast('Gagal muat kandidat: ' + candError.message, 'error');
      return;
    }
    state.candidates = candidates || [];

    await loadOverview();
  }

  init();
})();
