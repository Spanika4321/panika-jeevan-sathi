#!/bin/bash
B=http://localhost:3000
J=/tmp/jarA.txt; K=/tmp/jarB.txt; L=/tmp/jarAdmin.txt
rm -f $J $K $L
pass=0; fail=0
ck() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "PASS: $3"; else fail=$((fail+1)); echo "FAIL: $3 (got: $1, want: $2)"; fi }

# 1. home
ck "$(curl -s -o /dev/null -w '%{http_code}' $B/)" "200" "home page loads"
curl -s $B/ | grep -q "jeevan sathi" && ck 1 1 "hero text present" || ck 0 1 "hero text present"
curl -s $B/ | grep -q "Ananya\|Priya\|Arjun\|Rohan\|Vikram" && ck 1 1 "public seed profiles on home" || ck 0 1 "public seed profiles on home"

# 2. health
curl -s $B/api/health | grep -q '"database":"connected"' && ck 1 1 "db health" || ck 0 1 "db health"

# 3. guest search
ck "$(curl -s -o /dev/null -w '%{http_code}' $B/find-matches)" "200" "guest search page"
GUEST=$(curl -s "$B/find-matches?lookingFor=Female")
echo "$GUEST" | grep -q "Ananya Sharma" && ck 1 1 "guest sees public female profile" || ck 0 1 "guest sees public female profile"

# 4. register A (female)
R=$(curl -s -c $J -X POST $B/api/actions -F action=register \
  -F fullName="Test Ayesha Begum" -F gender=Female -F dateOfBirth=1997-05-10 \
  -F email=ayesha.test@example.com -F mobile=9812345670 \
  -F password=Member@123 -F location="Guwahati, Assam" -F religion=Muslim \
  -F community=Sunni -F motherTongue=Hindi -F education=Graduate \
  -F profession=Teacher -F maritalStatus="Never Married" -F heightCm=163 -F income=600000 \
  -F headline="Teacher from Guwahati" -F lookingFor=Male)
echo "$R" | grep -q '"ok":true' && ck 1 1 "register A" || { echo "REGISTER A RESPONSE: $R"; ck 0 1 "register A"; }
grep -q pjs_session $J && ck 1 1 "session cookie set for A" || ck 0 1 "session cookie set for A"

# 5. register B (male)
R=$(curl -s -c $K -X POST $B/api/actions -F action=register \
  -F fullName="Test Rahul Das" -F gender=Male -F dateOfBirth=1994-08-22 \
  -F email=rahul.test@example.com -F mobile=9812345671 \
  -F password=Member@123 -F location="Silchar, Assam" -F religion=Hindu \
  -F community=Brahmin -F education="M.Tech" -F profession=Engineer \
  -F maritalStatus="Never Married" -F heightCm=175)
echo "$R" | grep -q '"ok":true' && ck 1 1 "register B" || { echo "REGISTER B RESPONSE: $R"; ck 0 1 "register B"; }

# 6. duplicate email rejected
R=$(curl -s -X POST $B/api/actions -F action=register -F fullName="Dup User" -F gender=Male \
  -F dateOfBirth=1995-01-01 -F email=ayesha.test@example.com -F mobile=9999999999 -F password=Member@123)
echo "$R" | grep -q '"ok":false' && ck 1 1 "duplicate email rejected" || ck 0 1 "duplicate email rejected"

# 7. A dashboard
ck "$(curl -s -b $J -o /dev/null -w '%{http_code}' $B/dashboard)" "200" "A dashboard loads"

# 8. A updates profile
R=$(curl -s -b $J -X POST $B/api/actions -F action=updateProfile -F headline="Updated headline — teacher & musician" -F about="I love teaching and music.")
echo "$R" | grep -q '"ok":true' && ck 1 1 "A updateProfile" || { echo "$R"; ck 0 1 "A updateProfile"; }
curl -s -b $J $B/profile | grep -q "Updated headline" && ck 1 1 "profile edit persisted" || ck 0 1 "profile edit persisted"

# 9. A photo upload
python3 -c "
import struct, zlib
def chunk(t, d):
    c = struct.pack('>I', len(d)) + t + d
    return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
