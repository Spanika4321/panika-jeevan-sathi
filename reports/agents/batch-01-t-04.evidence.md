# BATCH-01 / T-04 — raw execution log
executor : arena-coordinator-sandbox (linux/x64, node v22.22.3)
head     : aa836de9021d87a3d4aea69c8a2aa35feeebec5f
objective: Run the end-to-end suite on-device: register → login → create/edit profile → photo upload → search/filters → interest → accept → message → receive → notifications → shortlist → privacy → report → admin → logout → re-login, plus 'data survives a server restart'. This is the check that proves the device's Node build actually has a working node:sqlite.
verdict  : PASS

$ node scripts/e2e-test.mjs
(exit 0, 1750ms)
--- stdout ---

1. Registration & login
  ✓ register creates account
  ✓ register starts a session
  ✓ duplicate email rejected
  ✓ weak password rejected
  ✓ second member registers
  ✓ female member registers
  ✓ ordinary registration is a normal member, not admin
  ✓ session returns own account

2. Profile creation & photo upload
  ✓ profile saves
  ✓ completeness calculated
  ✓ invalid age rejected
  ✓ photo uploads
  ✓ photo is served back
  ✓ non-image upload rejected
  ✓ second profile saves
  ✓ third profile saves

3. Search, filters & recommendations
  ✓ search returns other profiles only
  ✓ own profile excluded
  ✓ gender filter works
  ✓ age filter works
  ✓ community filter works
  ✓ education filter works
  ✓ occupation filter works
  ✓ location filter works
  ✓ keyword search works
  ✓ marital status filter works
  ✓ recommended matches scored
  ✓ best match is the closest fit
  ✓ match reasons returned
  ✓ profile detail page loads
  ✓ detail hides email from others

4. Interests (send → receive → accept)
  ✓ messaging blocked before interest accepted
  ✓ interest sent
  ✓ duplicate interest blocked
  ✓ self interest blocked
  ✓ receiver sees interest
  ✓ interest shows sender profile
  ✓ sender sees sent interest
  ✓ only receiver can respond
  ✓ interest accepted
  ✓ cannot answer twice
  ✓ acceptance notification counted

5. Private messaging
  ✓ message sent after acceptance
  ✓ second message sent
  ✓ receiver sees unread count
  ✓ conversation list shows thread
  ✓ conversation shows unread badge
  ✓ history loads
  ✓ messages attributed correctly
  ✓ connection flag set
  ✓ reply sent
  ✓ sender sees reply
  ✓ messages marked read
  ✓ empty message rejected
  ✓ unknown recipient rejected
  ✓ message notifications delivered

6. Shortlist
  ✓ shortlist added
  ✓ shortlist lists profile
  ✓ shortlist toggles off
  ✓ shortlist empty after toggle

7. Privacy & visibility
  ✓ visibility updates
  ✓ hidden profile removed from search
  ✓ hidden profile detail blocked
  ✓ profile visible again
  ✓ photo hidden from others when privacy on

8. Report a profile
  ✓ report submitted
  ✓ duplicate report blocked

9. Contact form & public content
  ✓ contact form saves
  ✓ empty contact rejected
  ✓ site content is public
  ✓ search requires login

10. Admin panel
  ✓ admin login works
  ✓ admin stats
  ✓ non-admin blocked from admin API
  ✓ owner email registers as administrator, not a normal user
  ✓ owner account can open the admin panel API
  ✓ admin user search
  ✓ admin edits user
  ✓ admin sees reports
  ✓ admin resolves report
  ✓ admin sees contact messages
  ✓ admin adds success story
  ✓ approved story is public
  ✓ admin edits website content
  ✓ content change is live
  ✓ admin manages profile photos
  ✓ dashboard reports active / suspended / new users
  ✓ dashboard has recent_users from the database
  ✓ admin can open member details
  ✓ admin can hide a member profile
  ✓ audit log records admin actions
  ✓ audit log never contains passwords
  ✓ an extra administrator can be demoted
  ✓ last administrator cannot remove their own admin rights
  ✓ member cannot read the audit log
  ✓ anonymous caller cannot hit admin APIs
  ✓ admin page does not hardcode a password

11. Logout, login again & persistence
  ✓ logout clears session
  ✓ session invalid after logout
  ✓ wrong password rejected
  ✓ login again works
  ✓ profile persisted after re-login
  ✓ messages persisted after re-login
  ✓ shortlist persisted
  ✓ interest persisted as accepted

12. Forgot password & password change
  ✓ reset link issued
  ✓ password reset works
  ✓ old password no longer valid
  ✓ new password works
  ✓ wrong current password rejected
  ✓ password change works
  ✓ still logged in after password change

13. Pages, assets & security headers
  ✓ every page and asset is served (200)
  ✓ home page loads the app shell
  ✓ home page carries the WhatsApp number
  ✓ home page states the service is free
  ✓ no payment or paywall UI anywhere
  ✓ home page promises no locked profiles
  ✓ login page has register + forgot forms
  ✓ security headers sent
  ✓ unknown page returns 404
  ✓ path traversal is blocked
  ✓ server file not reachable over HTTP: /data/admin-credentials.txt
  ✓ server file not reachable over HTTP: /data/panika-jeevan-sathi.db
  ✓ server file not reachable over HTTP: /server.js
  ✓ server file not reachable over HTTP: /lib/api.js
  ✓ anonymous visitor cannot open a members-only profile
  ✓ anonymous visitor cannot read recommendations
  ✓ unknown API route returns 404

14. Data survives a server restart
  ✓ account survives restart
  ✓ messages survive restart
  ✓ message history intact
  ✓ profile survives restart
  ✓ uploaded photo survives restart

──────────────────────────────────────────────────────────
  134 passed, 0 failed
──────────────────────────────────────────────────────────

--- stderr ---
(none)
