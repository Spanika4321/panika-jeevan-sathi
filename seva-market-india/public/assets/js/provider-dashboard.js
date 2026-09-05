/* SEVA MARKET INDIA — professional dashboard */
(function () {
  'use strict';

  let bookings = [];
  let provider = null;

  function jobCard(b) {
    const actions = [];
    if (b.status === 'requested') {
      actions.push(`<button class="btn btn-primary btn-sm" data-status="accepted" data-id="${b.id}">Accept</button>`);
      actions.push(`<button class="btn btn-danger btn-sm" data-status="declined" data-id="${b.id}">Decline</button>`);
    }
    if (b.status === 'accepted') {
      actions.push(`<button class="btn btn-primary btn-sm" data-status="completed" data-id="${b.id}">Mark completed</button>`);
      actions.push(`<button class="btn btn-ghost btn-sm" data-status="cancelled" data-id="${b.id}">Cancel</button>`);
    }

    return `
      <div class="list-item">
        <div class="avatar sm">${SMI.esc(SMI.initials(b.customer_name || 'C'))}</div>
        <div class="grow">
          <div class="row row-wrap spread">
            <strong>${SMI.esc(b.service_name)}</strong>
            ${SMI.statusBadge(b.status)}
          </div>
          <div class="small muted">${SMI.esc(b.customer_name)} · ${SMI.esc(SMI.fmtDate(b.date))} · ${SMI.esc(b.slot)}</div>
          <div class="small muted mt-1">${SMI.icon('pin', 14)} ${SMI.esc(b.address)}</div>
          ${b.notes ? `<div class="small muted">Note: ${SMI.esc(b.notes)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--serif);font-size:19px;font-weight:700">${SMI.money(b.price)}</div>
          <div class="row" style="gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap">${actions.join('')}</div>
        </div>
      </div>`;
  }

  function render() {
    const open = bookings.filter((b) => ['requested', 'accepted'].includes(b.status));
    const closed = bookings.filter((b) => !['requested', 'accepted'].includes(b.status));

    document.getElementById('stats').innerHTML = [
      [open.filter((b) => b.status === 'requested').length, 'New requests'],
      [open.filter((b) => b.status === 'accepted').length, 'Jobs accepted'],
      [bookings.filter((b) => b.status === 'completed').length, 'Jobs completed'],
      [SMI.money(bookings.filter((b) => b.status === 'completed').reduce((sum, b) => sum + b.price, 0)), 'Earnings']
    ].map((s) => `<div class="stat"><strong>${s[0]}</strong><span>${SMI.esc(s[1])}</span></div>`).join('');

    document.getElementById('requests').innerHTML = open.length
      ? open.map(jobCard).join('')
      : '<div class="card empty"><h3>No open requests</h3><p class="small">New booking requests from customers in your city will appear here.</p></div>';

    document.getElementById('closed').innerHTML = closed.length
      ? closed.map(jobCard).join('')
      : '<div class="card empty"><p class="small mb-0">Completed and closed jobs will be listed here.</p></div>';
  }

  function fillProfile() {
    if (!provider) return;
    document.getElementById('title').textContent = provider.business_name;
    document.getElementById('profileStatus').innerHTML = provider.status === 'approved'
      ? '<span class="badge">Profile live</span>'
      : `<span class="badge badge-amber">${SMI.esc(provider.status)} — under review</span>`;
    document.getElementById('business').value = provider.business_name || '';
    document.getElementById('city').value = provider.city || '';
    document.getElementById('area').value = provider.area || '';
    document.getElementById('category').value = provider.category_slug || '';
    document.getElementById('experience').value = provider.experience_years || 0;
    document.getElementById('price_from').value = provider.price_from || 0;
    document.getElementById('headline').value = provider.headline || '';
    document.getElementById('bio').value = provider.bio || '';
  }

  SMI.boot().then(async () => {
    if (!SMI.me) {
      window.location.href = '/login.html?next=/provider-dashboard.html';
      return;
    }
    if (SMI.me.role !== 'provider') {
      window.location.href = SMI.me.role === 'admin' ? '/admin.html' : '/dashboard.html';
      return;
    }

    SMI.cities.forEach((c) => document.getElementById('city').add(new Option(`${c.name}, ${c.state}`, c.name)));
    SMI.categories.forEach((c) => document.getElementById('category').add(new Option(c.name, c.slug)));

    const me = await SMI.get('/api/me');
    provider = me.ok ? me.provider : null;
    bookings = (me.ok && me.provider && me.provider.bookings) || [];
    fillProfile();
    render();

    document.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-status]');
      if (button) {
        const id = Number(button.getAttribute('data-id'));
        const status = button.getAttribute('data-status');
        const response = await SMI.patch(`/api/bookings/${id}`, { status });
        if (response.ok) {
          SMI.toast(`Booking ${status}.`, 'success');
          const refresh = await SMI.get('/api/me');
          bookings = (refresh.ok && refresh.provider && refresh.provider.bookings) || [];
          render();
        } else SMI.toast(response.error || 'Could not update the booking.', 'error');
      }
    });

    document.getElementById('saveProfile').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Saving…';
      const response = await SMI.put('/api/provider/me', {
        business_name: document.getElementById('business').value,
        city: document.getElementById('city').value,
        area: document.getElementById('area').value,
        category: document.getElementById('category').value,
        experience_years: Number(document.getElementById('experience').value) || 0,
        price_from: Number(document.getElementById('price_from').value) || 0,
        headline: document.getElementById('headline').value,
        bio: document.getElementById('bio').value
      });
      button.disabled = false;
      button.textContent = 'Save profile';
      if (response.ok) {
        provider = response.provider;
        SMI.toast('Profile saved.', 'success');
        fillProfile();
      } else SMI.toast(response.error || 'Could not save the profile.', 'error');
    });
  });
}());
