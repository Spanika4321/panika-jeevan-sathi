'use strict';
/**
 * SEVA MARKET INDIA — flash messages.
 *
 * A redirect after a form POST cannot carry a session, so the message is a
 * code in the query string and the copy lives here. Two advantages: the URL
 * stays shareable, and a page reload does not re-submit anything.
 */

const MESSAGES = {
  'signed-out': { kind: 'ok', message: 'Signed out. Your session has been revoked.' },
  'welcome': { kind: 'ok', message: 'Account created. Add your business whenever you are ready.' },
  'provider-submitted': { kind: 'ok', message: 'Listing received. We publish it after a quick check.' },
  'provider-live': { kind: 'ok', message: 'Your listing is live in search.' },
  'profile-saved': { kind: 'ok', message: 'Business details saved.' },
  'service-added': { kind: 'ok', message: 'Service added.' },
  'service-saved': { kind: 'ok', message: 'Service saved.' },
  'service-published': { kind: 'ok', message: 'Service is now visible in search.' },
  'service-paused': { kind: 'ok', message: 'Service paused — it is hidden from search.' },
  'service-archived': { kind: 'ok', message: 'Service archived.' },
  'coverage-saved': { kind: 'ok', message: 'Coverage areas updated.' },
  'lead-saved': { kind: 'ok', message: 'Enquiry updated.' },
  'document-saved': { kind: 'ok', message: 'Document reference saved for review.' },
  'enquiry-sent': { kind: 'ok', message: 'Enquiry sent to the provider. They will call the number you gave.' },
  'enquiry-failed': { kind: 'error', message: 'That enquiry could not be sent. Please check the highlighted fields.' },
  'enquiry-limit': { kind: 'error', message: 'Too many enquiries from this connection. Wait a while, or call the provider directly.' },
  'verified': { kind: 'ok', message: 'Email confirmed — thank you.' },
  'verify-failed': { kind: 'error', message: 'That confirmation link is not valid or has expired. Sign in to get a new one.' },
  'reset-sent': { kind: 'ok', message: 'If that email is on an account, a reset link is on its way.' },
  'password-changed': { kind: 'ok', message: 'Password changed. Every other device has been signed out.' },
  'sessions-revoked': { kind: 'ok', message: 'Signed out of all devices.' },
  'needs-signin': { kind: 'error', message: 'Sign in to continue.' },
  'review-approved': { kind: 'ok', message: 'Listing approved and published.' },
  'review-rejected': { kind: 'ok', message: 'Listing rejected and the provider notified.' },
  'badge-granted': { kind: 'ok', message: 'Verified badge granted.' },
  'badge-removed': { kind: 'ok', message: 'Verified badge removed.' },
  'housekeeping': { kind: 'ok', message: 'Expired sessions and tokens purged.' },
};

/**
 * @param {URLSearchParams} query
 * @returns {{kind: string, message: string, code: string}|null}
 */
function fromQuery(query) {
  const code = query.get('ok') || query.get('err');
  if (!code) return null;
  const found = MESSAGES[code];
  if (!found) return null;
  return { ...found, code };
}

function copy(code, override) {
  const found = MESSAGES[code];
  if (!found) return { kind: 'ok', message: String(override || code), code };
  return { ...found, message: override ? String(override) : found.message, code };
}

module.exports = { fromQuery, copy, MESSAGES };
