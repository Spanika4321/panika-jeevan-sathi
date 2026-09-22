'use strict';
/**
 * Server-rendered public pages for communities, places and guides.
 * Same location tree as the profile dropdown, so a page that says "select
 * Raipur" is the same string the search filter stores.
 */

const fs = require('node:fs');
const path = require('node:path');
const locations = require('./locations');

const SITE = 'PANIKA JEEVAN SATHI';
const ORIGIN_FALLBACK = 'https://panikajeevansathi.onrender.com';
const VERIFICATION = 'KUEY7AjRRY6ZhMJhPx1otFcfCkDxVrARnY1syD3rR-o';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function words(parts) {
  return parts.filter(Boolean).join(' ').split(/\s+/).filter(Boolean).length;
}

function canonicalize(pathname) {
  let pathName = String(pathname || '');
  if (pathName.length > 1 && pathName.endsWith('/')) pathName = pathName.replace(/\/+$/, '');
  pathName = pathName.toLowerCase();
  if (pathName === '/community') pathName = '/communities';
  else if (pathName.startsWith('/community/')) pathName = `/communities/${pathName.slice('/community/'.length)}`;
  else if (pathName === '/place' || pathName === '/places' || pathName === '/matrimony') pathName = '/locations';
  else if (pathName === '/guide') pathName = '/guides';
  return pathName;
}

function isSeoPath(pathname) {
  return pathname === '/communities' || pathname === '/locations' || pathname === '/guides'
    || pathname.startsWith('/communities/') || pathname.startsWith('/locations/') || pathname.startsWith('/guides/');
}

function lookup(pathname) {
  if (!pathname || !pathname.startsWith('/') || pathname.includes('..') || pathname.includes('\\') || pathname.includes('//')) {
    return null;
  }
  const canonical = canonicalize(pathname);
  if (!isSeoPath(canonical)) return null;
  if (canonical !== pathname) return { redirect: canonical };
  const page = build(canonical);
  if (!page) return { notFound: true };
  return { page };
}

function indexablePaths() {
  const paths = ['/communities'];
  for (const item of locations.COMMUNITIES) paths.push(`/communities/${item.slug}`);
  paths.push('/locations');
  for (const state of locations.STATES) {
    if (!state.page) continue;
    paths.push(`/locations/${state.slug}`);
    for (const item of state.cities) {
      if (item.page) paths.push(`/locations/${state.slug}/${item.slug}`);
    }
  }
  paths.push('/guides');
  for (const item of locations.GUIDES) paths.push(`/guides/${item.slug}`);
  return paths;
}

function contentLastMod() {
  const files = [__filename, path.join(__dirname, 'locations.js')];
  let newest = 0;
  for (const file of files) {
    try { newest = Math.max(newest, fs.statSync(file).mtimeMs); } catch (_) { /* ignore */ }
  }
  return new Date(newest || Date.now()).toISOString().slice(0, 10);
}

function searchLogin(stateName, cityName) {
  const params = new URLSearchParams();
  if (stateName) params.set('state', stateName);
  if (cityName) params.set('city', cityName);
  const target = `/search.html${params.toString() ? `?${params.toString()}` : ''}`;
  return `/login.html?next=${encodeURIComponent(target)}`;
}

function build(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'communities') return parts.length === 1 ? communityHub() : communityPage(parts[1]);
  if (parts[0] === 'guides') return parts.length === 1 ? guideHub() : guidePage(parts[1]);
  if (parts[0] === 'locations') {
    if (parts.length === 1) return locationHub();
    if (parts.length === 2) return statePage(parts[1]);
    if (parts.length === 3) return cityPage(parts[1], parts[2]);
  }
  return null;
}

