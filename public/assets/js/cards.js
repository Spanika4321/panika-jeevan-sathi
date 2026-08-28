/* ==========================================================================
   PANIKA JEEVAN SATHI — profile card renderer + shared member actions
   Used by the dashboard, search, matches and shortlist pages.
   ========================================================================== */

(function () {
  'use strict';

  function meta(card) {
    const bits = [];
    if (card.age) bits.push(card.age + ' yrs');
    if (card.height_cm) bits.push(PJS.fmt.height(card.height_cm));
    if (card.marital_status) bits.push(card.marital_status);
    return bits.join(' · ');
  }

  function secondLine(card) {
    const bits = [];
    if (card.education) bits.push(card.education);
    if (card.occupation) bits.push(card.occupation);
    return bits.join(', ');
  }

  function locationLine(card) {
    return [card.city, card.state].filter(Boolean).join(', ');
  }

  function cardHtml(card, options) {
    const opts = options || {};
    const name = card.name || 'Member';
    const photo = card.photo
      ? `<img src="${PJS.esc(card.photo)}" alt="${PJS.esc(name)}" loading="lazy">`
      : `<span class="initials">${PJS.esc(PJS.initials(name))}</span>`;

    const scoreBadge =
      opts.score !== undefined && opts.score !== null
        ? `<span class="p-score">${opts.score}% match</span>`
        : '';

    const interestBtn =
      card.interest === 'accepted'
        ? `<button class="btn green sm" data-act="message" data-id="${card.id}">${PJS.icons.check} Connected</button>`
        : card.interest === 'pending'
          ? `<button class="btn ghost sm" disabled>Interest sent</button>`
          : `<button class="btn sm" data-act="interest" data-id="${card.id}" data-name="${PJS.esc(name)}">${PJS.icons.heart} Interest</button>`;

    const messageBtn =
      card.can_message && card.interest !== 'accepted'
        ? `<button class="btn ghost sm" data-act="message" data-id="${card.id}">${PJS.icons.chat} Message</button>`
        : '';

    const reasons = (opts.reasons || [])
      .map((r) => `<span class="chip brand">${PJS.esc(r)}</span>`)
      .join('');

    return `<article class="p-card" data-card="${card.id}">
      <div class="p-photo" data-act="view" data-id="${card.id}" style="cursor:pointer">
        ${photo}${scoreBadge}
        <button class="p-short ${card.shortlisted ? 'on' : ''}" data-act="shortlist" data-id="${card.id}"
                aria-label="Shortlist" title="Shortlist">${PJS.icons.star}</button>
      </div>
      <div class="p-body">
        <h3 class="p-name" data-act="view" data-id="${card.id}" style="cursor:pointer">${PJS.esc(name)}</h3>
        <div class="p-meta">${PJS.esc(meta(card))}</div>
        <div class="p-meta">${PJS.esc(secondLine(card))}</div>
        ${locationLine(card) ? `<div class="p-meta">${PJS.icons.pin} ${PJS.esc(locationLine(card))}</div>` : ''}
        ${card.community ? `<div class="p-tags"><span class="chip">${PJS.esc(card.community)}</span>${
          card.religion ? `<span class="chip">${PJS.esc(card.religion)}</span>` : ''}</div>` : ''}
        ${reasons ? `<div class="p-tags">${reasons}</div>` : ''}
        <div class="p-actions">
          ${interestBtn}
          ${messageBtn}
          <button class="btn ghost sm" data-act="view" data-id="${card.id}">View</button>
        </div>
      </div>
    </article>`;
  }

  /**
   * Render a list of profile cards into a container and wire up the actions.
   * @param {HTMLElement} container
   * @param {Array} items  array of cards, or {card, score, reasons}
   */
  function render(container, items, options) {
    const opts = options || {};
    const list = items || [];
    if (!list.length) {
      container.className = 'empty';
      container.style.cssText = '';
      container.innerHTML = `<div class="ic">${PJS.icons.search}</div>
        <h3>${PJS.esc(opts.emptyTitle || 'No profiles found')}</h3>
        <p>${PJS.esc(opts.emptyText || 'Try widening your filters, or check back as new members join.')}</p>
        ${opts.emptyAction || ''}`;
      return;
    }
    container.className = 'cards';
    container.style.cssText = opts.style || '';
    container.innerHTML = list
      .map((item) => {
        const card = item.card || item;
        return cardHtml(card, { score: item.score, reasons: item.reasons });
      })
      .join('');
    wire(container, options.onChanged);
  }

  function wire(container, onChanged) {
    container.querySelectorAll('[data-act]').forEach((el) => {
      el.addEventListener('click', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const act = el.getAttribute('data-act');
        const id = Number(el.getAttribute('data-id'));
        if (act === 'view') {
          window.location.href = '/profile.html?id=' + id;
          return;
        }
        if (act === 'shortlist') {
          el.disabled = true;
          const res = await PJS.post('/api/shortlist', { user_id: id });
          el.disabled = false;
          if (res.ok) {
            el.classList.toggle('on', res.shortlisted);
            PJS.toast(res.message, 'success');
            if (onChanged) onChanged();
          } else {
            PJS.toast(res.error || 'Could not update shortlist', 'error');
          }
          return;
        }
        if (act === 'interest') {
          el.disabled = true;
          const res = await PJS.post('/api/interests', { to_user_id: id });
          el.disabled = false;
          if (res.ok) {
            PJS.toast(res.message || 'Interest sent', 'success');
            if (onChanged) onChanged();
          } else {
            PJS.toast(res.error || 'Could not send interest', 'error');
          }
          return;
        }
        if (act === 'message') {
          window.location.href = '/messages.html?with=' + id;
        }
      });
    });
  }

  PJS.cards = { render: render, cardHtml: cardHtml, wire: wire };
})();
