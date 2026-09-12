// Export: CSV downloads (client-generated, no library) + a print-formatted PDF report
// via the browser's own print dialog. Every export is logged to activity_logs.
(function () {
  const state = {
    election: null,
  };

  const el = {
    toast: document.getElementById('toast'),
    printContent: document.getElementById('printReport-content'),
  };

  function showToast(message, type) {
    el.toast.textContent = message;
    el.toast.className = type || '';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.toast.className = 'hidden'; }, 3000);
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(rows) {
    return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  }

  function downloadCsv(filename, rows) {
    const csv = '﻿' + toCsv(rows); // BOM so Excel opens UTF-8 correctly
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function pct(count, total) {
    if (!total) return '0.00';
    return ((count / total) * 100).toFixed(2);
  }

  async function logExport(kind) {
    await sb.rpc('log_activity', {
      p_election_id: state.election.id,
      p_action: 'export_generated',
      p_entity_type: kind,
      p_details: null,
    });
  }

  async function exportOverall() {
    const { data, error } = await sb.rpc('get_overall_summary', { p_election_id: state.election.id });
    if (error) return showToast('Gagal ambil data: ' + error.message, 'error');

    const { data: overview, error: ovError } = await sb.rpc('get_tps_overview', { p_election_id: state.election.id });
    if (ovError) return showToast('Gagal ambil data TPS: ' + ovError.message, 'error');

    const totalValid = overview.reduce((s, r) => s + Number(r.valid_votes), 0);
    const totalInvalid = overview.reduce((s, r) => s + Number(r.invalid_votes), 0);

    const rows = [
      ['No Urut', 'Nama Calon', 'Total Suara', 'Persentase (%)'],
      ...data.map((c) => [c.candidate_number, c.name, c.vote_count, pct(c.vote_count, totalValid)]),
      [],
      ['Total Suara Sah', totalValid],
      ['Total Suara Tidak Sah', totalInvalid],
      ['Total Suara Masuk', totalValid + totalInvalid],
    ];

    downloadCsv(`hasil-keseluruhan-${dateStamp()}.csv`, rows);
    await logExport('overall_summary');
    showToast('CSV hasil keseluruhan terunduh.', 'success');
  }

  async function exportPerTps() {
    const { data: candidates, error: cError } = await sb
      .from('candidates')
      .select('id, candidate_number, name')
      .eq('election_id', state.election.id)
      .eq('is_active', true)
      .order('candidate_number');
    if (cError) return showToast('Gagal ambil kandidat: ' + cError.message, 'error');

    const { data: overview, error } = await sb.rpc('get_tps_overview', { p_election_id: state.election.id });
    if (error) return showToast('Gagal ambil data TPS: ' + error.message, 'error');

    // per-tps per-candidate breakdown needs the raw summary table (public-readable)
    const { data: summaryRows, error: sError } = await sb
      .from('vote_summary')
      .select('tps_id, candidate_id, vote_count')
      .eq('election_id', state.election.id);
    if (sError) return showToast('Gagal ambil rincian suara: ' + sError.message, 'error');

    const byTps = {};
    summaryRows.forEach((r) => {
      byTps[r.tps_id] = byTps[r.tps_id] || {};
      byTps[r.tps_id][r.candidate_id || 'invalid'] = r.vote_count;
    });

    const header = [
      'TPS', 'Status', 'Terverifikasi',
      ...candidates.map((c) => `Calon ${c.candidate_number}`),
      'Tidak Sah', 'Sah', 'Total', 'Batas DPT',
    ];

    const rows = [header, ...overview.map((row) => {
      const perCandidate = byTps[row.tps_id] || {};
      return [
        padTps(row.tps_number),
        statusLabelId(row.status),
        row.is_verified ? 'Ya' : 'Tidak',
        ...candidates.map((c) => perCandidate[c.id] || 0),
        row.invalid_votes,
        row.valid_votes,
        row.total_votes,
        row.dpt_limit ?? '',
      ];
    })];

    downloadCsv(`hasil-per-tps-${dateStamp()}.csv`, rows);
    await logExport('per_tps_result');
    showToast('CSV hasil per TPS terunduh.', 'success');
  }

  async function exportLogs() {
    const { data, error } = await sb
      .from('activity_logs')
      .select('created_at, action, entity_type, entity_id, details, profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) return showToast('Gagal ambil log: ' + error.message, 'error');

    const rows = [
      ['Waktu', 'Aksi', 'Entitas', 'Aktor', 'Detail'],
      ...data.map((r) => [
        new Date(r.created_at).toLocaleString('id-ID'),
        r.action,
        r.entity_type || '',
        r.profiles ? r.profiles.full_name : '',
        r.details ? JSON.stringify(r.details) : '',
      ]),
    ];

    downloadCsv(`log-aktivitas-${dateStamp()}.csv`, rows);
    await logExport('activity_log');
    showToast('CSV log aktivitas terunduh.', 'success');
  }

  async function printReport() {
    const [{ data: candidates }, { data: overall }, { data: overview }] = await Promise.all([
      sb.from('candidates').select('id, candidate_number, name').eq('election_id', state.election.id).eq('is_active', true).order('candidate_number'),
      sb.rpc('get_overall_summary', { p_election_id: state.election.id }),
      sb.rpc('get_tps_overview', { p_election_id: state.election.id }),
    ]);

    const totalValid = overview.reduce((s, r) => s + Number(r.valid_votes), 0);
    const totalInvalid = overview.reduce((s, r) => s + Number(r.invalid_votes), 0);
    const tpsLocked = overview.filter((r) => r.status === 'locked').length;

    el.printContent.innerHTML = `
      <h1>${escapeHtml(state.election.name)} — Laporan Rekapitulasi</h1>
      <p>${escapeHtml(state.election.village_name)} · Dicetak ${new Date().toLocaleString('id-ID')}</p>
      <p>TPS terkunci: ${tpsLocked} / ${overview.length} · Suara sah: ${totalValid} · Tidak sah: ${totalInvalid} · Total: ${totalValid + totalInvalid}</p>

      <h2>Hasil Keseluruhan</h2>
      <table>
        <thead><tr><th>No</th><th>Calon</th><th>Suara</th><th>%</th></tr></thead>
        <tbody>
          ${overall.map((c) => `<tr><td>${c.candidate_number}</td><td>${escapeHtml(c.name)}</td><td>${c.vote_count}</td><td>${pct(c.vote_count, totalValid)}%</td></tr>`).join('')}
        </tbody>
      </table>

      <h2>Hasil per TPS</h2>
      <table>
        <thead><tr><th>TPS</th><th>Status</th><th>Verifikasi</th><th>Sah</th><th>Tidak Sah</th><th>Total</th></tr></thead>
        <tbody>
          ${overview.map((r) => `<tr><td>${padTps(r.tps_number)}</td><td>${statusLabelId(r.status)}</td><td>${r.is_verified ? 'Ya' : 'Tidak'}</td><td>${r.valid_votes}</td><td>${r.invalid_votes}</td><td>${r.total_votes}</td></tr>`).join('')}
        </tbody>
      </table>

      <p>Data pada sistem merupakan rekapitulasi hasil input penghitungan TPS. Penetapan hasil resmi mengikuti ketentuan panitia pemilihan.</p>
    `;

    await logExport('pdf_report');
    window.print();
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function dateStamp() {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  }

  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = '../login.html';
      return;
    }

    const { data: election, error } = await sb
      .from('elections')
      .select('id, name, village_name')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !election) {
      showToast('Election aktif tidak ditemukan.', 'error');
      return;
    }
    state.election = election;

    document.getElementById('exportOverall').addEventListener('click', exportOverall);
    document.getElementById('exportPerTps').addEventListener('click', exportPerTps);
    document.getElementById('exportLogs').addEventListener('click', exportLogs);
    document.getElementById('printReport').addEventListener('click', printReport);
  }

  init();
})();
