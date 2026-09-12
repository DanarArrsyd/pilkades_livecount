// Login form handling + redirect guard. Shared by login.html only.
(async function () {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    window.location.href = 'admin/input.html';
    return;
  }

  const form = document.getElementById('loginForm');
  const errorEl = document.getElementById('error');
  const submitBtn = document.getElementById('submitBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    const { error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
      errorEl.textContent = 'Login gagal: ' + error.message;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Login';
      return;
    }

    window.location.href = 'admin/input.html';
  });
})();
