/* SEVA MARKET INDIA — customer dashboard */
(function () {
  'use strict';

  let bookings = [];

  function openModal(html) {
    const back = document.getElementById('modalBack');
    document.getElementById('modal').innerHTML = html;
    back.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('modalBack').classList.remove('open');
    document.getElementById('modal').innerHTML = '';
    document.body.style.overflow = '';
  }

  function bookingCard(b) {
    const actions = [];
    if (b.status === 'requested' || b.status === 'accepted') {
      actions.push(`<button class="btn btn-ghost btn-sm" data-cancel="${b.id}">Cancel booking</button>`);
    }
    if (b.status === 'completed' && !b.reviewed) {
      actions.push(`<button class="btn btn-primary btn-sm" data-review="${b.id}">Write a review</button>`);
    }
    if (b.status === 'completed' && b.reviewed) {
      actions.push('<span class="badge">Reviewed</span>');
    }

    return `
      <div class="list-item">
        <div class="avatar sm">${SMI.esc(SMI.initials(b.business_name))}</div>
        <div class="grow">
          <div class="row row-wrap spread">
            <strong>${SMI.esc(b.service_name)}</strong>
            ${SMI.statusBadge(b.status)}
          </div>
          <div class="small muted">${SMI.esc(b.business_name)} · ${SMI.esc(b.provider_city)}</div>
          <div class="small muted mt-1">
            ${SMI.icon('calendar', 14)} ${SMI.esc(SMI.fmtDate(b.date))} · ${SMI.esc(b.slot)}
          </div>
          <div class="small muted">${SMI.icon('pin', 14)} ${SMI.esc(b.address)}</div>
          ${b.notes ? `<div class="small muted">Note: ${SMI.esc(b.notes)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--serif);font-size:19px;font-weight:700">${SMI.money(b.price)}</div>
          <div class="row" style="gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap">${actions.join('')}</div>
        </div>
      </div>`;
  }

  function render() {
    const active = bookings.filter((b) => ['requested', 'accepted'].includes(b.status));
    const history = bookings.filter((b) => !['requested', 'accepted'].includes(b.status));

    document.getElementById('stats').innerHTML = [
      [bookings.length, 'Total bookings'],
      [active.length, 'Active requests'],
      [bookings.filter((b) => b.status === 'completed').length, 'Jobs completed'],
      [SMI.money(bookings.filter((b) => b.status === 'completed').reduce((sum, b) => sum + b.price, 0)), 'Total spend']
    ].map((s) => `<div class="stat"><strong>${s[0]}</strong><span>${SMI.esc(s[1])}</span></div>`).join('');

    document.getElementById('active').innerHTML = active.length
      ? active.map(bookingCard).join('')
      : '<div class="card empty"><h3>No active bookings</h3><p class="small">When you book a professional it will appear here.</p><a class="btn btn-primary btn-sm mt-2" href="/providers.html">Browse professionals</a></div>';

    document.getElementById('history').innerHTML = history.length
      ? history.map(bookingCard).join('')
      : '<div class="card empty"><p class="small mb-0">Your completed and cancelled bookings will appear here.</p></div>';
  }

  function reviewModal(booking) {
    openModal(`
      <h3 style="margin-top:0">Rate your experience</h3>
      <p class="small muted">${SMI.esc(booking.service_name)} · ${SMI.esc(booking.business_name)}</p>
      <div class="field mb-2">
        <label>Rating</label>
        <select id="reviewRating">
          <option value="5">5 — Excellent</option>
          <option value="4">4 — Very good</option>
          <option value="3">3 — Satisfactory</option>
          <option value="2">2 — Needs improvement</option>
          <option value="1">1 — Poor</option>
        </select>
      </div>
      <div class="field mb-2">
        <label for="reviewComment">Your review</label>
        <textarea id="reviewComment" placeholder="What went well? What could be better?"></textarea>
      </div>
      <div class="row" style="justify-content:flex-end;gap:10px">
        <button class="btn btn-ghost btn-sm" data-x="close">Cancel</button>
        <button class="btn btn-primary btn-sm" data-x="submitReview" data-id="${booking.id}">Submit review</button>
      </div>`);
  }

  SMI.boot().then(async () => {
    if (!SMI.me) {
      window.location.href = '/login.html?next=/dashboard.html';
      return;
    }
    if (SMI.me.role !== 'customer') {
      window.location.href = SMI.me.role === 'admin' ? '/admin.html' : '/provider-dashboard.html';
      return;
    }

    const result = await SMI.get('/api/bookings');
    bookings = result.ok ? result.bookings : [];
    render();

    document.getElementById('modalBack').addEventListener('click', (event) => {
      if (event.target === document.getElementById('modalBack')) closeModal();
    });

    document.addEventListener('click', async (event) => {
      const cancel = event.target.closest('[data-cancel]');
      if (cancel) {
        const id = Number(cancel.getAttribute('data-cancel'));
        const response = await SMI.patch(`/api/bookings/${id}`, { status: 'cancelled' });
        if (response.ok) {
          SMI.toast('Booking cancelled.', 'success');
          bookings = (await SMI.get('/api/bookings')).bookings || [];
          render();
        } else SMI.toast(response.error || 'Could not cancel the booking.', 'error');
      }

      const review = event.target.closest('[data-review]');
      if (review) {
        const id = Number(review.getAttribute('data-review'));
        reviewModal(bookings.find((b) => b.id === id));
      }

      if (event.target.closest('[data-x="close"]')) closeModal();

      const submit = event.target.closest('[data-x="submitReview"]');
      if (submit) {
        const id = Number(submit.getAttribute('data-id'));
        const response = await SMI.post('/api/reviews', {
          booking_id: id,
          rating: Number(document.getElementById('reviewRating').value),
          comment: document.getElementById('reviewComment').value
        });
        if (response.ok) {
          SMI.toast('Thank you — your review is published.', 'success');
          closeModal();
          bookings = (await SMI.get('/api/bookings')).bookings || [];
          render();
        } else SMI.toast(response.error || 'Could not save the review.', 'error');
      }
    });
  });
}());
