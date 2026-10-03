/**
 * TEERNOVA — Shared front-end library
 * Live Teer Results • Smart Statistics • Trusted Information
 */

const PJS = {
  apiBase: '/api',
  checkAuth: async function() {
    const cookies = document.cookie.split(';');
    let sessionCookie = null;
    for (const c of cookies) {
      const parts = c.trim().split('=');
      if (parts[0] === 'pjs_session') sessionCookie = parts[1];
    }
    if (!sessionCookie) return null;
    try {
      const res = await fetch('/api/me');
      const data = await res.json();
      if (data.ok && data.user) return data.user;
    } catch (e) {}
    return null;
  },
  esc: function(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
  formatDate: function(date) {
    return new Date(date).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  },
  formatDateTime: function(date) {
    return new Date(date).toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },
  whatsappLink: function(message) {
    const number = '918099834725';
    const text = encodeURIComponent(message || 'Hello TEERNOVA');
    return `https://wa.me/${number}?text=${text}`;
  }
};

// Service worker for offline support (optional)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
