'use strict';
/**
 * SEVA MARKET INDIA — form builders.
 *
 * Every form on the site is server-rendered from these helpers, which is how
 * "the error sits next to the field", "the label is a real <label>" and "the
 * CSRF token is present" stay true everywhere instead of on whichever page
 * someone remembered.
 */

const { esc } = require('./escape');

function idFor(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '-');
}

function errorText(error) {
  return error ? `<p class="field__error" role="alert">${esc(error)}</p>` : '';
}

/**
 * @param {object} options
 * @param {string} options.name
 * @param {string} options.label
 * @param {string} [options.type]
 * @param {string|number} [options.value]
 * @param {string} [options.error]
 * @param {string} [options.hint]
 * @param {Array<{name: string, value: string|number}>} [options.attrs]
 */
function input({ name, label, type = 'text', value = '', error = null, hint = null, required = false, attrs = {} }) {
  const id = idFor(name);
  const extra = Object.entries(attrs)
    .filter(([, v]) => v !== false && v !== null && v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join('');
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ');
  return `
        <div class="field${error ? ' field--error' : ''}">
          <label class="field__label" for="${id}">${esc(label)}${required ? '<span class="field__required" aria-hidden="true"> *</span>' : ''}</label>
          <input class="field__input" id="${id}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}"${extra}${required ? ' required' : ''}${describedBy ? ` aria-describedby="${describedBy}"` : ''}>
          ${error ? `<p class="field__error" id="${id}-error">${esc(error)}</p>` : ''}
          ${hint ? `<p class="field__hint" id="${id}-hint">${esc(hint)}</p>` : ''}
        </div>`;
}

function textarea({ name, label, value = '', error = null, hint = null, rows = 4, maxlength = 2000, required = false }) {
  const id = idFor(name);
  return `
        <div class="field${error ? ' field--error' : ''}">
          <label class="field__label" for="${id}">${esc(label)}${required ? '<span class="field__required" aria-hidden="true"> *</span>' : ''}</label>
          <textarea class="field__input" id="${id}" name="${esc(name)}" rows="${rows}" maxlength="${maxlength}"${required ? ' required' : ''}>${esc(value)}</textarea>
          ${errorText(error)}
          ${hint && !error ? `<p class="field__hint">${esc(hint)}</p>` : ''}
        </div>`;
}

/**
 * @param {Array<{value: string|number, label: string, group?: string}>} options
 */
function select({ name, label, options = [], value = '', error = null, hint = null, required = false, placeholder = null }) {
  const id = idFor(name);
  const choices = placeholder ? [{ value: '', label: placeholder, group: null }, ...options] : options;
  const markup = choices.map((option) => {
    const selected = String(option.value) === String(value ?? '') ? ' selected' : '';
    return `<option value="${esc(option.value)}"${selected}>${esc(option.label)}</option>`;
  }).join('');
  return `
        <div class="field${error ? ' field--error' : ''}">
          <label class="field__label" for="${id}">${esc(label)}</label>
          <select class="field__input" id="${id}" name="${esc(name)}"${required ? ' required' : ''}>${markup}</select>
          ${errorText(error)}
          ${hint && !error ? `<p class="field__hint">${esc(hint)}</p>` : ''}
        </div>`;
}

function checkbox({ name, label, checked = false, hint = null }) {
  return `
        <label class="field field--check">
          <input type="checkbox" name="${esc(name)}" value="1"${checked ? ' checked' : ''}>
          <span>${esc(label)}</span>
          ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
        </label>`;
}

/**
 * The list of errors above the form. Field-level errors are still rendered
 * inline; this exists so a user who lands at the top sees what went wrong.
 */
function errorSummary(errors = {}) {
  const entries = Object.entries(errors || {});
  if (!entries.length) return '';
  return `
      <div class="alert alert--error" role="alert">
        <p class="alert__title">Please fix ${entries.length === 1 ? 'this field' : `these ${entries.length} fields`}:</p>
        <ul class="alert__list">${entries.map(([, message]) => `<li>${esc(message)}</li>`).join('')}</ul>
      </div>`;
}

function successBanner(message) {
  if (!message) return '';
  return `<div class="alert alert--ok" role="status"><p class="alert__title">${esc(message)}</p></div>`;
}

/**
 * Open a form the only way this app allows: POST/PUT/PATCH carry a CSRF
 * token, GET forms do not need one.
 */
function openForm({ action, method = 'post', csrf = '', enctype = null, id = null, extra = '' }) {
  const upper = String(method).toUpperCase();
  const parts = [`<form class="form" action="${esc(action)}" method="${upper.toLowerCase()}"`];
  if (enctype) parts.push(` enctype="${esc(enctype)}"`);
  if (id) parts.push(` id="${esc(id)}"`);
  if (extra) parts.push(` ${extra}`);
  const open = `${parts.join(' ')}>`;
  if (upper === 'GET' || !csrf) return open;
  return `${open}\n        <input type="hidden" name="_csrf" value="${esc(csrf)}">`;
}

function fieldRow(children) {
  const list = children.filter(Boolean);
  if (!list.length) return '';
  return `
        <div class="field-row">${list.join('')}</div>`;
}

function actions({ label = 'Save', secondary = null, danger = false, small = false }) {
  const classes = ['btn', danger ? 'btn--danger' : 'btn--primary', small ? 'btn--sm' : ''].filter(Boolean).join(' ');
  return `
        <div class="form__actions">
          <button class="${classes}" type="submit">${esc(label)}</button>
          ${secondary ? `<a class="btn btn--ghost btn--sm" href="${esc(secondary.href)}">${esc(secondary.label)}</a>` : ''}
        </div>`;
}

module.exports = { input, textarea, select, checkbox, errorSummary, successBanner, openForm, closeForm: '</form>', fieldRow, actions, idFor, errorText };
