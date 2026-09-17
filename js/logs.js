// Activity log viewer: read-only, paginated, newest first.
(function () {
  const PAGE_SIZE = 50;

  const state = {
    offset: 0,
    actionFilter: '',
    knownActions: new Set(),
    exhausted: false,
  };

  const el = {
    table: document.getElementById('logsTable'),
    actionFilter: document.getElementById('actionFilter'),
    loadMoreBtn: document.getElementById('loadMoreBtn'),
    toast: document.getElementById('toast'),
  };

  function showToast(message, type) {
    el.toast.textContent = message;
    el.toast.className = type || '';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.className = 'hidden'; }, 3000);
  }

  // Detail fields worth showing to a human, in plain Indonesian. IDs (tps_id,
  // candidate_id, ...) are internal references — not shown, they mean nothing on sight.
  const DETAIL_LABELS_ID = {
    vote_type: 'Jenis suara',
    new_status: 'Status baru',
    reason: 'Alasan',
    note: 'Catatan',
  };

  function formatDetailValue(key, value) {
    if (key === 'vote_type') return value === 'invalid' ? 'Tidak sah' : 'Sah';
    if (key === 'new_status') return statusLabelId(value);
    return value;
  }

  function formatDetails(details) {
    if (!details) return '—';
    try {
      const parts = Object.entries(details)
        .filter(([k, v]) => DETAIL_LABELS_ID[k] && v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${DETAIL_LABELS_ID[k]}: ${formatDetailValue(k, v)}`);
      return parts.length ? parts.join(' · ') : '—';
    } catch (_) {
      return '—';
    }
  }

  function addKnownAction(action) {
    if (state.knownActions.has(action)) return;
    state.knownActions.add(action);
    const opt = document.createElement('option');
    opt.value = action;
    opt.textContent = actionLabelId(action);
    el.actionFilter.appendChild(opt);
  }

  function renderRows(rows, append) {
    if (!append) {
      el.table.querySelectorAll('.log-row:not(.head)').forEach((n) => n.remove());
    }

    if (rows.length === 0 && !append) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Belum ada aktivitas.';
      el.table.appendChild(empty);
      return;
    }

    rows.forEach((row) => {
      addKnownAction(row.action);
      const actorName = row.profiles ? row.profiles.full_name : '—';
      const div = document.createElement('div');
      div.className = 'log-row';
      div.innerHTML = `
        <span class="time">${formatTime(new Date(row.created_at))}</span>
        <span class="action">${escapeHtml(actionLabelId(row.action))}</span>
        <span class="entity">${escapeHtml(entityLabelId(row.entity_type))} ${actorName !== '—' ? '· ' + escapeHtml(actorName) : ''}</span>
        <span class="details">${escapeHtml(formatDetails(row.details))}</span>
      `;
      el.table.appendChild(div);
    });
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  async function loadPage(append) {
    if (!append) {
      state.offset = 0;
      state.exhausted = false;
    }

    let query = sb
      .from('activity_logs')
      .select('id, action, entity_type, entity_id, details, created_at, profiles(full_name)')
      .order('created_at', { ascending: false })
      .range(state.offset, state.offset + PAGE_SIZE - 1);

    if (state.actionFilter) {
      query = query.eq('action', state.actionFilter);
    }

    const { data, error } = await query;

    if (error) {
      showToast('Gagal muat log: ' + error.message, 'error');
      el.loadMoreBtn.classList.add('hidden');
      if (!append) renderRows([], false);
      return;
    }

    renderRows(data || [], append);
    state.offset += PAGE_SIZE;
    state.exhausted = (data || []).length < PAGE_SIZE;
    el.loadMoreBtn.classList.toggle('hidden', state.exhausted);
  }

  // known action vocabulary (from the RPCs that write activity_logs), so the filter
  // is complete on first paint instead of growing only as pages happen to include them
  const KNOWN_ACTIONS = [
    'vote_added', 'vote_cancelled',
    'tps_counting_started', 'tps_paused', 'tps_completed', 'tps_locked', 'tps_unlocked',
    'verification_performed', 'export_generated', 'snapshot_created',
    'candidate_added', 'candidate_updated', 'candidate_deleted',
    'tally_bulk_adjusted',
  ];

  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = '../login.html';
      return;
    }

    KNOWN_ACTIONS.forEach(addKnownAction);

    el.actionFilter.addEventListener('change', () => {
      state.actionFilter = el.actionFilter.value;
      loadPage(false);
    });

    el.loadMoreBtn.addEventListener('click', () => loadPage(true));

    await loadPage(false);
  }

  init();
})();
