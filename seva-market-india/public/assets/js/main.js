/**
 * SEVA MARKET INDIA — progressive enhancement.
 *
 * Every page is fully usable without this file: forms are plain GET/POST
 * submits, the account menu is a native <details>, and the nav opens only
 * as an enhancement. No framework, no inline handlers, so the strict
 * Content-Security-Policy holds.
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

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });

    if (window.matchMedia) {
      window.matchMedia('(min-width: 900px)').addEventListener('change', function (event) {
        if (event.matches) setOpen(false);
      });
    }
  }

  /**
   * Keep numeric fields clean: digits only, honouring maxlength.
   * Covers the PIN field, phone fields and the PIN search box.
   */
  function initNumericFields() {
    document.addEventListener('input', function (event) {
      var input = event.target;
      if (!input || input.inputMode !== 'numeric') return;
      if (input.dataset && input.dataset.numericGuard) return;
      input.dataset.numericGuard = '1';
      var digits = input.value.replace(/\D/g, '');
      var max = input.maxLength && input.maxLength !== -1 ? input.maxLength : null;
      if (max && digits.length > max) digits = digits.slice(0, max);
      if (digits !== input.value) input.value = digits;
    });
  }

  /** The hero form would list everything if submitted empty — steer instead. */
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

  /** Destructive buttons ask first (Remove/archive, etc.). */
  function initConfirmForms() {
    document.addEventListener('submit', function (event) {
      var form = event.target;
      var message = form.getAttribute && form.getAttribute('data-confirm');
      if (!message) return;
      var keep = window.confirm(message);
      if (!keep) event.preventDefault();
    });
  }

  /** Auto-check the role card when its radio is clicked anywhere on it. */
  function initRoleCards() {
    document.querySelectorAll('.role-card').forEach(function (card) {
      var radio = card.querySelector('input[type="radio"]');
      if (!radio) return;
      card.addEventListener('click', function () { radio.checked = true; });
      if (radio.checked) card.classList.add('role-card--on');
      radio.addEventListener('change', function () {
        document.querySelectorAll('.role-card').forEach(function (other) {
          other.classList.toggle('role-card--on', other.querySelector('input').checked);
        });
      });
    });
  }

  /** Locality pickers: filter options by typing (progressive only). */
  function initLocalityFilter() {
    var form = document.querySelector('[data-provider-form]');
    var select = form && form.querySelector('#locality_id');
    if (!select) return;

    var wrap = document.createElement('div');
    wrap.className = 'field';
    var label = document.createElement('label');
    label.setAttribute('for', 'locality-search');
    label.textContent = 'Type to find your area';
    var input = document.createElement('input');
    input.type = 'search';
    input.id = 'locality-search';
    input.autocomplete = 'off';
    input.placeholder = 'e.g. Uzan Bazar, Andheri…';
    wrap.appendChild(label);
    wrap.appendChild(input);

    var fieldWrap = select.closest('.field');
    fieldWrap.parentNode.insertBefore(wrap, fieldWrap.nextSibling);

    input.addEventListener('input', function () {
      var term = input.value.trim().toLowerCase();
      var options = select.options;
      var firstVisible = null;
      for (var i = 1; i < options.length; i += 1) {
        var visible = !term || options[i].text.toLowerCase().indexOf(term) !== -1;
        options[i].style.display = visible ? '' : 'none';
        if (visible && !firstVisible) firstVisible = options[i];
      }
      // Optgroup labels can't be hidden; hide empty groups instead.
      var groups = select.querySelectorAll('optgroup');
      for (var g = 0; g < groups.length; g += 1) {
        var group = groups[g];
        var anyVisible = Array.prototype.some.call(group.options, function (option) {
          return option.style.display !== 'none';
        });
        group.style.display = anyVisible ? '' : 'none';
      }
    });
  }

  /** Show the selected business-photo count before a normal form submit. */
  function initPhotoPicker() {
    document.querySelectorAll('[data-photo-picker]').forEach(function (picker) {
      var input = picker.querySelector('input[type="file"]');
      var output = picker.querySelector('[data-photo-selection]');
      if (!input || !output) return;
      input.addEventListener('change', function () {
        var files = input.files ? input.files.length : 0;
        if (!files) {
          output.textContent = '';
          return;
        }
        output.textContent = files === 1
          ? '1 new photo selected. Save your business to upload it.'
          : files + ' new photos selected. Save your business to upload them.';
      });
    });
  }

  /**
   * Copy-to-clipboard for the share rows.
   * Uses the async Clipboard API where available and falls back to a hidden
   * textarea, so the button still works on older Android browsers. Feedback
   * is the button label itself — no inline handlers (strict CSP).
   */
  function initShareCopy() {
    document.querySelectorAll('[data-share-copy]').forEach(function (button) {
      button.addEventListener('click', function () {
        var value = button.getAttribute('data-share-copy') || '';
        var original = button.textContent;

        function done(ok) {
          button.textContent = ok ? 'Copied ✓' : 'Select and copy';
          setTimeout(function () { button.textContent = original; }, 2200);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(function () { done(true); }, function () { done(false); });
          return;
        }
        try {
          var area = document.createElement('textarea');
          area.value = value;
          area.setAttribute('readonly', '');
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          var copied = document.execCommand('copy');
          document.body.removeChild(area);
          done(copied);
        } catch (err) {
          done(false);
        }
      });
    });
  }

  function init() {
    initNav();
    initShareCopy();
    initNumericFields();
    initSearchForm();
    initConfirmForms();
    initRoleCards();
    initLocalityFilter();
    initPhotoPicker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
