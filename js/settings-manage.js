// Election-level settings: name, village, status. Single active election per deployment.
(function () {
  const state = { election: null };

  const el = {
    name: document.getElementById('fieldElectionName'),
    village: document.getElementById('fieldVillageName'),
    status: document.getElementById('fieldElectionStatus'),
    saveBtn: document.getElementById('saveSettingsBtn'),
    toast: document.getElementById('toast'),
  };

  function showToast(message, type) {
    el.toast.textContent = message;
    el.toast.className = type || '';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.className = 'hidden'; }, 3000);
  }

  async function logActivity(action, details) {
    await sb.rpc('log_activity', {
      p_election_id: state.election.id,
      p_action: action,
      p_entity_type: 'elections',
      p_details: details || null,
    });
  }

  el.saveBtn.addEventListener('click', async () => {
    const name = el.name.value.trim();
    const village = el.village.value.trim();
    const status = el.status.value;

    if (!name) {
      showToast('Nama pemilihan wajib diisi.', 'error');
      return;
    }

    el.saveBtn.disabled = true;
    const { error } = await sb
      .from('elections')
      .update({ name, village_name: village || null, status })
      .eq('id', state.election.id);
    el.saveBtn.disabled = false;

    if (error) {
      showToast('Gagal simpan: ' + error.message, 'error');
      return;
    }
    await logActivity('settings_changed', { name, village_name: village, status });
    showToast('Pengaturan tersimpan.', 'success');
  });

  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = '../login.html';
      return;
    }

    const { data: election, error } = await sb
      .from('elections')
      .select('id, name, village_name, status')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !election) {
      showToast('Election aktif tidak ditemukan.', 'error');
      return;
    }
    state.election = election;
    el.name.value = election.name || '';
    el.village.value = election.village_name || '';
    el.status.value = election.status || 'setup';
  }

  init();
})();