w = h = 40
raw = b''.join(b'\x00' + b'\x34\x85\x71' * w for _ in range(h))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
open('/tmp/testphoto.png','wb').write(png)
"
R=$(curl -s -b $J -X POST $B/api/upload -F "photo=@/tmp/testphoto.png;type=image/png")
echo "$R" | grep -q '"ok":true' && ck 1 1 "photo upload" || { echo "UPLOAD: $R"; ck 0 1 "photo upload"; }
PHOTO=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('url',''))")
curl -s -o /dev/null -w '%{http_code}' "$B$PHOTO" | grep -q 200 && ck 1 1 "uploaded photo served" || ck 0 1 "uploaded photo served"

# 10. A searches (member sees members-only profiles)
MEM=$(curl -s -b $J "$B/find-matches?lookingFor=Female")
echo "$MEM" | grep -q "Sana Khan" && ck 1 1 "member sees members-only profile" || ck 0 1 "member sees members-only profile"
FILT=$(curl -s -b $J "$B/find-matches?religion=Muslim&lookingFor=Female")
echo "$FILT" | grep -q "Sana Khan" && ck 1 1 "religion filter works" || ck 0 1 "religion filter works"
FILT2=$(curl -s -b $J "$B/find-matches?religion=Christian&lookingFor=Female")
echo "$FILT2" | grep -q "Sana Khan" && ck 0 1 "filter excludes non-matches" || ck 1 1 "filter excludes non-matches"

# 11. A views Ananya (seed user id 2 — admin is 1)
ck "$(curl -s -b $J -o /dev/null -w '%{http_code}' $B/profile/2)" "200" "A views profile 2"
curl -s -b $J $B/profile/2 | grep -q "Ananya" && ck 1 1 "profile 2 shows Ananya" || ck 0 1 "profile 2 shows Ananya"

# 12. A sends interest to profile 2
R=$(curl -s -b $J -X POST $B/api/actions -F action=sendInterest -F receiverId=2 -F message="Hi Ananya, I would love to know more about you.")
echo "$R" | grep -q '"ok":true' && ck 1 1 "A sends interest" || { echo "$R"; ck 0 1 "A sends interest"; }
# duplicate blocked
R=$(curl -s -b $J -X POST $B/api/actions -F action=sendInterest -F receiverId=2)
echo "$R" | grep -q '"ok":false' && ck 1 1 "duplicate interest rejected" || ck 0 1 "duplicate interest rejected"

# 13. A views Ananya again — shows sent interest state
curl -s -b $J $B/profile/2 | grep -q "Interest sent" && ck 1 1 "sent-interest state visible" || ck 0 1 "sent-interest state visible"

# 14. B logs in fresh (B already has session from register). B goes to /interests — should see received interest from A (A->Ananya is not B; use B receiving from A? Let's have A send interest to B too)
# Find B's user id: search his profile by name
BID=$(curl -s -b $J "$B/find-matches?profession=Engineer&lookingFor=Male" | grep -oE '/profile/[0-9]+' | head -1 | grep -oE '[0-9]+')
echo "B user id: $BID"
R=$(curl -s -b $J -X POST $B/api/actions -F action=sendInterest -F receiverId=$BID -F message="Namaste! Your profile caught my eye.")
echo "$R" | grep -q '"ok":true' && ck 1 1 "A sends interest to B" || { echo "$R"; ck 0 1 "A sends interest to B"; }

# B sees received interest
curl -s -b $K $B/interests | grep -q "Ayesha" && ck 1 1 "B sees received interest from A" || ck 0 1 "B sees received interest from A"

# B accepts the interest (find interest id from B's interests page html? Use API: B accepts by interestId — get from DB-free approach: B's interests page lists forms with interestId)
IID=$(curl -s -b $K $B/interests | grep -oE 'name="interestId" value="[0-9]+"' | head -1 | grep -oE '[0-9]+')
echo "interest id: $IID"
R=$(curl -s -b $K -X POST $B/api/actions -F action=interestStatus -F interestId=$IID -F status=accept)
echo "$R" | grep -q '"ok":true' && ck 1 1 "B accepts interest" || { echo "$R"; ck 0 1 "B accepts interest"; }

