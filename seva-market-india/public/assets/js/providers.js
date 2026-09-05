/* SEVA MARKET INDIA — search results */
(function () {
  'use strict';

  const els = {};
  let page = 1;

  function card(p) {
    return `
      <a class="card card-hover provider-card" href="/provider.html?id=${p.id}">
        <div class="provider-top">
          <div class="avatar">${SMI.esc(SMI.initials(p.business_name))}</div>
          <div style="min-width:0;flex:1">
            <div class="provider-name">
              ${SMI.esc(p.business_name)}
              ${p.verified ? '<span class="badge" style="margin-left:6px">Verified</span>' : ''}
            </div>
            <div class="provider-meta">${SMI.esc(p.area ? p.area + ', ' : '')}${SMI.esc(p.city)} · ${SMI.esc(p.category_name)}</div>
            <div class="rating mt-1">
              <span class="stars">${SMI.stars(p.rating)}</span>
              <span>${Number(p.rating || 0).toFixed(1)}</span>
              <span class="count">(${p.rating_count} reviews)</span>
            </div>
          </div>
        </div>
        <p class="provider-headline">${SMI.esc(p.headline)}</p>
        <div class="provider-bottom">
          <span class="price-from">From <strong>${SMI.money(p.price_from)}</strong></span>
          <span class="small" style="color:var(--brand-2);font-weight:700">View &amp; book →</span>
        </div>
      </a>`;
  }

  function buildQuery() {
    const query = new URLSearchParams();
    if (els.q.value.trim()) query.set('q', els.q.value.trim());
    if (els.category.value) query.set('category', els.category.value);
    if (els.city.value) query.set('city', els.city.value);
    if (els.sort.value) query.set('sort', els.sort.value);
    if (els.min_rating.value) query.set('min_rating', els.min_rating.value);
    if (els.verified.checked) query.set('verified', '1');
    query.set('page', String(page));
    return query;
  }

  async function load() {
    const query = buildQuery();
    els.results.innerHTML = Array.from({ length: 3 }).map(() =>
      '<div class="card"><div class="skeleton" style="width:60%"></div><div class="skeleton mt-2" style="width:80%"></div></div>').join('');
    const result = await SMI.get(`/api/providers?${query.toString()}`);
    if (!result.ok) {
      els.results.innerHTML = '<div class="card empty" style="grid-column:1/-1">Could not load professionals.</div>';
      return;
    }
    els.count.textContent = result.total
      ? `${result.total} professional${result.total === 1 ? '' : 's'} found · page ${result.page} of ${result.pages}`
      : 'No professionals match these filters yet.';
    els.results.innerHTML = result.items.length
      ? result.items.map(card).join('')
      : `<div class="card empty" style="grid-column:1/-1">
           <h3>No results</h3>
           <p class="small">Try another city or clear the filters to see every professional.</p>
           <button class="btn btn-ghost btn-sm mt-2" data-x="reset">Reset filters</button>
         </div>`;

    els.pager.innerHTML = `
      <button class="btn btn-ghost btn-sm" data-page="${result.page - 1}" ${result.page <= 1 ? 'disabled' : ''}>← Previous</button>
      <button class="btn btn-ghost btn-sm" data-page="${result.page + 1}" ${result.page >= result.pages ? 'disabled' : ''}>Next →</button>`;

    const url = new URL(window.location.href);
    url.search = query.toString().replace(/&page=1(&|$)/, '$1');
    window.history.replaceState({}, '', url);
  }

  SMI.boot().then(() => {
    ['q', 'category', 'city', 'sort', 'min_rating', 'verified', 'apply', 'results', 'pager', 'count']
      .forEach((id) => { els[id] = document.getElementById(id); });

    SMI.categories.forEach((c) => els.category.add(new Option(c.name, c.slug)));
    SMI.cities.forEach((c) => els.city.add(new Option(`${c.name}, ${c.state}`, c.name)));

    const params = new URLSearchParams(window.location.search);
    els.q.value = params.get('q') || '';
    els.category.value = params.get('category') || '';
    els.city.value = params.get('city') || '';
    els.sort.value = params.get('sort') || 'rating';
    els.min_rating.value = params.get('min_rating') || '';
    els.verified.checked = params.get('verified') === '1';
    page = Number(params.get('page')) || 1;

    ['q', 'category', 'city', 'sort', 'min_rating', 'verified'].forEach((id) => {
      els[id].addEventListener('change', () => { page = 1; load(); });
    });
    els.q.addEventListener('search', () => { page = 1; load(); });
    els.apply.addEventListener('click', (event) => { event.preventDefault(); page = 1; load(); });

    document.addEventListener('click', (event) => {
      const pager = event.target.closest('button[data-page]');
      if (pager && !pager.disabled) {
        page = Number(pager.getAttribute('data-page'));
        load();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (event.target.closest('[data-x="reset"]')) {
        window.location.href = '/providers.html';
      }
    });

    load();
  });
}());
