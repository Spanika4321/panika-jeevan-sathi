/**
 * SEVA MARKET INDIA — progressive enhancement.
 *
 * The page is fully usable without this file (forms are plain GET submits
 * and every link is a real href). All this adds is the mobile nav toggle
 * and PIN-field input hygiene. No framework, no inline handlers, so the
 * strict Content-Security-Policy holds.
 */
(function () {
  'use strict';

  /** Mobile navigation disclosure. */
  function initNav() {
    var toggle = document.querySelector('[data-nav-toggle]');
    var nav = document.querySelector('[data-nav]');
    if (!toggle || !nav) return;

    function setOpen(open) {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setOpen(false);
    });

    // Close the sheet after a link is chosen, so navigation feels instant.
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });

    // If the layout grows past the mobile breakpoint, drop the sheet state.
    if (window.matchMedia) {
      window.matchMedia('(min-width: 900px)').addEventListener('change', function (event) {
        if (event.matches) setOpen(false);
      });
    }
  }

  /** Keep the PIN field to 6 digits. */
  function initPinField() {
    var pin = document.getElementById('pin');
    if (!pin) return;
    pin.addEventListener('input', function () {
      var digits = pin.value.replace(/\D/g, '').slice(0, 6);
      if (digits !== pin.value) pin.value = digits;
    });
  }

  /** Submitting an all-empty search would list everything; steer the user. */
  function initSearchForm() {
    var form = document.querySelector('[data-search-form]');
    if (!form) return;
    form.addEventListener('submit', function (event) {
      var fields = form.querySelectorAll('input');
      var hasValue = Array.prototype.some.call(fields, function (input) {
        return input.value.trim() !== '';
      });
      if (hasValue) return;
      event.preventDefault();
      var first = fields[0];
      if (first) {
        first.setAttribute('aria-invalid', 'true');
        first.focus();
      }
    });
  }

  function init() {
    initNav();
    initPinField();
    initSearchForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
