'use strict';
/**
 * SEVA MARKET INDIA — homepage.
 *
 * A big-marketplace-style landing page: coloured hero with the search
 * action up front, trust strip, coverage stats, a colourful category grid,
 * live service cards (rendered from the database), how-it-works steps and
 * provider CTAs. Mobile-first, still one h1, still zero inline scripts.
 */

const { esc, tintIndex, serviceCardMarkup } = require('./ui');

function searchFormMarkup() {
  return `
    <form class="search" action="/search" method="get" role="search" data-search-form>
      <div class="search__field">
        <label for="q">What service do you need?</label>
        <input id="q" name="q" type="search" autocomplete="off"
               placeholder="Plumber, electrician, tutor..." maxlength="80">
      </div>
      <div class="search__field">
        <label for="place">City or locality</label>
        <input id="place" name="place" type="search" autocomplete="off"
               placeholder="Guwahati, Andheri, Indiranagar..." maxlength="80">
      </div>
      <div class="search__field">
        <label for="pin">PIN code</label>
        <input id="pin" name="pin" type="text" inputmode="numeric" pattern="[1-9][0-9]{5}"
               autocomplete="postal-code" placeholder="781001" maxlength="6">
      </div>
      <button class="btn btn--orange search__submit" type="submit">Find services</button>
    </form>`;
}

function statsMarkup(stats) {
  const items = [
    { value: stats.states, label: 'States & UTs' },
    { value: stats.cities, label: 'Cities' },
    { value: stats.pincodes, label: 'PIN codes' },
    { value: stats.categories, label: 'Service categories' },
    { value: stats.providers, label: 'Listed providers' },
  ];
  return items
    .map(
      (item) => `
        <li class="stat">
          <span class="stat__value">${esc(item.value)}</span>
          <span class="stat__label">${esc(item.label)}</span>
        </li>`,
    )
    .join('');
}

function trustRibbonMarkup() {
  const items = [
    { icon: '🛡️', title: 'Verified providers', text: 'Every pro is checked before they get the badge' },
    { icon: '📞', title: 'Talk directly', text: 'Call or enquire — zero commission, no middleman' },
    { icon: '📍', title: 'Hyperlocal by PIN', text: 'Listings organised down to your locality' },
    { icon: '💸', title: 'Free to list', text: 'Providers register and list their services free' },
  ];
  return items
    .map(
      (item, index) => `
        <li class="trust-card tint-${index}">
          <span class="trust-card__icon" aria-hidden="true">${item.icon}</span>
          <span class="trust-card__body">
            <strong>${esc(item.title)}</strong>
            <span>${esc(item.text)}</span>
          </span>
        </li>`,
    )
    .join('');
}

function categoryGridMarkup(categories) {
  if (!categories.length) {
    return `<p class="empty">Categories are being seeded. Run <code>npm run seed</code> to populate them.</p>`;
  }
  return categories
    .map(
      (category) => `
        <a class="category-card tint-${tintIndex(category.slug)}" href="/search?category=${esc(category.slug)}">
          <span class="category-card__icon" aria-hidden="true">${esc(category.icon || '🧰')}</span>
          <span class="category-card__body">
            <span class="category-card__name">${esc(category.name)}</span>
            <span class="category-card__count">${esc(category.service_count)} ${category.service_count === 1 ? 'service' : 'services'}</span>
          </span>
        </a>`,
    )
    .join('');
}

function stateListMarkup(states) {
  if (!states.length) return '';
  return states
    .map((state) => `<li><a href="/search?state=${esc(state.slug)}">${esc(state.name)}</a></li>`)
    .join('');
}

/**
 * @param {object} data
 * @param {{states:number,cities:number,pincodes:number,categories:number,providers:number}} data.stats
 * @param {Array} data.popularCategories   leaf categories with live counts
 * @param {Array} data.states              first N states
 * @param {Array} data.featured            live services ({items, total})
 * @param {{name: string, tagline: string}} data.site
 */
