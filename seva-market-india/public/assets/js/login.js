/* SEVA MARKET INDIA — login / register */
(function () {
  'use strict';

  let role = 'customer';

  function show(tab) {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('loginForm').classList.toggle('hide', tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hide', tab !== 'register');
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tab);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }

  function redirectFor(user) {
    const next = new URLSearchParams(window.location.search).get('next');
    if (next && next.startsWith('/')) return next;
    if (user.role === 'admin') return '/admin.html';
    if (user.role === 'provider') return '/provider-dashboard.html';
    return '/dashboard.html';
  }

  SMI.boot().then(() => {
    document.getElementById('brandMark').innerHTML = SMI.icon('brand');
    SMI.cities.forEach((c) => document.getElementById('regCity').add(new Option(`${c.name}, ${c.state}`, c.name)));
    SMI.categories.forEach((c) => document.getElementById('regCategory').add(new Option(c.name, c.slug)));

    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'register') show('register');
    if (params.get('role') === 'provider') {
      document.querySelectorAll('#roleTabs button').forEach((b) => b.classList.toggle('active', b.dataset.role === 'provider'));
      role = 'provider';
      document.getElementById('providerFields').classList.remove('hide');
      if (params.get('tab') !== 'login') show('register');
    }

    document.querySelectorAll('#tabs button').forEach((button) => {
      button.addEventListener('click', () => show(button.dataset.tab));
    });

    document.querySelectorAll('#roleTabs button').forEach((button) => {
      button.addEventListener('click', () => {
        role = button.dataset.role;
        document.querySelectorAll('#roleTabs button').forEach((b) => b.classList.toggle('active', b === button));
        document.getElementById('providerFields').classList.toggle('hide', role !== 'provider');
      });
    });

    document.getElementById('loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = document.getElementById('loginBtn');
      button.disabled = true;
      button.textContent = 'Logging in…';
      const response = await SMI.post('/api/auth/login', {
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
      });
      button.disabled = false;
      button.textContent = 'Log in';
      if (response.ok) {
        SMI.toast(`Welcome back, ${response.user.name.split(' ')[0]}!`, 'success');
        setTimeout(() => { window.location.href = redirectFor(response.user); }, 500);
      } else {
        SMI.toast(response.error || 'Login failed.', 'error');
      }
    });

    document.getElementById('registerForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = document.getElementById('registerBtn');
      button.disabled = true;
      button.textContent = 'Creating account…';
      const response = await SMI.post('/api/auth/register', {
        name: document.getElementById('regName').value,
        email: document.getElementById('regEmail').value,
        phone: document.getElementById('regPhone').value,
        city: document.getElementById('regCity').value,
        password: document.getElementById('regPassword').value,
        role,
        business_name: document.getElementById('regBusiness').value,
        category: document.getElementById('regCategory').value,
        area: document.getElementById('regArea').value,
        experience_years: document.getElementById('regExperience').value,
        headline: document.getElementById('regHeadline').value
      });
      button.disabled = false;
      button.textContent = 'Create account';
      if (response.ok) {
        SMI.toast(role === 'provider'
          ? 'Account created — your profile is sent for verification.'
          : 'Account created. Welcome to SEVA MARKET INDIA!', 'success');
        setTimeout(() => { window.location.href = redirectFor(response.user); }, 700);
      } else {
        SMI.toast(response.error || 'Could not create the account.', 'error');
      }
    });
  });
}());
