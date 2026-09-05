/**
 * Search results page.
 *
 * Reads the query from the URL (so every result set is shareable and
 * crawlable), calls /api/v1/search, and rewrites the URL on filter changes
 * without a full reload.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const state = { page: Number(params.get('page') || 1) || 1, place: null };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    await loadServices();
    wireForm();
    wireSort();
    await runSearch();
  }

  async function loadServices() {
    const select = document.getElementById('service');
    if (!select) return;
    try {
      const [categoriesPayload, servicesPayload] = await Promise.all([
        window.SEVA.api.categories(),
        window.SEVA.api.services()
      ]);
      const names = new Map((categoriesPayload.items || []).map((row) => [row.id, row.name]));
      const grouped = new Map();
      for (const service of servicesPayload.items || []) {
        const key = names.get(service.category_id) || 'Other';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(service);
      }
      const options = [...grouped.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(
          ([categoryName, services]) =>
            '<optgroup label="' +
            window.SEVA.escapeHtml(categoryName) +
            '">' +
            services
              .map(
                (service) =>
                  '<option value="' + window.SEVA.escapeHtml(service.slug) + '">' + window.SEVA.escapeHtml(service.name) + '</option>'
              )
              .join('') +
            '</optgroup>'
        )
        .join('');
      select.innerHTML = '<option value="">All services</option>' + options;
      if (params.get('service')) select.value = params.get('service');
    } catch (_) {
      /* the service filter stays as "All services" */
    }
  }

  function buildQuery() {
    const query = {};
    for (const key of ['service', 'category', 'city', 'state', 'pincode', 'locality', 'q', 'sort']) {
      const value = params.get(key);
      if (value) query[key] = value;
    }
    query.page = state.page;
    query.limit = 20;
    return query;
  }

  async function runSearch() {
    const host = document.getElementById('results');
    const summary = document.getElementById('resultSummary');
    const title = document.getElementById('resultTitle');
    const pager = document.getElementById('pager');
    if (!host) return;

    host.setAttribute('aria-busy', 'true');
    host.innerHTML = Array.from({ length: 3 })
      .map(() => '<div class="provider-card"><div class="skeleton skeleton--title"></div><div class="skeleton skeleton--medium"></div><div class="skeleton skeleton--short"></div></div>')
      .join('');

    try {
      const payload = await window.SEVA.api.search(buildQuery());
      const items = payload.items || [];
      const place = payload.place || {};
      const label = [place.locality && place.locality.name, place.city && place.city.name, place.state && place.state.name]
        .filter(Boolean)
        .join(', ');

      if (title) {
        title.textContent = params.get('q') || label ? 'Providers' + (label ? ' in ' + label : '') : 'Local service providers';
      }
      if (summary) {
        summary.textContent =
          payload.pagination.total === 0
            ? 'No providers matched this search yet.'
            : payload.pagination.total +
              ' provider' +
              (payload.pagination.total === 1 ? '' : 's') +
              ' found' +
              (label ? ' in ' + label : ' across India') +
              ' · page ' +
              payload.pagination.page +
              ' of ' +
              payload.pagination.pages;
      }

      host.innerHTML = items.length
        ? items.map(window.SEVA.providerCard).join('')
        : '<p class="empty">No providers here yet. Try a nearby PIN code, or widen your search.</p>';

      if (pager) {
        pager.innerHTML =
          (payload.pagination.page > 1
            ? '<button class="btn btn--ghost btn--sm" type="button" data-page="' + (payload.pagination.page - 1) + '">← Previous</button>'
            : '<span></span>') +
          (payload.pagination.has_more
            ? '<button class="btn btn--ghost btn--sm" type="button" data-page="' + (payload.pagination.page + 1) + '">Next →</button>'
            : '<span></span>');
      }

      renderFilters(place);
    } catch (error) {
      host.innerHTML = '<p class="empty">' + window.SEVA.escapeHtml(window.SEVA.errorMessage(error, 'Search failed.')) + '</p>';
    } finally {
      host.setAttribute('aria-busy', 'false');
    }
  }

  function renderFilters(place) {
    const host = document.getElementById('activeFilters');
    if (!host) return;
    const chips = [];
    if (place.pincode) chips.push({ label: 'PIN ' + place.pincode, key: 'pincode' });
    if (place.city) chips.push({ label: place.city.name, key: 'city' });
    if (params.get('service')) chips.push({ label: 'Service: ' + params.get('service'), key: 'service' });
    if (params.get('category')) chips.push({ label: 'Category: ' + params.get('category'), key: 'category' });

    host.innerHTML = chips.length
      ? chips
          .map(
            (chip) =>
              '<button class="chip chip--link" type="button" data-clear="' +
              window.SEVA.escapeHtml(chip.key) +
              '">' +
              window.SEVA.escapeHtml(chip.label) +
              ' ✕</button>'
          )
          .join('')
      : '';

    host.querySelectorAll('[data-clear]').forEach((button) => {
      button.addEventListener('click', () => {
        params.delete(button.dataset.clear);
        state.page = 1;
        navigate();
      });
    });
  }

  function navigate() {
    const query = new URLSearchParams();
    for (const key of ['service', 'category', 'city', 'state', 'pincode', 'locality', 'q', 'sort', 'page']) {
      const value = key === 'page' ? state.page : params.get(key);
      if (value && !(key === 'page' && Number(value) === 1)) query.set(key, String(value));
    }
    const search = query.toString();
    window.history.replaceState({}, '', '/search.html' + (search ? '?' + search : ''));
    runSearch();
  }

  function wireForm() {
    const form = document.getElementById('searchForm');
    const input = document.getElementById('place');
    const list = document.getElementById('suggestions');
    if (!form) return;

    if (params.get('pincode')) input.value = params.get('pincode');
    else if (params.get('city')) input.value = params.get('city');
    else if (params.get('q')) input.value = params.get('q');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const service = document.getElementById('service').value;
      const raw = String(input.value || '').trim();

      for (const key of ['city', 'state', 'pincode', 'locality', 'q']) params.delete(key);
      params.delete('service');
      if (service) params.set('service', service);

      if (state.place && state.place.value === raw) {
        if (state.place.pincode) params.set('pincode', state.place.pincode);
        else if (state.place.city) params.set('city', state.place.city);
        else if (state.place.state) params.set('state', state.place.state);
      } else if (/^\d{6}$/.test(raw)) {
        params.set('pincode', raw);
      } else if (raw) {
        params.set('q', raw);
      }

      state.page = 1;
      navigate();
    });

    if (input && list) {
      let timer = null;
      input.addEventListener('input', () => {
        const value = String(input.value || '').trim();
        clearTimeout(timer);
        if (value.length < 2) {
          list.classList.add('hide');
          return;
        }
        timer = setTimeout(async () => {
          try {
            const payload = await window.SEVA.api.resolve({ q: value });
            const place = payload.place || {};
            const items = [];
            if (place.pincode) items.push({ label: place.pincode, kind: 'PIN code', pincode: place.pincode, value: place.pincode });
            if (place.city) items.push({ label: place.city.name, kind: 'City', city: place.city.slug, value: place.city.name });
            if (place.state) items.push({ label: place.state.name, kind: 'State', state: place.state.slug, value: place.state.name });
            state.suggestions = items;
            if (!items.length) return list.classList.add('hide');
            list.innerHTML = items
              .map(
                (item, index) =>
                  '<li class="suggestions__item" role="option" data-index="' + index + '">' +
                  window.SEVA.escapeHtml(item.label) +
                  '<span class="suggestions__meta"> · ' + window.SEVA.escapeHtml(item.kind) + '</span></li>'
              )
              .join('');
            list.classList.remove('hide');
          } catch (_) {
            list.classList.add('hide');
          }
        }, 220);
      });

      list.addEventListener('click', (event) => {
        const item = event.target.closest('.suggestions__item');
        if (!item) return;
        const picked = (state.suggestions || [])[Number(item.dataset.index)];
        if (!picked) return;
        input.value = picked.value;
        state.place = picked;
        list.classList.add('hide');
      });

      document.addEventListener('click', (event) => {
        if (!event.target.closest('.field--autocomplete')) list.classList.add('hide');
      });
    }
  }

  function wireSort() {
    const sort = document.getElementById('sort');
    const pager = document.getElementById('pager');
    if (sort) {
      if (params.get('sort')) sort.value = params.get('sort');
      sort.addEventListener('change', () => {
        if (sort.value) params.set('sort', sort.value);
        else params.delete('sort');
        state.page = 1;
        navigate();
      });
    }
    if (pager) {
      pager.addEventListener('click', (event) => {
        const button = event.target.closest('[data-page]');
        if (!button) return;
        state.page = Number(button.dataset.page) || 1;
        navigate();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }
})();
