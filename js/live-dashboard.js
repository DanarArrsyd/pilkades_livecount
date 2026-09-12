// Public live dashboard: read-only, realtime-refreshed. No auth required —
// every query here hits public RLS policies (candidates/tps/vote_summary select-all).
(function () {
  const REFRESH_THROTTLE_MS = 800;

  const state = {
    election: null,
    candidates: [],
    dirty: false,
    chart: null,
  };

  const el = {
    eyebrow: document.getElementById('electionEyebrow'),
    name: document.getElementById('electionName'),
    village: document.getElementById('electionVillage'),
    resultStatus: document.getElementById('resultStatus'),
    statTpsDone: document.getElementById('statTpsDone'),
    statValid: document.getElementById('statValid'),
    statInvalid: document.getElementById('statInvalid'),
    candidateGrid: document.getElementById('candidateGrid'),
    tpsProgressGrid: document.getElementById('tpsProgressGrid'),
    tpsTableHeadRow: document.getElementById('tpsTableHeadRow'),
    tpsTableBody: document.getElementById('tpsTableBody'),
    updatedAt: document.getElementById('updatedAt'),
  };

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function pct(count, total) {
    if (!total) return '0.00';
    return ((count / total) * 100).toFixed(2);
  }

  function renderHeader(overview, overall) {
    const total = overview.length;
    const done = overview.filter((r) => r.status === 'locked' || r.status === 'completed').length;
    const allLocked = total > 0 && overview.every((r) => r.status === 'locked');

    el.statTpsDone.textContent = `${done} / ${total}`;

    const totalValid = overview.reduce((s, r) => s + Number(r.valid_votes), 0);
    const totalInvalid = overview.reduce((s, r) => s + Number(r.invalid_votes), 0);
    animateNumber(el.statValid, totalValid, 600);
    animateNumber(el.statInvalid, totalInvalid, 600);

    if (allLocked) {
      el.resultStatus.classList.add('final');
      el.resultStatus.querySelector('span:last-child').textContent = `PENGHITUNGAN SELESAI · ${total} / ${total} TPS`;
    } else {
      el.resultStatus.classList.remove('final');
      el.resultStatus.querySelector('span:last-child').textContent = 'HASIL SEMENTARA';
    }
    el.resultStatus.classList.toggle('live', !allLocked);

    return { totalValid, totalInvalid };
  }

  function renderCandidates(overall, totalValid) {
    const ranked = [...overall].sort((a, b) => b.vote_count - a.vote_count);
    const rankOf = {};
    ranked.forEach((c, i) => { rankOf[c.candidate_id] = i + 1; });

    if (!state.candidateCardsBuilt) {
      el.candidateGrid.innerHTML = overall.map((c) => {
        const candidateMeta = state.candidates.find((x) => x.id === c.candidate_id) || {};
        const photo = candidateMeta.photo_url
          ? `<img src="${escapeHtml(candidateMeta.photo_url)}" alt="" />`
          : c.candidate_number;
        return `
          <div class="candidate-card">
            <span class="rank" id="rank-${c.candidate_id}">#${rankOf[c.candidate_id]}</span>
            <div class="avatar">${photo}</div>
            <div class="cand-number">CALON ${c.candidate_number}</div>
            <div class="cand-name">${escapeHtml(c.name)}</div>
            <div class="cand-votes" id="votes-${c.candidate_id}">0</div>
            <div class="cand-pct" id="pct-${c.candidate_id}">0.00%</div>
            <div class="progress-track"><div class="progress-fill" id="fill-${c.candidate_id}" style="width:0%"></div></div>
          </div>
        `;
      }).join('');
      state.candidateCardsBuilt = true;
    }

    overall.forEach((c) => {
      const p = pct(c.vote_count, totalValid);
      const votesEl = document.getElementById(`votes-${c.candidate_id}`);
      if (votesEl) animateNumber(votesEl, c.vote_count, 600);
      const pctEl = document.getElementById(`pct-${c.candidate_id}`);
      if (pctEl) pctEl.textContent = p + '%';
      const fillEl = document.getElementById(`fill-${c.candidate_id}`);
      if (fillEl) fillEl.style.width = p + '%';
      const rankEl = document.getElementById(`rank-${c.candidate_id}`);
      if (rankEl) rankEl.textContent = '#' + rankOf[c.candidate_id];
    });
  }

  function renderChart(overall) {
    const ctx = document.getElementById('overallChart');
    const labels = overall.map((c) => `${c.candidate_number}. ${c.name}`);
    const data = overall.map((c) => c.vote_count);

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets[0].data = data;
      state.chart.update();
      return;
    }

    state.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: '#0d1b3e',
          hoverBackgroundColor: '#1a2b4a',
          borderRadius: 4,
          maxBarThickness: 42,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 900,
          easing: 'easeOutQuart',
          delay: (ctx) => ctx.type === 'data' ? ctx.dataIndex * 90 : 0,
        },
        transitions: {
          active: { animation: { duration: 300 } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0d1b3e',
            titleFont: { weight: 'bold' },
            padding: 10,
            cornerRadius: 6,
            displayColors: false,
            callbacks: {
              label: (ctx) => `${ctx.parsed.x.toLocaleString('id-ID')} suara`,
            },
          },
        },
        scales: {
          x: { ticks: { color: '#4b5570' }, grid: { color: '#e3e5eb' }, beginAtZero: true },
          y: { ticks: { color: '#0d1b3e', font: { weight: 'bold' } }, grid: { display: false } },
        },
      },
    });
  }

  function renderTpsProgress(overview) {
    el.tpsProgressGrid.innerHTML = overview.map((r) => {
      const cls = (r.status === 'locked' || r.status === 'completed') ? 'locked' : r.status;
      return `<a class="tps-dot ${cls}" href="live/tps.html?n=${r.tps_number}">${padTps(r.tps_number)}</a>`;
    }).join('');
  }

  function renderTpsTable(overview, byTps) {
    el.tpsTableHeadRow.innerHTML = [
      '<th>TPS</th>',
      ...state.candidates.map((c) => `<th>C${c.candidate_number}</th>`),
      '<th>TS</th>', '<th>Sah</th>', '<th>Total</th>', '<th>Status</th>',
    ].join('');

    el.tpsTableBody.innerHTML = overview.map((r) => {
      const over = r.dpt_limit && r.total_votes > r.dpt_limit;
      const perCandidate = byTps[r.tps_id] || {};
      return `
        <tr class="${over ? 'over-limit' : ''}">
          <td><a href="live/tps.html?n=${r.tps_number}">${padTps(r.tps_number)}</a></td>
          ${state.candidates.map((c) => `<td>${perCandidate[c.id] || 0}</td>`).join('')}
          <td>${r.invalid_votes}</td>
          <td>${r.valid_votes}</td>
          <td>${r.total_votes}</td>
          <td>${statusLabelId(r.status)}</td>
        </tr>
      `;
    }).join('');
  }

  async function refresh() {
    const [{ data: overview, error: ovErr }, { data: overall, error: ovaErr }, { data: summaryRows }] = await Promise.all([
      sb.rpc('get_tps_overview', { p_election_id: state.election.id }),
      sb.rpc('get_overall_summary', { p_election_id: state.election.id }),
      sb.from('vote_summary').select('tps_id, candidate_id, vote_count').eq('election_id', state.election.id),
    ]);

    if (ovErr || ovaErr) return;

    const byTps = {};
    (summaryRows || []).forEach((r) => {
      if (r.candidate_id === null) return;
      byTps[r.tps_id] = byTps[r.tps_id] || {};
      byTps[r.tps_id][r.candidate_id] = r.vote_count;
    });

    const { totalValid } = renderHeader(overview, overall);
    renderCandidates(overall, totalValid);
    renderChart(overall);
    renderTpsProgress(overview);
    renderTpsTable(overview, byTps);
    el.updatedAt.textContent = `Terakhir diperbarui: ${formatTime(new Date())}`;
  }

  function subscribeRealtime() {
    sb.channel('public-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vote_summary' }, () => { state.dirty = true; })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tps' }, () => { state.dirty = true; })
      .subscribe();

    setInterval(() => {
      if (state.dirty) {
        state.dirty = false;
        refresh();
      }
    }, REFRESH_THROTTLE_MS);
  }

  async function init() {
    const { data: election, error } = await sb
      .from('elections')
      .select('id, name, village_name')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !election) {
      el.name.textContent = 'Belum ada election aktif.';
      return;
    }
    state.election = election;
    el.name.textContent = election.name;
    el.village.textContent = election.village_name;

    const { data: candidates } = await sb
      .from('candidates')
      .select('id, candidate_number, name, photo_url')
      .eq('election_id', election.id)
      .eq('is_active', true)
      .order('candidate_number');
    state.candidates = candidates || [];

    await refresh();
    subscribeRealtime();
  }

  init();
})();