function communityHub() {
  return page({
    path: '/communities',
    eyebrow: 'Who the service is for',
    h1: 'Panika, Manikpuri, Kabirpanthi and Adivasi',
    hindi: 'यह सेवा किन समाजों के लिए है',
    description: 'Which community name to select on PANIKA JEEVAN SATHI, and why Panika, Manikpuri, Kabirpanthi and Adivasi are separate filters.',
    crumbs: [crumbHome(), { label: 'Communities' }],
    blocks: [
      {
        paragraphs: [
          'The notice on the homepage is the rule: this matrimonial service is for Panika, Manikpuri, Kabirpanthi and Adivasi families. Those four words are four filters, not four ways of writing the same thing. Your profile can store one community. Relatives who search a different word will not see you unless they leave the filter empty.',
          'Pick the word your elders will say when they propose the rishta. If the house uses two words, read both pages before you choose, put the second word in About me, and search both yourself. Two accounts for one person are not the way to appear in both filters.',
          'Religion / Panth is a separate box. Kabirpanth does not fill Community. Gotra is free text, in the word your family uses, including bansa where that is the local word. These pages do not list members, and they do not collect certificates.'
        ]
      },
      {
        heading: 'Choose the name your family uses',
        links: locations.COMMUNITIES.map((item) => ({
          href: `/communities/${item.slug}`,
          label: item.name,
          text: item.summary
        }))
      },
      {
        heading: 'Then set a real place',
        paragraphs: [
          'A community filter without a city still leaves the other family guessing about the journey. After you pick the name, set State and City from the same dropdown the place pages describe. Chhattisgarh, Madhya Pradesh, Odisha, Jharkhand, Uttar Pradesh, Maharashtra, Assam, West Bengal, Bihar and Delhi each have a page. Other states are in the form even where they do not have a page.'
        ],
        links: [
          { href: '/locations', label: 'Places families search', text: 'State pages, city pages, and the rule for towns that are not listed.' },
          { href: '/guides/how-to-create-a-profile', label: 'How to create a profile', text: 'Which fields search can read, and which fields it ignores.' },
          { href: '/guides/family-gotra-and-introductions', label: 'Gotra and introductions', text: 'What to type, and what not to copy from another website.' }
        ]
      }
    ]
  });
}

function communityPage(slug) {
  const item = locations.findCommunity(slug);
  if (!item || slug !== item.slug) return null;
  const also = item.also.length ? ` Also called ${item.also.join(' and ')}.` : '';
  return page({
    path: `/communities/${item.slug}`,
    eyebrow: 'Community',
    h1: `${item.name} matrimonial`,
    hindi: `${item.hindi} परिवारों के लिए मुफ्त रिश्ता खोज`,
    description: `${item.name} on PANIKA JEEVAN SATHI.${also} ${item.summary}`.slice(0, 170),
    crumbs: [crumbHome(), { href: '/communities', label: 'Communities' }, { label: item.name }],
    blocks: [
      { paragraphs: item.paragraphs },
      {
        heading: 'Other names on this site',
        links: locations.COMMUNITIES.filter((other) => other.slug !== item.slug).map((other) => ({
          href: `/communities/${other.slug}`,
          label: other.name,
          text: other.summary
        }))
      },
      {
        heading: 'Places to set on the profile',
        links: locations.STATES.filter((state) => state.page).slice(0, 6).map((state) => ({
          href: `/locations/${state.slug}`,
          label: state.name,
          text: state.summary
        }))
      },
      { faqs: item.faqs }
    ],
    aside: [
      { href: '/login.html?tab=register', label: 'Create a free profile' },
      { href: searchLogin(), label: 'Log in to search' },
      { href: '/guides/family-gotra-and-introductions', label: 'Gotra and introductions' },
      { href: '/locations', label: 'All places' }
    ]
  });
}

