/* SEVA MARKET INDIA — contact form */
(function () {
  'use strict';

  SMI.boot().then(() => {
    document.getElementById('contactForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = document.getElementById('sendBtn');
      button.disabled = true;
      button.textContent = 'Sending…';
      const response = await SMI.post('/api/contact', {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        message: document.getElementById('message').value
      });
      button.disabled = false;
      button.textContent = 'Send message';
      const note = document.getElementById('formNote');
      if (response.ok) {
        note.textContent = response.message || 'Thank you — we have received your message.';
        note.style.color = 'var(--green)';
        document.getElementById('contactForm').reset();
      } else {
        note.textContent = response.error || 'Could not send your message. Please email us instead.';
        note.style.color = 'var(--red)';
      }
    });
  });
}());
