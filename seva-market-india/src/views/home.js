'use strict';
/**
 * SEVA MARKET INDIA — homepage.
 *
 * Mobile-first, built around the one action that matters: search by
 * service + location + PIN. The stats strip and category grid are rendered
 * from the database so the page is honest about what is actually live.
 */

const { esc } = require('./escape');

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
      <button class="btn btn--primary search__submit" type="submit">Find services</button>
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

function categoryGridMarkup(categories) {
  if (!categories.length) {
    return `<p class="empty">Categories are being seeded. Run <code>npm run seed</code> to populate them.</p>`;
  }
  return categories
    .map(
      (category) => `
        <a class="category-card" href="/search?category=${esc(category.slug)}">
          <span class="category-card__icon" aria-hidden="true">${esc(category.icon || '🔧')}</span>
          <span class="category-card__name">${esc(category.name)}</span>
          <span class="category-card__count">${esc(category.service_count)} ${category.service_count === 1 ? 'service' : 'services'}</span>
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
 * @param {Array} data.popularCategories
 * @param {Array} data.states
 * @param {{name: string, tagline: string}} data.site
 */
function homeBody({ stats, popularCategories, states, site }) {
  return `
    <section class="hero">
      <div class="container">
        <p class="hero__eyebrow">India-wide local services marketplace</p>
        <h1 class="hero__title">Find trusted local service providers <span class="hero__accent">near you</span></h1>
        <p class="hero__lede">${esc(site.tagline)} Search by service, city or PIN code — then contact the provider directly.</p>
        ${searchFormMarkup()}
        <ul class="hero__chips" aria-label="Popular searches">
          <li><a class="chip" href="/search?q=plumber">Plumber</a></li>
          <li><a class="chip" href="/search?q=electrician">Electrician</a></li>
          <li><a class="chip" href="/search?q=carpenter">Carpenter</a></li>
          <li><a class="chip" href="/search?q=tutor">Home tutor</a></li>
          <li><a class="chip" href="/search?q=cleaning">Deep cleaning</a></li>
        </ul>
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
          <a class="section__link" href="/categories">All categories</a>
        </div>
        <div class="category-grid">${categoryGridMarkup(popularCategories)}</div>
      </div>
    </section>

    <section class="section section--muted">
      <div class="container">
        <h2 class="section__title">How ${esc(site.name)} works</h2>
        <ol class="steps">
          <li class="step">
            <span class="step__num" aria-hidden="true">1</span>
            <h3 class="step__title">Search your area</h3>
            <p class="step__text">Enter a service and your city, locality or PIN code. Every listing is pinned to a real place.</p>
          </li>
          <li class="step">
            <span class="step__num" aria-hidden="true">2</span>
            <h3 class="step__title">Compare providers</h3>
            <p class="step__text">See experience, pricing and coverage. Verified providers are marked so you know who has been checked.</p>
          </li>
          <li class="step">
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
          <a class="btn btn--ghost" href="/locations">Explore locations</a>
        </div>
        <ul class="pill-list">${stateListMarkup(states)}</ul>
      </div>
    </section>

    <section class="section section--cta">
      <div class="container section__cta">
        <div>
          <h2 class="section__title">Are you a service provider?</h2>
          <p class="section__lede">List your business once and get found by customers searching in your PIN code.</p>
        </div>
        <a class="btn btn--primary" href="/providers/new">List your service</a>
      </div>
    </section>`;
}

module.exports = { homeBody, searchFormMarkup, statsMarkup, categoryGridMarkup, stateListMarkup };