function locationHub() {
  const withPages = locations.STATES.filter((state) => state.page);
  const withoutPages = locations.STATES.filter((state) => !state.page);
  return page({
    path: '/locations',
    eyebrow: 'Places',
    h1: 'Where families search',
    hindi: 'किस शहर और राज्य में रिश्ता खोजें',
    description: 'State and city pages for PANIKA JEEVAN SATHI. The city names match the profile dropdown, so a Raipur page and a Raipur filter are the same spelling.',
    crumbs: [crumbHome(), { label: 'Places' }],
    blocks: [
      {
        paragraphs: [
          'These pages do not list members. Names, photos and phone numbers stay behind login, and each member chooses who can see them. A place page explains how to file a profile so families searching that place can find you. It is not a public directory of brides and grooms.',
          'The State and City dropdowns on Edit profile, on Search, and on the homepage use this same list. Chhattisgarh and the other states below are listed first because that is where most Panika, Manikpuri, Kabirpanthi and Adivasi searches on this site start. Every other Indian state is in the form too, so a family that has moved can tell the truth about where they live.',
          'Select the city where the first meeting can happen. A village that is missing can be typed under Other, or you can select the district town relatives already search and write the village in About me. Do not put the village only in About me and leave City blank. Search does not read About me.'
        ]
      },
      {
        heading: 'States with their own page',
        links: withPages.map((state) => ({
          href: `/locations/${state.slug}`,
          label: state.name,
          text: state.summary
        }))
      },
      {
        heading: 'Also in the dropdown',
        paragraphs: [
          `${withoutPages.map((state) => state.name).join(', ')}. These states do not have a separate article. They are still in the form. Choose the state, choose the city, and use Other if the town is missing. Preferred state can point back to Chhattisgarh or Madhya Pradesh if that is where you hope to find a match. Your own State field should still be the state you live in.`,
          'Outside India, choose Other at the bottom of the state list and type the country and city. A foreign city filed as Raipur will be found by Raipur families who cannot meet you there.'
        ]
      }
    ],
    aside: [
      { href: '/communities', label: 'Communities' },
      { href: '/guides/how-to-create-a-profile', label: 'How to set the city field' },
      { href: '/login.html?tab=register', label: 'Create a free profile' }
    ]
  });
}

function statePage(slug) {
  const state = locations.findState(slug);
  if (!state || !state.page) return null;
  const published = locations.pageCities(state);
  const rest = state.cities.filter((item) => !item.page);
  const blocks = [
    { paragraphs: state.lead },
    {
      heading: `How to be found in ${state.name}`,
      paragraphs: [
        `In Edit profile, open Location and select State “${state.name}”. Then select the city where your elders can meet the other family. The spelling has to match the dropdown. Writing the city only in About me does not put the profile into that city’s filter.`,
        state.languages.length
          ? `Families around ${state.name} commonly read ${state.languages.join(' and ')}. Write About me in the language the parents will actually read. The site does not translate it.`
          : `Write About me in the language the parents will actually read. The site does not translate it.`,
        `If you live in ${state.name} and hope for a match in another state, keep State as ${state.name} and set Preferred state. Do not borrow another state’s city to appear in its filter.`
      ]
    }
  ];
  if (published.length) {
    blocks.push({
      heading: `City pages in ${state.name}`,
      links: published.map((item) => ({
        href: `/locations/${state.slug}/${item.slug}`,
        label: item.name,
        text: item.summary
      }))
    });
  }
  if (rest.length) {
    blocks.push({
      heading: 'Also in the city dropdown',
      paragraphs: [
        `${rest.map((item) => item.name).join(', ')}. These towns do not each have an article. They are still filters. A profile that selects one of them is found by members who select the same city. A missing article does not hide the profile.`,
        `If your village is not in that list, choose Other and type the name relatives will search, or choose the nearest listed town only when that is truly the meeting place. Say the village in About me either way.`
      ]
    });
  }
  blocks.push({ faqs: state.faqs });
  return page({
    path: `/locations/${state.slug}`,
    eyebrow: 'State',
    h1: `Panika matrimonial in ${state.name}`,
    hindi: `${state.hindi} में पनिका, माणिकपुरी और कबीरपंथी रिश्ता`,
    description: `Free Panika, Manikpuri and Kabirpanthi matrimonial search in ${state.name}. ${state.summary}`.slice(0, 170),
    crumbs: [crumbHome(), { href: '/locations', label: 'Places' }, { label: state.name }],
    blocks,
    aside: [
      { href: searchLogin(state.name), label: `Log in to search ${state.name}` },
      { href: '/login.html?tab=register', label: 'Create a free profile' },
      { href: '/communities/panika', label: 'Panika' },
      { href: '/communities/kabirpanthi', label: 'Kabirpanthi' },
      { href: '/guides/how-to-create-a-profile', label: 'Profile guide' }
    ]
  });
}

