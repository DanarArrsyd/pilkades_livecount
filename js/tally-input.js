// Input Rekap TPS: bulk/final-tally entry per TPS, additive across resubmits.
// Reads/writes vote_summary directly via submit_tps_tally — never touches
// vote_events (that table models discrete per-keypress votes; this doesn't).
(function () {
  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = '../login.html';
      return;
    }
  }

  init();
})();
