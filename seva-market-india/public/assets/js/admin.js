/* SEVA MARKET INDIA — admin panel */
(function () {
  'use strict';

  async function loadStats() {
    const result = await SMI.get('/api/admin/stats');
    if (!result.ok) {
      document.getElementById('stats').innerHTML = '<div class="card empty" style="grid-column:1/-1">Administrator access required.</div>';
      return false;
    }
    const s = result.stats;
    document.getElementById('stats').innerHTML = [
      [s.customers, 'Registered customers'],
      [s.providers_approved, 'Live professionals'],
      [s.providers_pending, 'Awaiting approval'],
      [s.bookings_requested, 'Open booking requests'],
      [s.bookings_completed, 'Jobs completed'],
      [SMI.money(s.revenue), 'Gross booking value']
    ].map((item) => `<div class="stat"><strong>${item[0]}</strong><span>${SMI.esc(item[1])}</span></div>`).join('');

    const pending = result.pending_providers || [];
    document.getElementById('pendingRows').innerHTML = pending.length
      ? pending.map((p) => `
          <tr>
            <td><strong>${SMI.esc(p.business_name)}</strong></td>
            <td>${SMI.esc(p.category_name)}</td>
            <td>${SMI.esc(p.city)}</td>
            <td>${p.experience_years} yrs</td>
            <td>
              <button class="btn btn-primary btn-sm" data-approve="${p.id}">Approve</button>
              <button class="btn btn-danger btn-sm" data-suspend="${p.id}">Reject</button>
            </td>
          </tr>`).join('')
      : '';
    document.getElementById('pendingEmpty').textContent = pending.length
      ? '' : 'Nothing to review — every professional has been processed.';

    document.getElementById('bookingRows').innerHTML = (result.recent || []).map((b) => `
      <tr>
        <td>#${b.id}</td>
        <td>${SMI.esc(b.customer_name)}</td>
        <td>${SMI.esc(b.business_name)}</td>
        <td>${SMI.esc(b.service_name)}</td>
        <td>${SMI.esc(SMI.fmtDate(b.date))}</td>
        <td>${SMI.money(b.price)}</td>
        <td>${SMI.statusBadge(b.status)}</td>
      </tr>`).join('');
    return true;
  }

  async function loadProviders() {
    const status = document.getElementById('statusFilter').value;
    const result = await SMI.get(`/api/admin/providers?status=${encodeURIComponent(status)}`);
    if (!result.ok) return;
    const rows = result.providers || [];
    document.getElementById('providerRows').innerHTML = rows.length
      ? rows.map((p) => `
          <tr>
            <td><strong>${SMI.esc(p.business_name)}</strong></td>
            <td>${SMI.esc(p.category_name)}</td>
            <td>${SMI.esc(p.city)}</td>
            <td>${Number(p.rating || 0).toFixed(1)} (${p.rating_count})</td>
            <td>${SMI.statusBadge(p.status)}${p.verified ? ' <span class="badge badge-blue">Verified</span>' : ''}</td>
            <td>
              ${p.status === 'approved'
                ? `<button class="btn btn-danger btn-sm" data-suspend="${p.id}">Suspend</button>`
                : `<button class="btn btn-primary btn-sm" data-approve="${p.id}">Approve</button>`}
              <button class="btn btn-ghost btn-sm" data-verify="${p.id}" data-value="${p.verified ? 0 : 1}">
                ${p.verified ? 'Unverify' : 'Verify'}
              </button>
            </td>
          </tr>`).join('')
      : '<tr><td colspan="6" class="muted">No professionals in this status.</td></tr>';
  }

  SMI.boot().then(async () => {
    if (!SMI.me) {
      window.location.href = '/login.html?next=/admin.html';
      return;
    }
    const ok = await loadStats();
    if (!ok) return;
    await loadProviders();

    document.getElementById('statusFilter').addEventListener('change', loadProviders);

    document.addEventListener('click', async (event) => {
      const approve = event.target.closest('[data-approve]');
      const suspend = event.target.closest('[data-suspend]');
      const verify = event.target.closest('[data-verify]');
      let response = null;

      if (approve) response = await SMI.patch(`/api/admin/providers/${approve.getAttribute('data-approve')}`, { status: 'approved' });
      if (suspend) response = await SMI.patch(`/api/admin/providers/${suspend.getAttribute('data-suspend')}`, { status: 'suspended' });
      if (verify) response = await SMI.patch(`/api/admin/providers/${verify.getAttribute('data-verify')}`, { status: 'approved', verified: verify.getAttribute('data-value') === '1' });

      if (response) {
        if (response.ok) {
          SMI.toast('Updated.', 'success');
          await loadStats();
          await loadProviders();
        } else SMI.toast(response.error || 'Could not update this professional.', 'error');
      }
    });
  });
}());
