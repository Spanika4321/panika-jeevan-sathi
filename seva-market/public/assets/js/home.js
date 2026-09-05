/**
 * Home page behaviour.
 *
 * Progressive enhancement: the hero, categories and copy render from static
 * HTML so the page is useful immediately; this script then fills the live
 * marketplace data from /api/v1/home and wires the search box.
 *
 * Nothing writes inline styles (the CSP forbids them) — visibility is toggled
 * with the `hide` class only.
 */
(function () {
  'use strict';

  const QUICK_SEARCHES = [
    { label: 'Plumber near me', service: 'tap-faucet-repair' },
    { label: 'AC service', service: 'ac-service-repair' },
    { label: 'Home deep cleaning', service: 'full-home-deep-cleaning' },
    { label: 'Home tutor', service: 'home-tutor-primary' },
    { label: 'Pest control', service: 'cockroach-control' },
    { label: 'Bike servicing', service: 'bike-servicing' }
  ];

  const state = { place: null, suggestions: [], activeIndex: -1 };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    renderQuickChips();
    wireSearch();
    wireSuggestions();
    await Promise.allSettled([loadCatalogue(), loadHome()]);
  }

  /* ------------------------------------------------------------ quick chips */

  function renderQuickChips() {
    const host = document.getElementById('quickChips');
    if (!host) return;
    host.innerHTML = QUICK_SEARCHES.map(
      (item) =>
        '<a class="chip chip--light" href="/search.html?service=' +
        encodeURIComponent(item.service) +
        '">' +
        window.SEVA.icon('arrow', { size: 13 }) +
        ' ' +
        window.SEVA.escapeHtml(item.label) +
        '</a>'
    ).join('');
  }

  /* --------------------------------------------------------------- catalogue */

  async function loadCatalogue() {
    const select = document.getElementById('service');
    if (!select) return;
    let categories = [];
    try {
      const payload = await window.SEVA.api.home();
      categories = payload.categories || [];
    } catch (_) {
      categories = [];
    }
    if (!categories.length) return;

    const groups = categories
      .map(
        (category) =>
          '<optgroup label="' +
          window.SEVA.escapeHtml(category.name) +
          '">' +
          (category.services || [])
            .map(
              (service) =>
                '<option value="' +
                window.SEVA.escapeHtml(service.slug) +
                '">' +
                window.SEVA.escapeHtml(service.name) +
                '</option>'
            )
            .join('') +
          '</optgroup>'
      )
      .join('');

    select.innerHTML = '<option value="">All services</option>' + groups;
  }

  /* ------------------------------------------------------------- home data */

  async function loadHome() {
    const categoryHost = document.getElementById('categoryGrid');
    const featuredHost = document.getElementById('featuredGrid');
    const cityHost = document.getElementById('cityChips');

    let payload;
    try {
      payload = await window.SEVA.api.home();
    } catch (error) {
      if (categoryHost) {
        categoryHost.innerHTML = '<p class="muted small">Services are loading… please refresh in a moment.</p>';
        categoryHost.setAttribute('aria-busy', 'false');
      }
      return;
    }

    if (categoryHost) {
      const categories = (payload.categories || []).slice(0, 12);
      categoryHost.innerHTML = categories
        .map(
          (category) =>
            '<a class="category-card" href="/search.html?category=' +
            encodeURIComponent(category.slug) +
            '">' +
            '<span class="category-card__icon">' +
            window.SEVA.icon(category.icon || 'grid', { size: 22 }) +
            '</span>' +
            '<span class="category-card__name">' +
            window.SEVA.escapeHtml(category.name) +
            '</span>' +
            '<span class="category-card__meta">' +
            (category.services || []).length +
            ' services</span>' +
            '</a>'
        )
        .join('');
      categoryHost.setAttribute('aria-busy', 'false');
    }

    if (featuredHost) {
      const providers = payload.featured_providers || [];
      featuredHost.innerHTML = providers.length
        ? providers.map(window.SEVA.providerCard).join('')
        : '<p class="empty">No verified providers yet. Be the first to list your business.</p>';
      featuredHost.setAttribute('aria-busy', 'false');
    }

    if (cityHost) {
      const cities = payload.popular_cities || [];
      cityHost.innerHTML = cities.length
        ? cities
            .map(
              (city) =>
                '<a class="chip chip--link" href="/search.html?city=' +
                encodeURIComponent(city.slug) +
                '">' +
                window.SEVA.escapeHtml(city.name) +
                '</a>'
            )
            .join('')
        : '<p class="muted small">Cities will appear once the directory is imported.</p>';
    }
  }

  /* ----------------------------------------------------------------- search */

  function wireSearch() {
    const form = document.getElementById('searchForm');
    if (!form) return;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const service = document.getElementById('service').value;
      const raw = String(document.getElementById('place').value || '').trim();

      const params = new URLSearchParams();
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

      window.location.href = '/search.html' + (params.toString() ? '?' + params.toString() : '');
    });
  }

  /* ------------------------------------------------------------ suggestions */

  function wireSuggestions() {
    const input = document.getElementById('place');
    const list = document.getElementById('suggestions');
    if (!input || !list) return;

    let timer = null;

    const hideList = () => list.classList.add('hide');
    const showList = () => list.classList.remove('hide');

    function render(items) {
      if (!items.length) return hideList();
      list.innerHTML = items
        .map(
          (item, index) =>
            '<li class="suggestions__item" role="option" data-index="' +
            index +
            '" aria-selected="' +
            (index === state.activeIndex) +
            '">' +
            window.SEVA.escapeHtml(item.label) +
            '<span class="suggestions__meta"> · ' +
            window.SEVA.escapeHtml(item.kind) +
            '</span></li>'
        )
        .join('');
      showList();
    }

    input.addEventListener('input', () => {
      const value = String(input.value || '').trim();
      state.place = null;
      clearTimeout(timer);
      if (value.length < 2) return hideList();
      timer = setTimeout(async () => {
        try {
          const payload = await window.SEVA.api.resolve({ q: value });
          const place = payload.place || {};
          const items = [];
          if (place.pincode) {
            items.push({ label: place.pincode + (place.place && place.place.pincode ? ' · ' + place.place.pincode.office_name : ''), kind: 'PIN code', pincode: place.pincode, value: place.pincode });
          }
          if (place.city) {
            items.push({ label: place.city.name + (place.state ? ', ' + place.state.name : ''), kind: 'City', city: place.city.slug, value: place.city.name });
          }
          if (place.state) {
            items.push({ label: place.state.name, kind: 'State', state: place.state.slug, value: place.state.name });
          }
          state.suggestions = items;
          state.activeIndex = items.length ? 0 : -1;
          render(items);
        } catch (_) {
          hideList();
        }
      }, 220);
    });

    input.addEventListener('keydown', (event) => {
      if (list.classList.contains('hide') || !state.suggestions.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        state.activeIndex = (state.activeIndex + delta + state.suggestions.length) % state.suggestions.length;
        render(state.suggestions);
      } else if (event.key === 'Enter') {
        const picked = state.suggestions[state.activeIndex];
        if (picked) {
          event.preventDefault();
          choose(picked);
        }
      } else if (event.key === 'Escape') {
        hideList();
      }
    });

    list.addEventListener('click', (event) => {
      const item = event.target.closest('.suggestions__item');
      if (!item) return;
      choose(state.suggestions[Number(item.dataset.index)]);
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.field--autocomplete')) hideList();
    });

    function choose(item) {
      if (!item) return;
      input.value = item.value;
      state.place = item;
      hideList();
    }
  }
})();