# A notified + matched
curl -s -b $J $B/notifications | grep -q "accepted" && ck 1 1 "A notified of acceptance" || ck 0 1 "A notified of acceptance"
curl -s -b $J "$B/matches?tab=my" | grep -q "Rahul" && ck 1 1 "A sees match in My matches" || ck 0 1 "A sees match in My matches"

# 15. conversation: A starts chat with B
R=$(curl -s -b $J -X POST $B/api/actions -F action=startConversation -F profileUserId=$BID)
CID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('redirectTo','').split('/')[-1])")
echo "conversation: $CID"
[ -n "$CID" ] && ck 1 1 "A starts conversation" || ck 0 1 "A starts conversation"

# B cannot message A's seed (Ananya) — no accepted interest; B startConversation to 2 must fail
R=$(curl -s -b $K -X POST $B/api/actions -F action=startConversation -F profileUserId=2)
echo "$R" | grep -q '"ok":false' && ck 1 1 "chat blocked without accepted interest" || ck 0 1 "chat blocked without accepted interest"

# A sends message
R=$(curl -s -b $J -X POST $B/api/actions -F action=sendMessage -F conversationId=$CID -F content="Namaste Rahul! Kaise hain aap?")
echo "$R" | grep -q '"ok":true' && ck 1 1 "A sends message" || { echo "$R"; ck 0 1 "A sends message"; }
curl -s -b $K $B/messages | grep -q "Ayesha" && ck 1 1 "B sees conversation in inbox" || ck 0 1 "B sees conversation in inbox"
curl -s -b $K $B/messages/$CID | grep -q "Kaise hain" && ck 1 1 "B reads the message" || ck 0 1 "B reads the message"
# B replies
R=$(curl -s -b $K -X POST $B/api/actions -F action=sendMessage -F conversationId=$CID -F content="Main badhi hoon! Dhanyabad.")
echo "$R" | grep -q '"ok":true' && ck 1 1 "B replies" || ck 0 1 "B replies"
curl -s -b $J $B/messages/$CID | grep -q "Main badhi hoon" && ck 1 1 "A sees reply" || ck 0 1 "A sees reply"

# 16. shortlist: A shortlists profile 3 (Priya id=3)
R=$(curl -s -b $J -X POST $B/api/actions -F action=shortlist -F profileUserId=3)
echo "$R" | grep -q '"ok":true' && ck 1 1 "A shortlists Priya" || { echo "$R"; ck 0 1 "A shortlists Priya"; }
curl -s -b $J $B/shortlist | grep -q "Priya" && ck 1 1 "shortlist page shows Priya" || ck 0 1 "shortlist page shows Priya"
# toggle off
R=$(curl -s -b $J -X POST $B/api/actions -F action=shortlist -F profileUserId=3)
curl -s -b $J $B/shortlist | grep -q "Priya" && ck 0 1 "shortlist remove toggles off" || ck 1 1 "shortlist remove toggles off"

# 17. recommended matches for A
curl -s -b $J $B/matches | grep -q "Match" && ck 1 1 "recommended matches show" || ck 0 1 "recommended matches show"

# 18. report: B reports profile 4
R=$(curl -s -b $K -X POST $B/api/actions -F action=reportProfile -F profileUserId=4 -F reason="Fake profile" -F details="Test report")
echo "$R" | grep -q '"ok":true' && ck 1 1 "B reports profile 4" || { echo "$R"; ck 0 1 "B reports profile 4"; }

# 19. contact form
R=$(curl -s -X POST $B/api/actions -F action=contactMessage -F name="Visitor" -F email=visitor@example.com -F phone=9812345672 -F message="Is the site 100% free?")
echo "$R" | grep -q '"ok":true' && ck 1 1 "contact message saved" || { echo "$R"; ck 0 1 "contact message saved"; }

# 20. non-admin blocked from /admin
ck "$(curl -s -b $J -o /dev/null -w '%{http_code}' $B/admin)" "307" "member redirected from admin"

