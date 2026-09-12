// Snapshot & backup: manual trigger + list + JSON download. Recovery aid only —
// never a replacement for the vote_events audit trail.
(function () {
  const state = {
    election: null,
  };

  const el = {
    table: document.getElementById('snapshotTable'),
    createBtn: document.getElementById('createSnapshotBtn'),
    toast: document.getElementById('toast'),
  };

  function showToast(message, type) {
    el.toast.textContent = message;
    el.toast.className = type || '';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.className = 'hidden'; }, 3000);
  }

  function tallyFromSnapshot(json) {
    const valid = (json.tps || []).reduce((s, r) => s + Number(r.valid_votes || 0), 0);
    const invalid = (json.tps || []).reduce((s, r) => s + Number(r.invalid_votes || 0), 0);
    return { valid, invalid, total: valid + invalid };
  }

  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function renderRows(rows) {
    el.table.querySelectorAll('.snapshot-row:not(.head)').forEach((n) => n.remove());

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Belum ada snapshot.';
      el.table.appendChild(empty);
      return;
    }

    rows.forEach((row) => {
      const tally = tallyFromSnapshot(row.snapshot_json);
      const div = document.createElement('div');
      div.className = 'snapshot-row';
      div.innerHTML = `
        <span class="time">${new Date(row.created_at).toLocaleString('id-ID')}</span>
        <span class="val">${tally.valid}</span>
        <span class="val">${tally.invalid}</span>
        <span class="val">${tally.total}</span>
        <span class="dl"><button>Unduh JSON</button></span>
      `;
      div.querySelector('button').addEventListener('click', () => {
        downloadJson(`snapshot-${row.created_at.replace(/[:.]/g, '-')}.json`, row.snapshot_json);
      });
      el.table.appendChild(div);
    });
  }

  async function loadSnapshots() {
    const { data, error } = await sb
      .from('snapshots')
      .select('id, created_at, snapshot_json')
      .eq('election_id', state.election.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      showToast('Gagal muat snapshot: ' + error.message, 'error');
      return;
    }
    renderRows(data || []);
  }

  async function createSnapshot() {
    el.createBtn.disabled = true;
    const { error } = await sb.rpc('create_snapshot', { p_election_id: state.election.id });
    el.createBtn.disabled = false;

    if (error) {
      showToast('Gagal buat snapshot: ' + error.message, 'error');
      return;
    }
    showToast('Snapshot berhasil dibuat.', 'success');
    await loadSnapshots();
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

    el.createBtn.addEventListener('click', createSnapshot);
    await loadSnapshots();
  }

  init();
})();
