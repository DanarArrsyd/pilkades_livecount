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

  const CANDIDATE_COLORS = ['#c1121f', '#14213d', '#7ea653', '#d38b2c', '#e3d04a'];
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Numbers settle into place instead of snapping — the only motion on the page
  // besides the chart, so it reads as a live instrument, not an animated ad.
  function animateNumber(node, to, format) {
    const from = Number(node.dataset.value || 0);
    node.dataset.value = String(to);
    if (REDUCED_MOTION || from === to) {
      node.textContent = format(to);
      return;
    }
    const start = performance.now();
    const duration = 520;
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = format(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  const el = {
    name: document.getElementById('electionName'),
    village: document.getElementById('electionVillage'),
    resultStatus: document.getElementById('resultStatus'),
    statTpsDone: document.getElementById('statTpsDone'),
    statValid: document.getElementById('statValid'),
    statInvalid: document.getElementById('statInvalid'),
    statTotalDpt: document.getElementById('statTotalDpt'),
    statTurnout: document.getElementById('statTurnout'),
    candidateGrid: document.getElementById('candidateGrid'),
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

    el.statTpsDone.textContent = `${done} TPS`;

    const totalValid = overview.reduce((s, r) => s + Number(r.valid_votes), 0);
    const totalInvalid = overview.reduce((s, r) => s + Number(r.invalid_votes), 0);
    el.statValid.textContent = `${totalValid.toLocaleString('id-ID')} SAH`;
    el.statInvalid.textContent = `${totalInvalid.toLocaleString('id-ID')} TIDAK SAH`;

    const tpsWithDpt = overview.filter((r) => r.dpt_limit);
    const totalDpt = tpsWithDpt.reduce((s, r) => s + Number(r.dpt_limit), 0);
    el.statTotalDpt.textContent = `${totalDpt.toLocaleString('id-ID')} (${tpsWithDpt.length}/${total} TPS)`;
    el.statTurnout.textContent = totalDpt > 0
      ? `${Math.round((totalValid + totalInvalid) / totalDpt * 100)}%`
      : 'Belum ada data DPT';

    el.resultStatus.classList.toggle('final', allLocked);
    el.resultStatus.querySelector('span:last-child').textContent = allLocked ? 'Selesai' : 'Live Count';

    return { totalValid, totalInvalid };
  }

  function renderCandidates(overall, totalValid) {
    if (!state.candidateCardsBuilt) {
      el.candidateGrid.innerHTML = overall.map((c) => {
        const candidateMeta = state.candidates.find((x) => x.id === c.candidate_id) || {};
        const photo = candidateMeta.photo_url
          ? `<img src="${escapeHtml(candidateMeta.photo_url)}" alt="" />`
          : 'Foto Calon';
        return `
          <div class="report-card">
            <div class="report-card-num">${c.candidate_number}</div>
            <div class="report-card-body">
              <div class="report-card-photo">${photo}</div>
              <div class="report-card-result">
                <span class="pct" id="pct-${c.candidate_id}">0,00%</span>
                <span class="votes" id="votes-${c.candidate_id}">0 Suara</span>
              </div>
            </div>
            <div class="report-card-footer">${escapeHtml(c.name)}</div>
          </div>
        `;
      }).join('');
      el.candidateGrid.style.setProperty('--cards', String(overall.length));
      state.candidateCardsBuilt = true;
    }

    overall.forEach((c) => {
      const votesEl = document.getElementById(`votes-${c.candidate_id}`);
      if (votesEl) {
        animateNumber(votesEl, c.vote_count, (v) => `${Math.round(v).toLocaleString('id-ID')} Suara`);
      }
      const pctEl = document.getElementById(`pct-${c.candidate_id}`);
      if (pctEl) {
        animateNumber(pctEl, Number(pct(c.vote_count, totalValid)), (v) => v.toFixed(2).replace('.', ',') + '%');
      }
    });
  }

  const percentageLabelPlugin = {
    id: 'percentageLabel',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.fillStyle = '#111111';
      ctx.font = 'bold 12px Arial, Helvetica, sans-serif';
      ctx.textAlign = 'center';
      meta.data.forEach((bar, i) => {
        const value = chart.data.datasets[0].data[i];
        ctx.fillText(value.toFixed(2).replace('.', ',') + '%', bar.x, bar.y - 10);
      });
      ctx.restore();
    },
  };

  function renderChart(overall, totalValid) {
    const ctx = document.getElementById('overallChart');
    const labels = overall.map((c) => `PASLON ${c.candidate_number}`);
    const votes = overall.map((c) => c.vote_count);
    const data = overall.map((c) => Number(pct(c.vote_count, totalValid)));
    const colors = overall.map((c, i) => CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]);

    // Axis tracks the leader instead of always spanning to 100, so bars fill the
    // plot the way the printed tally sheet shows them.
    const peak = data.length ? Math.max(...data) : 0;
    const axisMax = Math.min(100, Math.max(20, Math.ceil((peak + 8) / 10) * 10));

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets[0].data = data;
      state.chart.data.datasets[0].votes = votes;
      state.chart.data.datasets[0].backgroundColor = colors;
      state.chart.options.scales.y.max = axisMax;
      // 'active' skips the entry animation and its per-bar stagger: on a live tick
      // the bars should glide to the new value, not replay the whole reveal.
      state.chart.update('active');
      return;
    }

    state.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          votes,
          backgroundColor: colors,
          borderRadius: 0,
          maxBarThickness: 72,
          hoverBackgroundColor: colors,
        }],
      },
      plugins: [percentageLabelPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 24 } },
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
            backgroundColor: '#111111',
            titleFont: { family: 'Arial, Helvetica, sans-serif', weight: '700', size: 12 },
            bodyFont: { family: 'Arial, Helvetica, sans-serif', weight: '600', size: 12 },
            padding: 10,
            cornerRadius: 2,
            displayColors: false,
            callbacks: {
              label: (ctx) => `${ctx.dataset.votes[ctx.dataIndex].toLocaleString('id-ID')} suara`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#4a4a4a',
              font: { family: 'Arial, Helvetica, sans-serif', weight: '700', size: 11 },
            },
            grid: { display: false },
            border: { color: '#111111' },
          },
          y: {
            beginAtZero: true,
            max: axisMax,
            ticks: {
              stepSize: 10,
              color: '#8a8a86',
              font: { family: 'Arial, Helvetica, sans-serif', weight: '600', size: 10 },
              padding: 8,
              callback: (v) => v + '%',
            },
            grid: { color: '#ececea', drawTicks: false },
            border: { display: false },
          },
        },
      },
    });
  }

  // Rows are built once and then written cell by cell. Re-serialising 40 rows of
  // innerHTML on every realtime tick was the dashboard's main source of jank — it
  // threw away and rebuilt ~300 nodes several times a second while counting.
  const tableRows = new Map(); // tps_id -> {tr, cells[], total, status}

  function buildTpsTable(overview) {
    el.tpsTableHeadRow.innerHTML = [
      '<th>TPS</th>',
      ...state.candidates.map((c) => `<th>Calon ${c.candidate_number}</th>`),
      '<th>Total</th>', '<th>Status</th>',
    ].join('');

    const frag = document.createDocumentFragment();
    tableRows.clear();

    overview.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><a href="live/tps.html?n=${r.tps_number}">${padTps(r.tps_number)}</a></td>
        ${state.candidates.map(() => '<td class="is-zero">0</td>').join('')}
        <td class="cell-total is-zero">0</td>
        <td class="cell-status"><span class="status-dot"></span><span class="status-text"></span></td>
      `;
      frag.appendChild(tr);
      const tds = tr.querySelectorAll('td');
      tableRows.set(r.tps_id, {
        tr,
        cells: Array.from(tds).slice(1, 1 + state.candidates.length),
        total: tr.querySelector('.cell-total'),
        statusDot: tr.querySelector('.status-dot'),
        statusText: tr.querySelector('.status-text'),
      });
    });

    el.tpsTableBody.replaceChildren(frag);
  }

  function renderTpsTable(overview, byTps) {
    if (tableRows.size !== overview.length) buildTpsTable(overview);

    overview.forEach((r) => {
      const row = tableRows.get(r.tps_id);
      if (!row) return;

      const perCandidate = byTps[r.tps_id] || {};
      state.candidates.forEach((c, i) => {
        const n = perCandidate[c.id] || 0;
        const cell = row.cells[i];
        const text = String(n);
        if (cell.textContent !== text) {
          cell.textContent = text;
          cell.classList.toggle('is-zero', !n);
        }
      });

      const total = String(r.total_votes);
      if (row.total.textContent !== total) {
        row.total.textContent = total;
        row.total.classList.toggle('is-zero', !r.total_votes);
      }

      const statusClass = 'status-dot status-' + r.status;
      if (row.statusDot.className !== statusClass) {
        row.statusDot.className = statusClass;
        row.statusText.textContent = statusLabelId(r.status);
      }

      const over = Boolean(r.dpt_limit && r.total_votes > r.dpt_limit);
      row.tr.classList.toggle('over-limit', over);
    });
  }

  // The per-TPS rows already contain everything the overall totals need, so the
  // separate get_overall_summary round trip was dropped: two requests per tick
  // instead of three.
  async function refresh() {
    const [{ data: overview, error: ovErr }, { data: summaryRows, error: sumErr }] = await Promise.all([
      sb.rpc('get_tps_overview', { p_election_id: state.election.id }),
      sb.from('vote_summary').select('tps_id, candidate_id, vote_count').eq('election_id', state.election.id),
    ]);

    if (ovErr || sumErr) return;

    const byTps = {};
    const perCandidateTotal = {};
    (summaryRows || []).forEach((r) => {
      if (r.candidate_id === null) return;
      byTps[r.tps_id] = byTps[r.tps_id] || {};
      byTps[r.tps_id][r.candidate_id] = r.vote_count;
      perCandidateTotal[r.candidate_id] = (perCandidateTotal[r.candidate_id] || 0) + r.vote_count;
    });

    const overall = state.candidates.map((c) => ({
      candidate_id: c.id,
      candidate_number: c.candidate_number,
      name: c.name,
      vote_count: perCandidateTotal[c.id] || 0,
    }));

    const { totalValid } = renderHeader(overview, overall);
    renderCandidates(overall, totalValid);
    renderChart(overall, totalValid);
    renderTpsTable(overview, byTps);
    el.updatedAt.textContent = `Terakhir diperbarui: ${formatTime(new Date())}`;
  }

  function subscribeRealtime() {
    sb.channel('public-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vote_summary' }, () => { state.dirty = true; })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tps' }, () => { state.dirty = true; })
      .subscribe();

    // A hidden tab keeps collecting realtime events but stops querying: the flag
    // stays set and one refresh catches everything up when the tab comes back.
    setInterval(() => {
      if (state.dirty && !document.hidden && !state.refreshing) {
        state.dirty = false;
        state.refreshing = true;
        refresh().finally(() => { state.refreshing = false; });
      }
    }, REFRESH_THROTTLE_MS);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.dirty && !state.refreshing) {
        state.dirty = false;
        state.refreshing = true;
        refresh().finally(() => { state.refreshing = false; });
      }
    });
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