function cityPage(stateSlug, citySlug) {
  const found = locations.findCity(stateSlug, citySlug);
  if (!found || !found.city.page) return null;
  const { state, city } = found;
  const nearbyLinks = (city.nearby || []).map((name) => {
    const match = state.cities.find((item) => item.name === name && item.page);
    const elsewhere = locations.STATES.flatMap((item) => item.cities.filter((c) => c.name === name && c.page).map((c) => ({
      href: `/locations/${item.slug}/${c.slug}`,
      label: `${c.name}${item.slug === state.slug ? '' : `, ${item.name}`}`
    })));
    if (match) return { href: `/locations/${state.slug}/${match.slug}`, label: match.name, text: 'Separate city filter.' };
    if (elsewhere.length) return { href: elsewhere[0].href, label: elsewhere[0].label, text: 'Separate city filter.' };
    return null;
  }).filter(Boolean);
  const siblingLinks = locations.pageCities(state)
    .filter((item) => item.slug !== city.slug)
    .map((item) => ({ href: `/locations/${state.slug}/${item.slug}`, label: item.name, text: item.summary }));
  return page({
    path: `/locations/${state.slug}/${city.slug}`,
    eyebrow: state.name,
    h1: `Panika matrimonial in ${city.name}`,
    hindi: `${city.hindi || city.name} में मुफ्त रिश्ता खोज`,
    description: `Panika matrimonial in ${city.name}, ${state.name}. ${city.summary} Free registration, no subscription.`.slice(0, 170),
    crumbs: [
      crumbHome(),
      { href: '/locations', label: 'Places' },
      { href: `/locations/${state.slug}`, label: state.name },
      { label: city.name }
    ],
    blocks: [
      { paragraphs: city.note },
      {
        heading: `Set “${city.name}” on the profile`,
        paragraphs: [
          `PANIKA JEEVAN SATHI is one website, not a separate office in ${city.name}. To be found by a ${city.name} search, open Edit profile → Location, select State “${state.name}”, then City “${city.name}”. Those two strings are what the filter reads. A sentence in About me that mentions ${city.name} does not enter the filter.`,
          city.nearby && city.nearby.length
            ? `${city.name} families often also talk about ${city.nearby.join(', ')}. Where those towns have their own city in the dropdown, they have their own filter. Search ${city.name} first. Search the next town only if you can travel. One profile cannot sit in two city filters.`
            : `If distance does not matter inside ${state.name}, leave City empty and filter only by the state. You will see every city, which is the right search when the meeting place is negotiable.`,
          state.languages.length
            ? `Write the profile in ${state.languages.join(' or ')}, the language the elders will read. Say the neighbourhood or village in About me after the city is set. Do not put a colony code, a plant name, or “near ${city.name}” in the City field.`
            : `Say the neighbourhood or village in About me after the city is set. Do not put “near ${city.name}” in the City field.`
        ]
      },
      nearbyLinks.length ? { heading: 'Nearby filters', links: nearbyLinks } : null,
      siblingLinks.length ? { heading: `Other city pages in ${state.name}`, links: siblingLinks } : null,
      {
        heading: 'Community is a separate field',
        paragraphs: [
          `A ${city.name} search can be narrowed to Panika, Manikpuri, Kabirpanthi or Adivasi. Select the name your elders use. The city page does not change that choice, and the site will not decide whether two of those names are the same.`
        ],
        links: locations.COMMUNITIES.map((item) => ({
          href: `/communities/${item.slug}`,
          label: item.name,
          text: item.summary
        }))
      }
    ].filter(Boolean),
    aside: [
      { href: searchLogin(state.name, city.name), label: `Log in to search ${city.name}` },
      { href: '/login.html?tab=register', label: 'Create a free profile' },
      { href: `/locations/${state.slug}`, label: `${state.name} overview` },
      { href: '/guides/how-to-create-a-profile', label: 'How to fill the city field' }
    ]
  });
}

