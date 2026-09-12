function generateClientEventId() {
  return crypto.randomUUID();
}

function formatTime(date) {
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function padTps(n) {
  return String(n).padStart(2, '0');
}

// Human-readable Indonesian labels — never show raw snake_case status/action/entity
// strings to the operator. Falls back to the raw value only for anything unmapped.
const STATUS_LABELS_ID = {
  not_started: 'Belum Mulai',
  counting: 'Sedang Menghitung',
  paused: 'Dijeda',
  completed: 'Selesai Dihitung',
  locked: 'Terkunci',
};

function statusLabelId(status) {
  return STATUS_LABELS_ID[status] || status;
}

const ACTION_LABELS_ID = {
  login: 'Admin masuk',
  logout: 'Admin keluar',
  vote_added: 'Suara ditambahkan',
  vote_cancelled: 'Suara dibatalkan (undo)',
  tps_counting_started: 'TPS mulai dihitung',
  tps_paused: 'Penghitungan TPS dijeda',
  tps_completed: 'Penghitungan TPS selesai',
  tps_locked: 'TPS dikunci',
  tps_unlocked: 'TPS dibuka kuncinya',
  verification_performed: 'Verifikasi hasil TPS',
  export_generated: 'Hasil diekspor',
  snapshot_created: 'Snapshot cadangan dibuat',
  candidate_added: 'Paslon ditambahkan',
  candidate_updated: 'Data paslon diubah',
  candidate_deleted: 'Paslon dihapus',
};

function actionLabelId(action) {
  return ACTION_LABELS_ID[action] || action;
}

const ENTITY_LABELS_ID = {
  tps: 'TPS',
  vote_events: 'Data Suara',
  snapshots: 'Snapshot',
  candidates: 'Paslon',
};

function entityLabelId(entity) {
  return ENTITY_LABELS_ID[entity] || entity || '';
}

// Animates a number's textContent from its current value to `to` — makes live
// updates feel real instead of the count just snapping. Respects reduced-motion.
//
// Rapid input retargets a running animation instead of starting a second one:
// stacked rAF loops on the same node fight over textContent and burn a frame
// each, which is what made fast counting feel laggy.
const NUMBER_ANIMATIONS = new WeakMap();
const PREFERS_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

function animateNumber(el, to, duration) {
  if (!el) return;

  const running = NUMBER_ANIMATIONS.get(el);
  const from = running ? running.current : (Number(el.textContent.replace(/[^\d.-]/g, '')) || 0);

  if (running) cancelAnimationFrame(running.frame);

  if (from === to || PREFERS_REDUCED_MOTION.matches) {
    NUMBER_ANIMATIONS.delete(el);
    el.textContent = to;
    return;
  }

  const dur = duration || 500;
  const start = performance.now();
  const anim = { current: from, frame: 0 };
  NUMBER_ANIMATIONS.set(el, anim);

  function tick(now) {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    anim.current = from + (to - from) * eased;
    el.textContent = Math.round(anim.current);
    if (t < 1) {
      anim.frame = requestAnimationFrame(tick);
    } else {
      NUMBER_ANIMATIONS.delete(el);
      el.textContent = to;
    }
  }
  anim.frame = requestAnimationFrame(tick);
}
