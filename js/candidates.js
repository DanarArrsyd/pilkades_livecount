// Kelola Paslon: candidate CRUD (number, 1-3 names, photo, description, active flag).
// Photos go to Supabase Storage bucket "candidate-photos" (public read, admin write).
(function () {
  const MAX_NAMES = 3;
  const BUCKET = 'candidate-photos';

  const state = {
    election: null,
    candidates: [],
    editingId: null,
    pendingPhotoFile: null,
    pendingPhotoUrl: null,
  };

  const el = {
    list: document.getElementById('candidateList'),
    form: document.getElementById('candidateForm'),
    formTitle: document.getElementById('formTitle'),
    addBtn: document.getElementById('addCandidateBtn'),
    cancelBtn: document.getElementById('cancelFormBtn'),
    saveBtn: document.getElementById('saveFormBtn'),
    fieldNumber: document.getElementById('fieldNumber'),
    nameFields: document.getElementById('nameFields'),
    addNameBtn: document.getElementById('addNameBtn'),
    fieldPhotoInput: document.getElementById('fieldPhotoInput'),
    photoPreview: document.getElementById('photoPreview'),
    photoUploadStatus: document.getElementById('photoUploadStatus'),
    fieldDescription: document.getElementById('fieldDescription'),
    fieldActive: document.getElementById('fieldActive'),
    toast: document.getElementById('toast'),
  };

  function showToast(message, type) {
    el.toast.textContent = message;
    el.toast.className = type || '';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.className = 'hidden'; }, 3000);
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  async function logActivity(action, entityId, details) {
    await sb.rpc('log_activity', {
      p_election_id: state.election.id,
      p_action: action,
      p_entity_type: 'candidates',
      p_details: details || null,
    });
  }

  // --- name field rows (1-3, dynamic add/remove) ---

  function renderNameFields(names) {
    el.nameFields.innerHTML = '';
    const initial = names && names.length ? names : [''];
    initial.forEach((n) => addNameFieldRow(n));
    updateAddNameBtnVisibility();
  }

  function addNameFieldRow(value) {
    if (el.nameFields.children.length >= MAX_NAMES) return;
    const row = document.createElement('div');
    row.className = 'name-field-row';
    row.innerHTML = `
      <input type="text" class="name-input" placeholder="Nama (mis. Kepala Desa / Wakil)" value="${escapeHtml(value || '')}" />
      <button type="button" class="remove-name-btn">Hapus</button>
    `;
    row.querySelector('.remove-name-btn').addEventListener('click', () => {
      if (el.nameFields.children.length <= 1) return;
      row.remove();
      updateAddNameBtnVisibility();
    });
    el.nameFields.appendChild(row);
    updateAddNameBtnVisibility();
  }

  function updateAddNameBtnVisibility() {
    el.addNameBtn.classList.toggle('hidden', el.nameFields.children.length >= MAX_NAMES);
  }

  function getNameValues() {
    return [...el.nameFields.querySelectorAll('.name-input')]
      .map((i) => i.value.trim())
      .filter(Boolean);
  }

  el.addNameBtn.addEventListener('click', () => addNameFieldRow(''));

  // --- photo ---

  el.fieldPhotoInput.addEventListener('change', () => {
    const file = el.fieldPhotoInput.files[0];
    if (!file) return;
    state.pendingPhotoFile = file;
    el.photoPreview.src = URL.createObjectURL(file);
    el.photoPreview.style.visibility = 'visible';
    el.photoUploadStatus.textContent = 'Foto baru dipilih — diunggah saat disimpan.';
  });

  async function uploadPhotoIfNeeded() {
    if (!state.pendingPhotoFile) return state.pendingPhotoUrl;

    el.photoUploadStatus.textContent = 'Mengunggah foto...';
    const file = state.pendingPhotoFile;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${crypto.randomUUID()}.${ext}`;

    const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (error) {
      showToast('Gagal unggah foto: ' + error.message, 'error');
      throw error;
    }

    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    el.photoUploadStatus.textContent = 'Foto terunggah.';
    return data.publicUrl;
  }

  // --- form open/close ---

  function openForm(candidate) {
    state.editingId = candidate ? candidate.id : null;
    state.pendingPhotoFile = null;
    state.pendingPhotoUrl = candidate ? candidate.photo_url : null;

    el.formTitle.textContent = candidate ? `Ubah Paslon No. ${candidate.candidate_number}` : 'Tambah Paslon';
    el.fieldNumber.value = candidate ? candidate.candidate_number : (nextSuggestedNumber());
    renderNameFields(candidate && candidate.names && candidate.names.length ? candidate.names : (candidate ? [candidate.name] : ['']));
    const previewUrl = candidate && candidate.photo_url ? candidate.photo_url : '';
    el.photoPreview.src = previewUrl;
    el.photoPreview.style.visibility = previewUrl ? 'visible' : 'hidden';
    el.photoUploadStatus.textContent = '';
    el.fieldPhotoInput.value = '';
    el.fieldDescription.value = candidate ? (candidate.description || '') : '';
    el.fieldActive.checked = candidate ? candidate.is_active : true;

    el.form.classList.remove('hidden');
    el.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeForm() {
    el.form.classList.add('hidden');
    state.editingId = null;
    state.pendingPhotoFile = null;
  }

  function nextSuggestedNumber() {
    const used = state.candidates.map((c) => c.candidate_number);
    let n = 1;
    while (used.includes(n)) n++;
    return n;
  }

  el.addBtn.addEventListener('click', () => openForm(null));
  el.cancelBtn.addEventListener('click', closeForm);

  // --- save (insert or update) ---

  el.saveBtn.addEventListener('click', async () => {
    const number = Number(el.fieldNumber.value);
    const names = getNameValues();

    if (!number || number < 1) {
      showToast('Nomor urut wajib diisi.', 'error');
      return;
    }
    if (names.length === 0) {
      showToast('Minimal satu nama wajib diisi.', 'error');
      return;
    }

    el.saveBtn.disabled = true;
    let photoUrl;
    try {
      photoUrl = await uploadPhotoIfNeeded();
    } catch (_) {
      el.saveBtn.disabled = false;
      return;
    }

    const payload = {
      candidate_number: number,
      name: names.join(' & '),
      names,
      photo_url: photoUrl || null,
      description: el.fieldDescription.value.trim() || null,
      is_active: el.fieldActive.checked,
    };

    let error;
    if (state.editingId) {
      ({ error } = await sb.from('candidates').update(payload).eq('id', state.editingId));
    } else {
      payload.election_id = state.election.id;
      ({ error } = await sb.from('candidates').insert(payload));
    }

    el.saveBtn.disabled = false;

    if (error) {
      showToast('Gagal simpan: ' + error.message, 'error');
      return;
    }

    await logActivity(state.editingId ? 'candidate_updated' : 'candidate_added', null, { candidate_number: number, name: payload.name });
    showToast('Paslon tersimpan.', 'success');
    closeForm();
    await loadCandidates();
  });

  // --- delete ---

  async function deleteCandidate(candidate) {
    if (!window.confirm(`Hapus paslon No. ${candidate.candidate_number} — ${candidate.name}? Aksi ini tidak bisa dibatalkan.`)) return;

    const { error } = await sb.from('candidates').delete().eq('id', candidate.id);
    if (error) {
      showToast('Gagal hapus: ' + error.message, 'error');
      return;
    }
    await logActivity('candidate_deleted', null, { candidate_number: candidate.candidate_number, name: candidate.name });
    showToast('Paslon dihapus.', 'success');
    await loadCandidates();
  }

  // --- list ---

  function renderList() {
    el.list.innerHTML = state.candidates.map((c) => {
      const initials = (c.names && c.names[0] ? c.names[0] : c.name).charAt(0).toUpperCase();
      const photo = c.photo_url
        ? `<img class="photo" src="${escapeHtml(c.photo_url)}" alt="" />`
        : `<div class="photo">${initials}</div>`;
      const namesHtml = (c.names && c.names.length ? c.names : [c.name]).map(escapeHtml).join('<br>');
      return `
        <div class="candidate-item ${c.is_active ? '' : 'inactive'}">
          ${photo}
          <div class="num">Calon No. ${c.candidate_number}${c.is_active ? '' : ' · Nonaktif'}</div>
          <div class="names">${namesHtml}</div>
          ${c.description ? `<div class="desc">${escapeHtml(c.description)}</div>` : ''}
          <div class="item-actions">
            <button data-action="edit">Ubah</button>
            <button data-action="delete">Hapus</button>
          </div>
        </div>
      `;
    }).join('');

    [...el.list.children].forEach((node, i) => {
      const candidate = state.candidates[i];
      node.querySelector('[data-action="edit"]').addEventListener('click', () => openForm(candidate));
      node.querySelector('[data-action="delete"]').addEventListener('click', () => deleteCandidate(candidate));
    });
  }

  async function loadCandidates() {
    const { data, error } = await sb
      .from('candidates')
      .select('id, candidate_number, name, names, photo_url, description, is_active')
      .eq('election_id', state.election.id)
      .order('candidate_number');

    if (error) {
      showToast('Gagal muat data paslon: ' + error.message, 'error');
      return;
    }
    state.candidates = data || [];
    renderList();
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

    renderNameFields(['']);
    await loadCandidates();
  }

  init();
})();