function guideHub() {
  return page({
    path: '/guides',
    eyebrow: 'Guides',
    h1: 'How to use the matrimonial, carefully',
    hindi: 'प्रोफाइल, गोत्र और परिवार का परिचय',
    description: 'Practical guides for PANIKA JEEVAN SATHI: how to fill a profile so search can find it, and how to write gotra and a family introduction.',
    crumbs: [crumbHome(), { label: 'Guides' }],
    blocks: [
      {
        paragraphs: [
          'The form has more boxes than search can read. These two guides are the ones that stop the usual mistakes: a city written only in About me, a community name chosen because it looks larger, a gotra copied from a list on another website, and a phone number pasted into a field you thought was hidden.',
          'Neither guide is a set of community rules. Marriage customs differ by family and by region. Where a custom matters to you, the guides tell you which box to write it in. They do not invent a single Panika wedding and ask every house to follow it.',
          'Read the profile guide before you save the first time. Read the gotra guide before you copy a clan list from somewhere else. Then use the place pages only for the city you can actually meet in. Registration remains free while you read them. There is no paid profile review.'
        ]
      },
      {
        heading: 'Start here',
        links: locations.GUIDES.map((item) => ({
          href: `/guides/${item.slug}`,
          label: item.title,
          text: item.summary
        }))
      }
    ],
    aside: [
      { href: '/communities', label: 'Communities' },
      { href: '/locations', label: 'Places' },
      { href: '/login.html?tab=register', label: 'Create a free profile' }
    ]
  });
}

function guidePage(slug) {
  const item = locations.findGuide(slug);
  if (!item) return null;
  return page({
    path: `/guides/${item.slug}`,
    eyebrow: 'Guide',
    h1: item.title,
    hindi: item.hindi,
    description: `${item.title} on PANIKA JEEVAN SATHI. ${item.summary}`.slice(0, 170),
    crumbs: [crumbHome(), { href: '/guides', label: 'Guides' }, { label: item.title }],
    blocks: [
      { paragraphs: item.paragraphs },
      {
        heading: 'Related pages',
        links: [
          { href: '/communities', label: 'Communities', text: 'Panika, Manikpuri, Kabirpanthi and Adivasi — four filters, not four spellings.' },
          { href: '/locations', label: 'Places', text: 'State and city names that match the dropdown.' },
          { href: '/locations/chhattisgarh/raipur', label: 'Example: Raipur', text: 'What a city page is asking you to select, and what it will not include.' },
          { href: '/contact.html', label: 'Contact', text: 'Help with registration, or to report a profile that asks for money.' }
        ]
      }
    ],
    aside: [
      { href: '/login.html?tab=register', label: 'Create a free profile' },
      { href: '/guides', label: 'All guides' },
      { href: '/contact.html', label: 'Contact / report' }
    ]
  });
}

function crumbHome() {
  return { href: '/', label: 'Home' };
}

function page(spec) {
  const description = String(spec.description || '').replace(/\s+/g, ' ').trim();
  return {
    path: spec.path,
    title: `${spec.h1} — ${SITE}`,
    description,
    h1: spec.h1,
    hindi: spec.hindi || '',
    eyebrow: spec.eyebrow || '',
    crumbs: spec.crumbs || [],
    blocks: spec.blocks || [],
    aside: spec.aside || [],
    faqs: spec.blocks.flatMap((block) => (block && block.faqs) || [])
  };
}

