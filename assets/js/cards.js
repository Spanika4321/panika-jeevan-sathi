/**
 * TEERNOVA — Result cards and shared components
 * Live Teer Results • Smart Statistics • Trusted Information
 */

const Cards = {
  renderResultCard: function(result, sessionName) {
    return `
      <a href="/results.html?id=${result.id}" class="result-card">
        <div class="result-header">
          <span class="result-date">${result.date}</span>
          <span class="result-round ${result.round}">${result.round}</span>
        </div>
        <div class="result-body">
          <div class="result-number">${result.result}</div>
          <div class="result-detail">
            <span>House: ${result.house}</span>
            <span>Ending: ${result.ending}</span>
          </div>
        </div>
        <div class="result-footer">
          <span class="result-session">${sessionName || 'Unknown'}</span>
          <span class="result-status ${result.status}">${result.status}</span>
        </div>
      </a>
    `;
  },

  renderSessionCard: function(session) {
    return `
      <a href="/results.html?session=${session.id}" class="session-card">
        <div class="session-header">
          <span class="session-category ${session.category}">${session.category}</span>
          <span class="session-name">${PJS.esc(session.name)}</span>
        </div>
        <div class="session-footer">
          <span class="session-state">${session.state}</span>
          <span class="session-status">${session.is_active ? 'Active' : 'Inactive'}</span>
        </div>
      </a>
    `;
  },
};
