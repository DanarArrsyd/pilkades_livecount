// Round-trip latency to Supabase, shown as a small badge in the top bar.
// Shared verbatim across every page that includes it — unlike the rest of
// this codebase's per-page JS, this one never diverges by page, so it isn't
// duplicated. Real ICMP ping isn't available from a browser; timing a
// lightweight query to the backend this app actually depends on is the more
// relevant number anyway.
(function () {
  const INTERVAL_MS = 5000;
  const GOOD_MS = 150;
  const OK_MS = 400;

  const el = document.getElementById('netPing');
  if (!el) return;

  el.innerHTML = '<span class="net-ping-dot"></span><span class="net-ping-text">--</span>';
  const dot = el.querySelector('.net-ping-dot');
  const text = el.querySelector('.net-ping-text');

  let measuring = false;

  function render(ms) {
    if (ms === null) {
      dot.className = 'net-ping-dot bad';
      text.textContent = 'Timeout';
      return;
    }
    dot.className = 'net-ping-dot ' + (ms < GOOD_MS ? 'good' : ms < OK_MS ? 'ok' : 'bad');
    text.textContent = `${ms} ms`;
  }

  async function measure() {
    if (measuring || document.hidden) return;
    measuring = true;

    const start = performance.now();
    try {
      const { error } = await sb.from('elections').select('id', { head: true, count: 'exact' }).limit(1);
      if (error) throw error;
      render(Math.round(performance.now() - start));
    } catch (_) {
      render(null);
    } finally {
      measuring = false;
    }
  }

  measure();
  setInterval(measure, INTERVAL_MS);
})();
