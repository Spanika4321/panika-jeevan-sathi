/**
 * Account page — sign in, register and submit a provider listing.
 *
 * Talks only to the public API. Errors returned as field maps (HTTP 422) are
 * rendered as a single readable line so the user is never shown raw JSON.
 */
(function () {
  'use strict';

  const state = { tab: 'signin' };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    wireTabs();
    wireSignIn();
    wireRegister();
    wireProvider();
    loadCategories();

    const hash = window.location.hash.replace('#', '');
    if (['signin', 'register', 'provider'].includes(hash)) showTab(hash);
  }

  function showTab(name) {
    state.tab = name;
    document.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.classList.toggle('hide', panel.dataset.panel !== name);
    });
    document.querySelectorAll('.tabs__tab').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    });
  }

  function wireTabs() {
    document.querySelectorAll('.tabs__tab').forEach((tab) => {
      tab.addEventListener('click', () => showTab(tab.dataset.tab));
    });
  }

  function showError(id, error, fallback) {
    const host = document.getElementById(id);
    if (!host) return;
    host.textContent = window.SEVA.errorMessage(error, fallback);
    host.classList.remove('hide');
  }

  function clearError(id) {
    const host = document.getElementById(id);
    if (host) host.classList.add('hide');
  }

  function wireSignIn() {
    const form = document.getElementById('signinForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearError('signinError');
      try {
        await window.SEVA.api.login({
          email: document.getElementById('signinEmail').value,
          password: document.getElementById('signinPassword').value
        });
        window.location.href = '/account.html#provider';
      } catch (error) {
        showError('signinError', error, 'Could not sign in. Please try again.');
      }
    });
  }

  function wireRegister() {
    const form = document.getElementById('registerForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearError('registerError');
      try {
        await window.SEVA.api.register({
          name: document.getElementById('registerName').value,
          email: document.getElementById('registerEmail').value,
          phone: document.getElementById('registerPhone').value || undefined,
          password: document.getElementById('registerPassword').value
        });
        showTab('provider');
      } catch (error) {
        showError('registerError', error, 'Could not create your account.');
      }
    });
  }

  async function loadCategories() {
    const select = document.getElementById('businessCategory');
    if (!select) return;
    try {
      const payload = await window.SEVA.api.categories();
      select.innerHTML = (payload.items || [])
        .map((row) => '<option value="' + window.SEVA.escapeHtml(row.slug) + '">' + window.SEVA.escapeHtml(row.name) + '</option>')
        .join('');
      await loadServices();
    } catch (_) {
      select.innerHTML = '<option value="">Categories unavailable</option>';
    }
  }

  async function loadServices() {
    const select = document.getElementById('businessServices');
    const category = document.getElementById('businessCategory');
    if (!select || !category) return;
    try {
      const payload = await window.SEVA.api.services({ category: category.value });
      select.innerHTML = (payload.items || [])
        .map((row) => '<option value="' + window.SEVA.escapeHtml(row.slug) + '">' + window.SEVA.escapeHtml(row.name) + '</option>')
        .join('');
    } catch (_) {
      select.innerHTML = '';
    }
  }

  function wireProvider() {
    const category = document.getElementById('businessCategory');
    if (category) category.addEventListener('change', loadServices);

    const form = document.getElementById('providerForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearError('providerError');

      const serviceSelect = document.getElementById('businessServices');
      const services = [...serviceSelect.selectedOptions].map((option) => option.value);
      if (!services.length) {
        showError('providerError', new Error('Select at least one service you provide.'), 'Select at least one service.');
        return;
      }

      try {
        await window.SEVA.api.createProvider({
          business_name: document.getElementById('businessName').value,
          category: category.value,
          services,
          pincode: document.getElementById('businessPin').value,
          phone: document.getElementById('businessPhone').value,
          description: document.getElementById('businessAbout').value
        });
        form.innerHTML =
          '<div class="chip chip--ok">' +
          window.SEVA.icon('verified', { size: 14 }) +
          ' Listing submitted. Our team verifies it before it appears in search.</div>';
      } catch (error) {
        showError('providerError', error, 'Could not submit your listing.');
      }
    });
  }
})();