function render(doc, origin) {
  const base = String(origin || ORIGIN_FALLBACK).replace(/\/+$/, '');
  const url = base + doc.path;
  const crumbs = doc.crumbs.map((crumb, index) => {
    const last = index === doc.crumbs.length - 1;
    if (!crumb.href || last) return `<span>${esc(crumb.label)}</span>`;
    return `<a href="${esc(crumb.href)}">${esc(crumb.label)}</a>`;
  }).join('<span aria-hidden="true"> / </span>');
  const blocks = doc.blocks.map(renderBlock).join('\n');
  const aside = doc.aside.length
    ? `<aside class="card"><h3>On this site</h3><div class="btn-row" style="flex-direction:column;align-items:stretch">${
      doc.aside.map((link) => `<a class="btn ghost" href="${esc(link.href)}">${esc(link.label)}</a>`).join('')
    }</div><p class="tiny muted mt-2 mb-0">Free registration. No subscription and no locked profiles. These pages do not list members.</p></aside>`
    : '';
  const json = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: doc.title,
        description: doc.description,
        inLanguage: ['en-IN', 'hi'],
        isPartOf: { '@type': 'WebSite', '@id': `${base}/#website`, url: `${base}/`, name: SITE },
        breadcrumb: { '@id': `${url}#breadcrumb` }
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: doc.crumbs.map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: crumb.label,
          item: crumb.href ? base + crumb.href : url
        }))
      },
      doc.faqs.length
        ? {
          '@type': 'FAQPage',
          '@id': `${url}#faq`,
          mainEntity: doc.faqs.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a }
          }))
        }
        : null
    ].filter(Boolean)
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="google-site-verification" content="${VERIFICATION}" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(doc.title)}</title>
<meta name="description" content="${esc(doc.description)}">
<meta name="theme-color" content="#8e1f41">
<link rel="icon" href="/assets/img/favicon.svg">
<link rel="stylesheet" href="/assets/css/app.css">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
<meta name="googlebot" content="index,follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE}">
<meta property="og:locale" content="en_IN">
<meta property="og:title" content="${esc(doc.title)}">
<meta property="og:description" content="${esc(doc.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(base)}/assets/img/logo.svg">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(doc.title)}">
<meta name="twitter:description" content="${esc(doc.description)}">
<meta name="twitter:image" content="${esc(base)}/assets/img/logo.svg">
<script type="application/ld+json">${JSON.stringify(json).replace(/</g, '\\u003c')}</script>
</head>
<body>
<div id="siteHeader"></div>
<main class="container section-sm">
  <nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>
  <div class="page-head">
    <span class="eyebrow">${esc(doc.eyebrow)}</span>
    <h1 class="mb-0">${esc(doc.h1)}</h1>
    ${doc.hindi ? `<p class="hindi mb-0">${esc(doc.hindi)}</p>` : ''}
  </div>
  <div class="two-col wide-left mt-3">
    <div class="seo-prose">${blocks}</div>
    ${aside}
  </div>
</main>
<div id="siteFooter"></div>
<div id="bottomNav"></div>
<script src="/assets/js/app.js"></script>
</body>
</html>
`;
}

function renderBlock(block) {
  if (!block) return '';
  const heading = block.heading ? `<h2>${esc(block.heading)}</h2>` : '';
  const paragraphs = (block.paragraphs || []).map((text) => `<p>${esc(text)}</p>`).join('');
  const links = (block.links || []).length
    ? `<div class="place-grid">${block.links.map((link) => `<a class="place-card" href="${esc(link.href)}"><b>${esc(link.label)}</b>${link.text ? `<span>${esc(link.text)}</span>` : ''}</a>`).join('')}</div>`
    : '';
  const faqs = (block.faqs || []).length
    ? `<h2>Questions families ask</h2>${block.faqs.map((item) => `<h3>${esc(item.q)}</h3><p>${esc(item.a)}</p>`).join('')}`
    : '';
  if (!heading && !paragraphs && !links && !faqs) return '';
  return `<section class="card mb-3">${heading}${paragraphs}${links}${faqs}</section>`;
}

module.exports = {
  lookup,
  render,
  indexablePaths,
  contentLastMod,
  canonicalize,
  words
};