function homeBody({ stats, popularCategories, states, featured, site }) {
  return `
    <section class="hero">
      <div class="hero__bg" aria-hidden="true"></div>
      <div class="container hero__grid">
        <div class="hero__copy">
          <p class="hero__eyebrow">🇮🇳 India's local services marketplace</p>
          <h1 class="hero__title">Every home service, <span class="hero__accent">from trusted local pros</span></h1>
          <p class="hero__lede">Plumbers, electricians, tutors, photographers, mechanics &amp; more — search by city or
            PIN code and contact the provider directly. No middleman, no commission.</p>
          <ul class="hero__points">
            <li><span aria-hidden="true">✅</span> Verified local providers</li>
            <li><span aria-hidden="true">✅</span> Transparent, up-front pricing</li>
            <li><span aria-hidden="true">✅</span> Free to list your own service</li>
          </ul>
        </div>
        <div class="hero__panel">
          <h2 class="hero__panel-title">What do you need done?</h2>
          ${searchFormMarkup()}
          <p class="hero__panel-hint">Popular:</p>
          <ul class="hero__chips" aria-label="Popular searches">
            <li><a class="chip" href="/search?q=plumber">Plumber</a></li>
            <li><a class="chip" href="/search?q=electrician">Electrician</a></li>
            <li><a class="chip" href="/search?q=carpenter">Carpenter</a></li>
            <li><a class="chip" href="/search?q=tutor">Home tutor</a></li>
            <li><a class="chip" href="/search?q=cleaning">Deep cleaning</a></li>
            <li><a class="chip" href="/search?q=wedding">Wedding</a></li>
          </ul>
        </div>
      </div>
    </section>

    <section class="ribbon" aria-label="Why use ${esc(site.name)}">
      <div class="container">
        <ul class="ribbon__list">${trustRibbonMarkup()}</ul>
      </div>
    </section>

    <section class="stats-band" aria-label="Marketplace coverage">
      <div class="container">
        <ul class="stats">${statsMarkup(stats)}</ul>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section__head">
          <h2 class="section__title">Browse by category</h2>
          <a class="section__link" href="/categories">All categories →</a>
        </div>
        <div class="category-grid">${categoryGridMarkup(popularCategories)}</div>
      </div>
    </section>

    ${featured && featured.items && featured.items.length ? `
    <section class="section section--tinted">
      <div class="container">
        <div class="section__head">
          <h2 class="section__title">Popular services near you</h2>
          <a class="section__link" href="/search">View all services →</a>
        </div>
        <div class="service-grid">
          ${featured.items.map((service) => serviceCardMarkup(service)).join('\n')}
        </div>
      </div>
    </section>` : ''}

    <section class="section section--muted">
      <div class="container">
        <div class="section__head">
          <h2 class="section__title">How ${esc(site.name)} works</h2>
          <p class="section__lede">Three steps between “I need help” and “done”.</p>
        </div>
        <ol class="steps">
          <li class="step tint-0">
            <span class="step__num" aria-hidden="true">1</span>
            <h3 class="step__title">Search your area</h3>
            <p class="step__text">Enter a service and your city, locality or PIN code. Every listing is pinned to a real place, right down to the PIN code.</p>
          </li>
          <li class="step tint-1">
            <span class="step__num" aria-hidden="true">2</span>
            <h3 class="step__title">Compare providers</h3>
            <p class="step__text">See experience, ratings, coverage and clear pricing. Verified providers are marked so you know who has been checked.</p>
          </li>
          <li class="step tint-2">
            <span class="step__num" aria-hidden="true">3</span>
            <h3 class="step__title">Contact directly</h3>
            <p class="step__text">Call the provider or send an enquiry. No middleman, no hidden charges, no commission on your first contact.</p>
          </li>
        </ol>
      </div>
    </section>

    <section class="section">
      <div class="container section__split">
        <div>
          <h2 class="section__title">Serving every state &amp; UT</h2>
          <p class="section__lede">From metros to tier-3 towns, listings are organised as
            State &rarr; District &rarr; City &rarr; Locality &rarr; PIN code.</p>
          <a class="btn btn--primary" href="/locations">Explore locations</a>
        </div>
        <ul class="pill-list">${stateListMarkup(states)}</ul>
      </div>
    </section>

    <section class="cta-band">
      <div class="container cta-band__inner">
        <div class="cta-band__copy">
          <p class="cta-band__eyebrow">For service providers</p>
          <h2 class="cta-band__title">Own your trade? Get found by customers near you.</h2>
          <p class="cta-band__lede">Create a free account, add your business and services in minutes, and start receiving
            enquiries from your area. No listing fees — ever.</p>
        </div>
        <div class="cta-band__actions">
          <a class="btn btn--yellow btn--lg" href="/register?role=provider">Register &amp; list free</a>
          <a class="btn btn--white-line btn--lg" href="/providers/new">How it works</a>
        </div>
      </div>
    </section>`;
}

module.exports = { homeBody, searchFormMarkup, statsMarkup, categoryGridMarkup, stateListMarkup, trustRibbonMarkup };
