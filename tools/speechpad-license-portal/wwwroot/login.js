const form = document.getElementById('login-form');
const error = document.getElementById('error');

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const data = {
    login: form.elements.login.value,
    password: form.elements.password.value,
  };
  const submit = form.querySelector('button');
  submit.disabled = true;
  error.hidden = true;

  try {
    const resp = await fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    });
    const answer = await resp.json();
    if (!resp.ok || !answer.ok) {
      throw new Error(answer.error || 'Ошибка входа');
    }
    sessionStorage.setItem('csrf', answer.csrf || '');
    location.href = '/';
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
});
