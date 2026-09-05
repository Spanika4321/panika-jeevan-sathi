/* SEVA MARKET INDIA — professional profile + booking */
(function () {
  'use strict';

  const id = Number(SMI.qs('id')) || 0;
  let provider = null;
  let services = [];

  function selectedService() {
    const value = Number(document.getElementById('service').value);
    return services.find((s) => s.id === value) || services[0];
  }

  function updateSummary() {
    const service = selectedService();
    if (!service) return;
    document.getElementById('summaryPrice').textContent = SMI.money(service.price);
    document.getElementById('summaryTotal').textContent = SMI.money(service.price);
  }

  function renderHead() {
    document.title = `${provider.business_name} — SEVA MARKET INDIA`;
    document.getElementById('crumb').innerHTML =
      `<a href="/">Home</a> · <a href="/providers.html?category=${encodeURIComponent(provider.category_slug)}">${SMI.esc(provider.category_name)}</a> · ${SMI.esc(provider.business_name)}`;

    document.getElementById('detail').innerHTML = `
      <div class="card" style="padding:22px">
        <div class="detail-head">
          <div class="avatar lg">${SMI.esc(SMI.initials(provider.business_name))}</div>
          <div style="flex:1;min-width:240px">
            <div class="row row-wrap" style="gap:10px">
              <h1 style="font-size:clamp(23px,3vw,32px);margin:0">${SMI.esc(provider.business_name)}</h1>
              ${provider.verified ? '<span class="badge">Verified professional</span>' : '<span class="badge badge-grey">Awaiting verification</span>'}
            </div>
            <p class="muted mb-0" style="margin-top:6px">
              ${SMI.esc(provider.category_name)} · ${SMI.esc(provider.area ? provider.area + ', ' : '')}${SMI.esc(provider.city)}
            </p>
            <div class="row row-wrap mt-1" style="gap:18px">
              <span class="rating">
                <span class="stars">${SMI.stars(provider.rating)}</span>
                <span>${Number(provider.rating || 0).toFixed(1)}</span>
                <span class="count">${provider.rating_count} reviews</span>
              </span>
              <span class="small muted">${provider.experience_years} years experience</span>
              <span class="small muted">${provider.jobs_done} jobs completed</span>
            </div>
          </div>
          <div style="text-align:right">
            <div class="price-from">Starting at</div>
            <div style="font-family:var(--serif);font-size:28px;font-weight:700">${SMI.money(provider.price_from)}</div>
          </div>
        </div>
        <p class="mt-2 mb-0" style="color:var(--ink-2)">${SMI.esc(provider.headline)}</p>
      </div>`;
  }

  function renderServices() {
    const select = document.getElementById('service');
    document.getElementById('services').innerHTML = services.map((s) => `
      <div class="service-row">
        <span>
          <strong style="font-weight:600">${SMI.esc(s.name)}</strong>
          <span class="tiny muted" style="display:block">About ${s.duration_min} minutes · visit included</span>
        </span>
        <span style="font-weight:700">${SMI.money(s.price)}</span>
      </div>`).join('');

    select.innerHTML = services.map((s) =>
      `<option value="${s.id}">${SMI.esc(s.name)} — ${SMI.money(s.price)}</option>`).join('');
    updateSummary();
  }

  function renderReviews() {
    const holder = document.getElementById('reviews');
    if (!provider.reviews.length) {
      holder.innerHTML = '<p class="muted mb-0">No reviews yet. Be the first to review after your booking.</p>';
      return;
    }
    holder.innerHTML = provider.reviews.map((r) => `
      <div class="review-item">
        <div class="review-head">
          <div class="avatar sm">${SMI.esc(SMI.initials(r.customer_name || 'Customer'))}</div>
          <strong>${SMI.esc(r.customer_name || 'Verified customer')}</strong>
          <span class="rating"><span class="stars">${SMI.stars(r.rating)}</span></span>
          <span class="tiny muted">${SMI.esc(SMI.ago(r.created_at))}</span>
        </div>
        <p class="review-text">${SMI.esc(r.comment)}</p>
      </div>`).join('');
  }

  SMI.boot().then(async () => {
    if (!id) {
      document.getElementById('detail').innerHTML = '<div class="card empty">Professional not found.</div>';
      return;
    }

    const result = await SMI.get(`/api/providers/${id}`);
    if (!result.ok || !result.provider) {
      document.getElementById('detail').innerHTML =
        '<div class="card empty"><h3>Professional not found</h3><a class="btn btn-primary btn-sm mt-2" href="/providers.html">Browse all professionals</a></div>';
      return;
    }

    provider = result.provider;
    services = provider.services || [];
    renderHead();
    document.getElementById('bio').textContent = provider.bio || '';
    document.getElementById('facts').innerHTML = [
      ['Category', provider.category_name],
      ['City', provider.city],
      ['Experience', `${provider.experience_years} years`],
      ['Jobs completed', provider.jobs_done],
      ['Member since', SMI.fmtDate(provider.created_at)]
    ].map((f) => `<span class="badge badge-grey">${SMI.esc(f[0])}: ${SMI.esc(String(f[1]))}</span>`).join('');

    renderServices();
    renderReviews();

    const slots = (SMI.site && SMI.site.slots) || [];
    document.getElementById('slot').innerHTML = slots.map((s) => `<option>${SMI.esc(s)}</option>`).join('');
    const today = new Date();
    document.getElementById('date').min = today.toISOString().slice(0, 10);
    document.getElementById('date').value = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
    if (SMI.me && SMI.me.city) {
      const address = document.getElementById('address');
      if (!address.value) address.placeholder = `Address in ${SMI.me.city}`;
    }

    document.getElementById('lower').style.display = '';
    document.getElementById('service').addEventListener('change', updateSummary);

    document.getElementById('bookBtn').addEventListener('click', async (event) => {
      event.preventDefault();
      if (!SMI.me) {
        SMI.toast('Please log in to place a booking.', 'error');
        setTimeout(() => { window.location.href = '/login.html?next=' + encodeURIComponent(window.location.pathname + window.location.search); }, 700);
        return;
      }
      if (SMI.me.role !== 'customer') {
        SMI.toast('Only customer accounts can place bookings.', 'error');
        return;
      }
      const button = event.currentTarget;
      const address = document.getElementById('address').value.trim();
      if (address.length < 10) {
        SMI.toast('Please enter the full service address.', 'error');
        document.getElementById('address').focus();
        return;
      }
      button.disabled = true;
      button.textContent = 'Placing request…';
      const response = await SMI.post('/api/bookings', {
        provider_id: provider.id,
        service_id: selectedService().id,
        date: document.getElementById('date').value,
        slot: document.getElementById('slot').value,
        address,
        notes: document.getElementById('notes').value.trim()
      });
      button.disabled = false;
      button.textContent = 'Request booking';
      if (response.ok) {
        SMI.toast('Booking requested. The professional will confirm shortly.', 'success');
        setTimeout(() => { window.location.href = '/dashboard.html'; }, 900);
      } else {
        SMI.toast(response.error || 'Could not place the booking.', 'error');
      }
    });
  });
}());
