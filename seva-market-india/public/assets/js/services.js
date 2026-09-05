/* SEVA MARKET INDIA — service catalogue */
(function () {
  'use strict';

  SMI.boot().then(async () => {
    const result = await SMI.get('/api/services');
    const holder = document.getElementById('catalogue');
    if (!result.ok || !result.services.length) {
      holder.innerHTML = '<div class="card empty">The service catalogue is being updated. Please check back soon.</div>';
      return;
    }

    const grouped = new Map();
    SMI.categories.forEach((c) => {
      const services = result.services.filter((s) => s.category_slug === c.slug);
      if (services.length) grouped.set(c, services);
    });

    holder.innerHTML = [...grouped.entries()].map(([category, services]) => `
      <div class="card mb-2" style="padding:22px">
        <div class="row row-wrap spread mb-2">
          <div class="row" style="gap:14px">
            <span class="cat-icon">${SMI.categoryIcon(category.slug)}</span>
            <div>
              <h3 class="mb-0">${SMI.esc(category.name)}</h3>
              <p class="small muted mb-0">${SMI.esc(category.tagline)}</p>
            </div>
          </div>
          <a class="btn btn-primary btn-sm" href="/providers.html?category=${encodeURIComponent(category.slug)}">
            Book ${SMI.esc(category.name)}
          </a>
        </div>
        <div>
          ${services.map((s) => `
            <div class="service-row">
              <span>
                <strong style="font-weight:600">${SMI.esc(s.name)}</strong>
                <span class="tiny muted" style="display:block">Typical duration ${s.duration_min} min</span>
              </span>
              <span style="font-weight:700">${SMI.money(s.base_price)}</span>
            </div>`).join('')}
        </div>
      </div>`).join('');
  });
}());
