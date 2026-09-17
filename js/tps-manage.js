// TPS workflow: status transitions, verify, lock, unlock.
(function () {
  const state = {
    election: null,
    rows: [],
    editingTpsId: null,
  };

  const el = {
    table: document.getElementById('tpsTable'),
    toast: document.getElementById('toast'),
    addBtn: document.getElementById('addTpsBtn'),
    form: document.getElementById('tpsForm'),
    formTitle: document.getElementById('tpsFormTitle'),
    cancelFormBtn: document.getElementById('cancelTpsFormBtn'),
    saveFormBtn: document.getElementById('saveTpsFormBtn'),
    fieldNumber: document.getElementById('fieldTpsNumber'),
    fieldName: document.getElementById('fieldTpsName'),
    fieldDpt: document.getElementById('fieldTpsDpt'),
  };

  async function logActivity(action, entityId, details) {
    await sb.rpc('log_activity', {
      p_election_id: state.election.id,
      p_action: action,
      p_entity_type: 'tps',
      p_details: details || null,
    });
  }

  // --- add / edit form ---

  function nextSuggestedTpsNumber() {
    const used = state.rows.map((r) => r.tps_number);
    let n = 1;
    while (used.includes(n)) n++;
    return n;
  }

  function openForm(row) {
    state.editingTpsId = row ? row.tps_id : null;
    el.formTitle.textContent = row ? `Ubah TPS ${padTps(row.tps_number)}` : 'Tambah TPS';
    el.fieldNumber.value = row ? row.tps_number : nextSuggestedTpsNumber();
    el.fieldNumber.disabled = !!row;
    el.fieldName.value = row ? (row.name || '') : '';
    el.fieldDpt.value = row && row.dpt_limit ? row.dpt_limit : '';
    el.form.classList.remove('hidden');
    el.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeForm() {
    el.form.classList.add('hidden');
    state.editingTpsId = null;
  }

  el.addBtn.addEventListener('click', () => openForm(null));
  el.cancelFormBtn.addEventListener('click', closeForm);

  el.saveFormBtn.addEventListener('click', async () => {
    const number = Number(el.fieldNumber.value);
    const name = el.fieldName.value.trim() || null;
    const dptRaw = el.fieldDpt.value.trim();
    const dpt = dptRaw ? Number(dptRaw) : null;

    if (!number || number < 1) {
      showToast('Nomor TPS wajib diisi.', 'error');
      return;
    }
    if (dptRaw && (!dpt || dpt < 1)) {
      showToast('Batas DPT harus angka positif.', 'error');
      return;
    }

    el.saveFormBtn.disabled = true;
    let error;
    if (state.editingTpsId) {
      ({ error } = await sb.from('tps').update({ name, dpt_limit: dpt }).eq('id', state.editingTpsId));
    } else {
      ({ error } = await sb.from('tps').insert({
        election_id: state.election.id,
        tps_number: number,
        name,
        dpt_limit: dpt,
      }));
    }
    el.saveFormBtn.disabled = false;

    if (error) {
      const msg = error.code === '23505' ? `TPS nomor ${number} sudah ada.` : error.message;
      showToast('Gagal simpan: ' + msg, 'error');
      return;
    }

    await logActivity(state.editingTpsId ? 'tps_updated' : 'tps_added', null, { tps_number: number, name, dpt_limit: dpt });
    showToast(`TPS ${padTps(number)} tersimpan.`, 'success');
    closeForm();
    await loadOverview();
  });

  // --- delete ---

  async function deleteTps(row) {
    if (row.total_votes > 0) {
      showToast('TPS dengan suara masuk tidak bisa dihapus.', 'error');
      return;
    }
    if (!window.confirm(`Hapus TPS ${padTps(row.tps_number)}? Aksi ini tidak bisa dibatalkan.`)) return;

    const { error } = await sb.from('tps').delete().eq('id', row.tps_id);
    if (error) {
      showToast('Gagal hapus: ' + error.message, 'error');
      return;
    }
    await logActivity('tps_deleted', null, { tps_number: row.tps_number });
    showToast(`TPS ${padTps(row.tps_number)} dihapus.`, 'success');
    await loadOverview();
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

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
    actions.push({ label: 'Ubah', fn: () => openForm(row) });
    if (row.status === 'not_started' && row.total_votes === 0) {
      actions.push({ label: 'Hapus', fn: () => deleteTps(row) });
    }
    return actions;
  }

  function renderRows() {
    document.getElementById('tpsLoading')?.remove();
    el.table.querySelectorAll('.tps-row:not(.head)').forEach((n) => n.remove());

    state.rows.forEach((row) => {
      const over = row.dpt_limit && row.total_votes > row.dpt_limit;
      const pct = row.dpt_limit ? Math.round((row.total_votes / row.dpt_limit) * 100) : null;
      const el2 = document.createElement('div');
      el2.className = 'tps-row';
      el2.innerHTML = `
        <span class="num">${padTps(row.tps_number)}</span>
        <span class="badge status-${row.status}">${statusLabelId(row.status)}</span>
        <span>
          ${row.name ? `<div class="tps-meta">${escapeHtml(row.name)}</div>` : ''}
          ${row.is_verified ? '<span class="verified-mark">✓ terverifikasi</span>' : ''}
          ${pct !== null ? `<div class="dpt-turnout">${pct}% dari DPT (${row.total_votes}/${row.dpt_limit})</div>` : ''}
          ${over ? `<div class="limit-warning">Melebihi DPT (${row.total_votes}/${row.dpt_limit})</div>` : ''}
        </span>
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
    const [{ data, error }, { data: names }] = await Promise.all([
      sb.rpc('get_tps_overview', { p_election_id: state.election.id }),
      sb.from('tps').select('id, name').eq('election_id', state.election.id),
    ]);
    if (error) {
      showToast('Gagal muat data TPS: ' + error.message, 'error');
      return;
    }
    const nameById = {};
    (names || []).forEach((r) => { nameById[r.id] = r.name; });
    state.rows = (data || []).map((r) => ({ ...r, name: nameById[r.tps_id] || null }));
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
