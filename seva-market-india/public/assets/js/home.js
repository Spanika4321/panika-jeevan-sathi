/* SEVA MARKET INDIA — home page */
(function () {
  'use strict';

  function providerCard(p) {
    return `
      <a class="card card-hover provider-card" href="/provider.html?id=${p.id}">
        <div class="provider-top">
          <div class="avatar">${SMI.esc(SMI.initials(p.business_name))}</div>
          <div style="min-width:0;flex:1">
            <div class="provider-name">${SMI.esc(p.business_name)}</div>
            <div class="provider-meta">${SMI.esc(p.area ? p.area + ', ' : '')}${SMI.esc(p.city)} · ${SMI.esc(p.category_name)}</div>
            <div class="rating mt-1">
              <span class="stars">${SMI.stars(p.rating)}</span>
              <span>${Number(p.rating || 0).toFixed(1)}</span>
              <span class="count">(${p.rating_count})</span>
            </div>
          </div>
        </div>
        <p class="provider-headline">${SMI.esc(p.headline)}</p>
        <div class="provider-bottom">
          <span class="price-from">From <strong>${SMI.money(p.price_from)}</strong></span>
          <span class="small" style="color:var(--brand-2);font-weight:700">View profile →</span>
        </div>
      </a>`;
  }

  SMI.boot().then(async () => {
    const categorySelect = document.getElementById('category');
    const citySelect = document.getElementById('city');

    SMI.categories.forEach((c) => {
      const option = document.createElement('option');
      option.value = c.slug;
      option.textContent = c.name;
      categorySelect.appendChild(option);
    });
    SMI.cities.forEach((c) => {
      const option = document.createElement('option');
      option.value = c.name;
      option.textContent = `${c.name}, ${c.state}`;
      citySelect.appendChild(option);
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('category')) categorySelect.value = params.get('category');
    if (params.get('city')) citySelect.value = params.get('city');

    document.getElementById('searchForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const query = new URLSearchParams();
      if (categorySelect.value) query.set('category', categorySelect.value);
      if (citySelect.value) query.set('city', citySelect.value);
      window.location.href = `/providers.html?${query.toString()}`;
    });

    // Categories
    document.getElementById('categoryGrid').innerHTML = SMI.categories.map((c) => `
      <a class="card card-hover cat-card" href="/providers.html?category=${encodeURIComponent(c.slug)}">
        <span class="cat-icon">${SMI.categoryIcon(c.slug)}</span>
        <span>
          <h3>${SMI.esc(c.name)}</h3>
          <p>${SMI.esc(c.tagline)}</p>
          <span class="cat-price">From ${SMI.money(c.base_price)}</span>
        </span>
      </a>`).join('');

    // Steps + trust
    const steps = (SMI.site && SMI.site.steps) || [];
    document.getElementById('stepsGrid').innerHTML = steps.map((s) => `
      <div class="card step">
        <div class="step-num">${SMI.esc(s[0])}</div>
        <h3>${SMI.esc(s[1])}</h3>
        <p>${SMI.esc(s[2])}</p>
      </div>`).join('');

    const trust = (SMI.site && SMI.site.trust) || [];
    document.getElementById('trustGrid').innerHTML = trust.map((t) => `
      <div class="card trust-item">
        <span class="tick">${SMI.icon('tick')}</span>
        <span>
          <h4>${SMI.esc(t[0])}</h4>
          <p>${SMI.esc(t[1])}</p>
        </span>
      </div>`).join('');

    // Hero stats
    const counts = (SMI.site && SMI.site.counts) || {};
    document.getElementById('heroStats').innerHTML = [
      [counts.providers || 0, 'Verified professionals'],
      [counts.categories || 0, 'Service categories'],
      [counts.cities || 0, 'Cities live'],
      [counts.jobs_completed || 0, 'Jobs completed']
    ].map((s) => `<div><strong>${s[0]}</strong><span>${SMI.esc(s[1])}</span></div>`).join('');

    // Featured professionals
    const result = await SMI.get('/api/providers?sort=rating&per_page=6');
    const grid = document.getElementById('featuredGrid');
    if (result.ok && result.items.length) grid.innerHTML = result.items.map(providerCard).join('');
    else grid.innerHTML = '<div class="card empty" style="grid-column:1/-1">No professionals listed yet.</div>';
  });
}());