# 21. admin login
R=$(curl -s -c $L -X POST $B/api/actions -F action=login -F email=sukulpanika939@gmail.com -F password=Panika@123)
echo "$R" | grep -q '"ok":true' && ck 1 1 "admin login" || { echo "$R"; ck 0 1 "admin login"; }
ck "$(curl -s -b $L -o /dev/null -w '%{http_code}' $B/admin)" "200" "admin panel loads"
curl -s -b $L $B/admin | grep -q "Ayesha" && ck 1 1 "admin sees user A" || ck 0 1 "admin sees user A"
curl -s -b $L "$B/admin?tab=reports" | grep -q "Fake profile" && ck 1 1 "admin sees report" || ck 0 1 "admin sees report"
curl -s -b $L "$B/admin?tab=content" | grep -q "visitor@example.com" && ck 1 1 "admin sees contact msg" || ck 0 1 "admin sees contact msg"

# 22. admin verifies profile 2, then A sees verified badge
R=$(curl -s -b $L -X POST $B/api/actions -F action=adminProfileAction -F userId=2 -F subAction=verify)
echo "$R" | grep -q '"ok":true' && ck 1 1 "admin verifies profile" || { echo "$R"; ck 0 1 "admin verifies profile"; }
curl -s -b $J $B/profile/2 | grep -q "Verified" && ck 1 1 "verified badge visible to member" || ck 0 1 "verified badge visible to member"

# 23. admin announcement
R=$(curl -s -b $L -X POST $B/api/actions -F action=adminAnnouncement -F title="Diwali special" -F body="New members joining this week!" -F audience=all)
echo "$R" | grep -q '"ok":true' && ck 1 1 "admin publishes announcement" || { echo "$R"; ck 0 1 "admin publishes announcement"; }
curl -s $B/ | grep -q "Diwali special" && ck 1 1 "announcement banner on home" || ck 0 1 "announcement banner on home"

# 24. admin resolves report
RID=$(curl -s -b $L "$B/admin?tab=reports" | grep -oE 'name="reportId" value="[0-9]+"' | head -1 | grep -oE '[0-9]+')
R=$(curl -s -b $L -X POST $B/api/actions -F action=adminReportAction -F reportId=$RID -F subAction=resolve -F adminNote="Tested")
echo "$R" | grep -q '"ok":true' && ck 1 1 "admin resolves report" || { echo "$R"; ck 0 1 "admin resolves report"; }

# 25. block: B blocks profile 4, then B search excludes it
R=$(curl -s -b $K -X POST $B/api/actions -F action=blockUser -F profileUserId=4)
echo "$R" | grep -q '"ok":true' && ck 1 1 "B blocks profile 4" || ck 0 1 "B blocks profile 4"
curl -s -b $K "$B/find-matches?lookingFor=Female" | grep -q "Sana Khan" && ck 0 1 "blocked profile hidden from search" || ck 1 1 "blocked profile hidden from search"
curl -s -b $K $B/settings | grep -q "Sana Khan" && ck 1 1 "blocked user listed in settings" || ck 0 1 "blocked user listed in settings"

# 26. logout
R=$(curl -s -b $J -c $J -X POST $B/api/actions -F action=logout)
echo "$R" | grep -q '"ok":true' && ck 1 1 "A logout" || ck 0 1 "A logout"
ck "$(curl -s -b $J -o /dev/null -w '%{http_code}' $B/dashboard)" "307" "logged-out A redirected from dashboard"

# 27. login again with wrong password
R=$(curl -s -X POST $B/api/actions -F action=login -F email=ayesha.test@example.com -F password=Wrong@1234)
echo "$R" | grep -q '"ok":false' && ck 1 1 "wrong password rejected" || ck 0 1 "wrong password rejected"
# and correct login works (persistence across sessions)
R=$(curl -s -c $J -X POST $B/api/actions -F action=login -F email=ayesha.test@example.com -F password=Member@123)
echo "$R" | grep -q '"ok":true' && ck 1 1 "re-login works" || { echo "$R"; ck 0 1 "re-login works"; }
curl -s -b $J $B/profile | grep -q "Updated headline" && ck 1 1 "data persists after re-login" || ck 0 1 "data persists after re-login"

echo ""
echo "=== RESULTS: $pass passed, $fail failed ==="
