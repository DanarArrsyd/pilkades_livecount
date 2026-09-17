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
    lastSaved: document.getElementById('tallyLastSaved'),
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

    if (state.selectedTpsId !== tpsId) return;

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

  function collectDeltas() {
    const inputs = el.panel.querySelectorAll('input[data-candidate-id]');
    const deltas = [];
    let invalidRaw = null;
    inputs.forEach((input) => {
      if (invalidRaw !== null) return;
      const raw = input.value.trim();
      if (!raw) return;
      const delta = Number(raw);
      if (!Number.isInteger(delta)) {
        invalidRaw = raw;
        return;
      }
      if (delta === 0) return;
      const candidateId = input.dataset.candidateId === 'invalid' ? null : input.dataset.candidateId;
      deltas.push({ candidate_id: candidateId, delta });
    });
    return { deltas, invalidRaw };
  }

  function describeDeltas(deltas) {
    return deltas.map((d) => {
      if (d.candidate_id === null) return `Tidak Sah ${d.delta > 0 ? '+' : ''}${d.delta}`;
      const c = state.candidates.find((x) => x.id === d.candidate_id);
      return `${c ? 'Paslon ' + c.candidate_number : '?'} ${d.delta > 0 ? '+' : ''}${d.delta}`;
    }).join(', ');
  }

  function labelForCandidate(candidateId) {
    if (candidateId === null) return 'Tidak Sah';
    const c = state.candidates.find((x) => x.id === candidateId);
    return c ? 'Paslon ' + c.candidate_number : '?';
  }

  async function submitTally() {
    const { deltas, invalidRaw } = collectDeltas();
    if (invalidRaw !== null) {
      showToast(`Angka harus bulat: "${invalidRaw}".`, 'error');
      return;
    }
    if (deltas.length === 0) {
      showToast('Isi minimal satu angka dulu.', 'error');
      return;
    }

    if (!navigator.onLine) {
      showToast('Tidak ada koneksi — coba lagi.', 'error');
      return;
    }

    const submittedTpsId = state.selectedTpsId;
    const row = state.overview.find((r) => r.tps_id === submittedTpsId);
    if (!row) return;

    for (const d of deltas) {
      const key = d.candidate_id === null ? 'invalid' : d.candidate_id;
      const currentValue = state.currentSummary[key] || 0;
      const projected = currentValue + d.delta;
      if (projected < 0) {
        showToast(`Suara ${labelForCandidate(d.candidate_id)} tidak boleh minus (saat ini ${currentValue}, ditambah ${d.delta}).`, 'error');
        return;
      }
    }

    const confirmed = window.confirm(`TPS ${padTps(row.tps_number)} — ${describeDeltas(deltas)}. Lanjut?`);
    if (!confirmed) return;

    const btn = document.getElementById('tallySubmitBtn');
    if (btn) btn.disabled = true;

    const { data, error } = await sb.rpc('submit_tps_tally', {
      p_tps_id: submittedTpsId,
      p_deltas: deltas,
    });

    if (error) {
      showToast('Gagal simpan: ' + error.message, 'error');
      el.lastSaved.className = 'tally-last-saved err';
      el.lastSaved.textContent = `✗ Gagal TPS ${padTps(row.tps_number)} — ${formatTime(new Date())} — ${error.message}`;
      if (btn) btn.disabled = false;
      return;
    }

    el.lastSaved.className = 'tally-last-saved ok';
    el.lastSaved.textContent = `✓ Tersimpan TPS ${padTps(row.tps_number)} — ${formatTime(new Date())} (${describeDeltas(deltas)})`;

    if (state.selectedTpsId !== submittedTpsId) {
      const currentBtn = document.getElementById('tallySubmitBtn');
      if (currentBtn) currentBtn.disabled = false;
      return;
    }

    const current = {};
    (data.summary || []).forEach((r) => {
      current[r.candidate_id === null ? 'invalid' : r.candidate_id] = r.vote_count;
    });
    state.currentSummary = current;

    row.status = data.tps_status;
    renderGrid();
    renderForm(row);
    showToast('Rekap tersimpan.', 'success');
  }

  el.panel.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'tallySubmitBtn') submitTally();
  });

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
