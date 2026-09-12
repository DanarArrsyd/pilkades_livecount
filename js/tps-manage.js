// TPS workflow: status transitions, verify, lock, unlock.
(function () {
  const state = {
    election: null,
    rows: [],
  };

  const el = {
    table: document.getElementById('tpsTable'),
    toast: document.getElementById('toast'),
  };

  function showToast(message, type) {
    el.toast.textContent = message;
    el.toast.className = type || '';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.className = 'hidden'; }, 3000);
  }

  function actionsFor(row) {
    const actions = [];
    if (row.status === 'not_started') {
      actions.push({ label: 'Mulai', fn: () => transition(row, 'counting') });
    }
    if (row.status === 'counting') {
      actions.push({ label: 'Jeda', fn: () => transition(row, 'paused') });
      actions.push({ label: 'Selesai', fn: () => transition(row, 'completed') });
    }
    if (row.status === 'paused') {
      actions.push({ label: 'Lanjut', fn: () => transition(row, 'counting') });
      actions.push({ label: 'Selesai', fn: () => transition(row, 'completed') });
    }
    if (row.status === 'completed') {
      if (!row.is_verified) {
        actions.push({ label: 'Verifikasi', fn: () => verify(row) });
      }
      actions.push({
        label: 'Kunci', fn: () => {
          if (window.confirm(`Kunci TPS ${padTps(row.tps_number)}? Input suara akan ditolak sampai dibuka kunci lagi.`)) {
            transition(row, 'locked');
          }
        },
      });
    }
    if (row.status === 'locked') {
      actions.push({ label: 'Buka Kunci', fn: () => unlock(row) });
    }
    return actions;
  }

  function renderRows() {
    document.getElementById('tpsLoading')?.remove();
    el.table.querySelectorAll('.tps-row:not(.head)').forEach((n) => n.remove());

    state.rows.forEach((row) => {
      const over = row.dpt_limit && row.total_votes > row.dpt_limit;
      const el2 = document.createElement('div');
      el2.className = 'tps-row';
      el2.innerHTML = `
        <span class="num">${padTps(row.tps_number)}</span>
        <span class="badge status-${row.status}">${statusLabelId(row.status)}</span>
        <span>${row.is_verified ? '<span class="verified-mark">✓ terverifikasi</span>' : ''}${over ? `<div class="limit-warning">Melebihi DPT (${row.total_votes}/${row.dpt_limit})</div>` : ''}</span>
        <span class="votes">${row.valid_votes}</span>
        <span class="votes">${row.invalid_votes}</span>
        <span class="votes ${over ? 'over-limit' : ''}">${row.total_votes}</span>
        <span class="actions"></span>
      `;
      const actionsEl = el2.querySelector('.actions');
      actionsFor(row).forEach((a) => {
        const btn = document.createElement('button');
        btn.textContent = a.label;
        btn.addEventListener('click', a.fn);
        actionsEl.appendChild(btn);
      });
      el.table.appendChild(el2);
    });
  }

  async function loadOverview() {
    const { data, error } = await sb.rpc('get_tps_overview', { p_election_id: state.election.id });
    if (error) {
      showToast('Gagal muat data TPS: ' + error.message, 'error');
      return;
    }
    state.rows = data || [];
    renderRows();
  }

  async function transition(row, newStatus, reason) {
    const { error } = await sb.rpc('set_tps_status', {
      p_tps_id: row.tps_id,
      p_new_status: newStatus,
      p_reason: reason || null,
    });
    if (error) {
      showToast('Gagal ubah status: ' + error.message, 'error');
      return;
    }
    showToast(`TPS ${padTps(row.tps_number)} → ${statusLabelId(newStatus)}`, 'success');
    await loadOverview();
  }

  async function verify(row) {
    const note = window.prompt(`Catatan verifikasi TPS ${padTps(row.tps_number)} (opsional):`, '');
    if (note === null) return; // cancelled
    const { error } = await sb.rpc('verify_tps', { p_tps_id: row.tps_id, p_note: note || null });
    if (error) {
      showToast('Gagal verifikasi: ' + error.message, 'error');
      return;
    }
    showToast(`TPS ${padTps(row.tps_number)} terverifikasi.`, 'success');
    await loadOverview();
  }

  async function unlock(row) {
    const reason = window.prompt(`Alasan buka kunci TPS ${padTps(row.tps_number)} (wajib diisi):`, '');
    if (reason === null) return; // cancelled
    if (!reason.trim()) {
      showToast('Alasan wajib diisi untuk buka kunci.', 'error');
      return;
    }
    await transition(row, 'counting', reason.trim());
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
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.id = 'tpsLoading';
    empty.textContent = 'Memuat data TPS...';
    el.table.appendChild(empty);
    await loadOverview();
  }

  init();
})();
