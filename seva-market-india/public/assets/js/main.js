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

  /**
   * Keep the digit-only fields honest as the user types.
   * Phones and PINs are validated server-side too; this only stops the
   * common "098765 43210 " paste from bouncing the form back.
   */
  function initDigitFields() {
    var patterns = [
      { selector: 'input[name^="pin"]', keep: /[^0-9]/g, max: 6 },
      { selector: 'input[name="service_areas"], textarea[name="service_areas"]', keep: /[^0-9,\s]/g, max: 400 },
    ];
    Array.prototype.forEach.call(document.querySelectorAll('input[type="tel"]'), function (input) {
      patterns.push({ node: input, keep: /[^0-9]/g, max: 10 });
    });
    patterns.forEach(function (rule) {
      var nodes = rule.node ? [rule.node] : document.querySelectorAll(rule.selector);
      Array.prototype.forEach.call(nodes, function (node) {
        node.addEventListener('input', function () {
          var cleaned = node.value.replace(rule.keep, '').slice(0, rule.max);
          if (cleaned !== node.value) node.value = cleaned;
        });
      });
    });
  }

  /**
   * One submit per click. A double-tap on "Send enquiry" or "List my
   * business" otherwise creates two rows, and a lead is a person waiting for
   * a call — duplicates are not a cosmetic problem.
   */
  function initSubmitOnce() {
    Array.prototype.forEach.call(document.querySelectorAll('form'), function (form) {
      if (form.method && form.method.toLowerCase() === 'get') return;
      form.addEventListener('submit', function () {
        Array.prototype.forEach.call(form.querySelectorAll('button[type="submit"]'), function (button) {
          button.setAttribute('disabled', 'disabled');
          if (!button.hasAttribute('data-busy-label')) {
            button.setAttribute('data-busy-label', button.textContent || '');
            button.textContent = 'Sending\u2026';
          }
        });
      });
      // Back/forward cache restores a disabled form; make it usable again.
      window.addEventListener('pageshow', function (event) {
        if (!event.persisted) return;
        Array.prototype.forEach.call(form.querySelectorAll('button[disabled]'), function (button) {
          button.removeAttribute('disabled');
          var label = button.getAttribute('data-busy-label');
          if (label) button.textContent = label;
        });
      });
    });
  }

  function init() {
    initNav();
    initPinField();
    initSearchForm();
    initDigitFields();
    initSubmitOnce();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
