'use strict';
/* =====================================================================
 * PANIKA JEEVAN SATHI — CLIENT REPLY BRAIN
 * Human-like auto-reply brain for WhatsApp clients.
 * Languages: हिंदी (hi) · Hinglish (hing) · বাংলা (bn) · Bhojpuri (bho) · ଓଡ଼ିଆ (or)
 * Works in browser AND Node (same file). Zero dependencies.
 * ===================================================================== */

function detectLang(t) {
  t = t || '';
  if (/[\u0980-\u09FF]/.test(t)) return 'bn';   /* Bengali script  */
  if (/[\u0B00-\u0B7F]/.test(t)) return 'or';   /* Odia script     */
  if (/[\u0900-\u097F]/.test(t)) return 'hi';   /* Devanagari      */
  var low = t.toLowerCase();
  if (/\b(hamar|hamra|ba\b|baa\b|hau\b|kaise ba|kaa ba|ka ba|dhundhat|dhundhni|banawat|banani|banai|aile|bhail|baate|khatir|khate rahe|rahe ba|hai na|bhojpuri|purvanchal)\b/.test(low)) return 'bho';
  return 'hing';
}

function detectIntent(t) {
  var low = (t || '').toLowerCase();
  if (/(^|\s)(bye|alvida|alwida|chalta hu|chalti hu|jaa raha|jaa rahi|jachi|asirbad|ashirbad|biday|shubhkamna|আশীর্বাদ|বিদায়|ବିଦାୟ|अलविदा|आशीर्वाद|शुभकामना)($|\s|।|!|\.)/.test(low)) return 'bye';
  if (/thank|thx|dhanyavad|dhanyawad|shukriya|dhonnobad|dhonnobad|ধন্যবাদ|ଧନ୍ୟବାଦ|धन्यवाद/.test(low)) return 'thanks';
  if (/free|muft|mafga|magana|fee|fees|charge|paisa|paise|price|cost|kitna|kitne|kitani|koto|khoroch|kharoch|khoroj|khorche|daam|dam\b|dami|rate|tk\b|taka|রেজিস্ট্রেশন ফি|ফ্রি|দাম|খরচ|টাকা|কত|ଖର୍ଚ୍ଚ|ମାଗଣା|ଟଙ୍କ|କେତେ|फीस|मुफ़्त|मुफ्त|पैसा|कितना|कितने|चार्ज|दाम/.test(low)) return 'price';
  if (/kundali|kundli|gun ?milan|guna milan|janm|janma tithi|কুণ্ডলী|কুন্ডলী|গুণ মিলান|জন্ম|କୁଣ୍ଡଳୀ|ଗୁଣ ମିଳନ|ଜନ୍ମ|कुंडली|कुण्डली|गुण मिलान|जन्म/.test(low)) return 'kundali';
  if (/regist|join|sign ?up|account bana|naya account|new account|naam likh|nam likh|shuru kaise|kaise banau|kaise banaye|kaise banain|kaise jodu|kaise kare|kaise karab|ভর্তি|রেজিস্ট্রে|যোগ দিব|অ্যাকাউন্ট|ରେଜିଷ୍ଟ୍ରେ|ଯୋଗ ଦେବା|ଆକାଉଣ୍ଟ|ତିଆରି|रजिस्टर|रजिस्ट्रेशन|जोड़ना|खाता बना|कैसे जोड़|शुरू कैसे|बनाए|बनानी|बनवाना|बनाउ/.test(low)) return 'register';
  if (/rishta|rista|match|var\b|vadhu|vadhhu|kanya|var kadam|jua|jhia|chhokara|chokara|beti|beta ka|biye|bivah|bibaha|shaadi|shadi|marriage|marry|পাত্র|পাত্রী|বিয়ে|রিস্তা|ঝিঅ|ଯୋଡ଼ି|ବିବାହ|ଝିଅ|ପୁଅ|ରିସ୍ତା|ମେଳ|रिश्ता|वर|वधू|शादी|विवाह|बेटे का|बेटी का|लड़की|लड़का/.test(low)) return 'match';
  if (/safe|surakshit|suraksha|security|bharosa|barosa|biswas|bishesa|নিরাপদ|সুরক্ষিত|ନିରାପଦ|ସୁରକ୍ଷିତ|ବିଶ୍ୱାସ|सुरक्षित|भरोसा|विश्वास/.test(low)) return 'safety';
  if (/\bage|umar|umr|boyesh|boios|bayas|baysa|বয়স|ବୟସ|उम्र|उमर|आयु/.test(low)) return 'age';
  if (/contact|number|phone|call|helpline|support|problem|samasya|somosya|sikayat|complaint|ajhor|যোগাযোগ|সমস্যা|অভিযোগ|ସଂପର୍କ|ସମସ୍ୟା|ଅଭିଯୋଗ|संपर्क|समस्या|शिकायत|नंबर|फोन/.test(low)) return 'contact';
  if (/what is|what'?s this|kya hai|ye kya|yeh kya|eta ki|ei ta ki|ki ache|kein|kana hei|क्या है|ये क्या|এটা কী|କଣ ଏହା|ଏହା କଣ/.test(low)) return 'what';
  if (/(^|\s)(hi|hii+|hey+|hello|namaste|namaskar|namaskaram|pranam|nomoshkar|নমস্কার|ନମସ୍କାର|नमस्ते|प्रणाम|नमस्कार|salaam|adab)([\s,.!।]|$)/.test(low) || /good (morning|evening|afternoon|noon)/.test(low)) return 'greeting';
  return 'fallback';
}

var LANG_LABEL = { hi: 'हिंदी', hing: 'Hinglish', bn: 'বাংলা', bho: 'Bhojpuri', or: 'ଓଡ଼ିଆ' };

var PACK = {
  /* ------------------------------------------------------------ हिंदी */
  hi: {
    greeting: ['नमस्ते जी! 🙏 पणिका जीवन साथी में आपका स्वागत है। बताइए — अपने बच्चे का रिश्ता देखना है या प्रोफाइल बनानी है?',
      'नमस्कार जी 🙏 मैं पणिका जीवन साथी की मदद के लिए हूँ। क्या जानना चाहेंगे — रिश्ते, रजिस्ट्रेशन, या कुछ और?'],
    what: ['यह पणिका जीवन साथी है जी — हमारे समाज की 100% मुफ़्त वैवाहिक वेबसाइट 🙏 पणिका, मानिकपुरी, कबीरपंथी और आदिवासी परिवारों के लिए, बिल्कुल मुफ़्त।'],
    price: ['जी, सब कुछ 100% मुफ़्त है 🙏 ना रजिस्ट्रेशन फीस, ना महीने का चार्ज, ना कोई छुपा हुआ खर्च — प्रोफाइल बनाइए और रिश्ते देखना शुरू कीजिए!',
      'एक रुपया भी नहीं लगता जी 😊 हमारा वादा है — मुफ़्त आज, मुफ़्त हमेशा। बस रजिस्टर कीजिए!'],
    register: ['रजिस्ट्रेशन बहुत आसान है जी 😊 हमारी वेबसाइट खोलिए → Register दबाइए → नाम, उम्र और जानकारी भरिए → बस, हो गया! कोई फीस नहीं है।',
      'बस 2 मिनट का काम है जी 🙏 वेबसाइट पर Register पर जाइए, जानकारी भरिए — और आपकी प्रोफाइल तैयार! कोई भी परेशानी हो तो यहीं बताइए।'],
    match: ['जी बिल्कुल! हमारी साइट पर पणिका, मानिकपुरी, कबीरपंथी और आदिवासी समाज के सत्यापित परिवारों के रिश्ते हैं 🙏 उम्र, शहर और पसंद के हिसाब से खोज सकते हैं।',
      'रिश्ते की तलाश के लिए सबसे पहले प्रोफाइल बनाइए जी 😊 फिर आपको आपके मापदंड के हिसाब से सबसे अच्छे रिश्ते दिखेंगे — बिल्कुल मुफ़्त!'],
    kundali: ['जी, कुंडली मिलान की जानकारी हमारी साइट पर मुफ़्त में मिलती है 🙏 प्रोफाइल में जन्म-तिथि और समय भर दीजिए, मिलान आसान हो जाएगा।'],
    safety: ['जी, एकदम सुरक्षित है 🙏 हमारी टीम हर प्रोफाइल की जाँच करती है। चाहें तो आप अपनी फोटो और नंबर छिपाकर भी बात कर सकते हैं — आपकी मर्ज़ी।'],
    age: ['जी, उम्र कम से कम लड़की की 18 साल और लड़के की 21 साल होनी चाहिए 😊 इसके बाद कोई उम्र की सीमा नहीं — सबके लिए रिश्ते हैं।'],
    contact: ['जी, आप यहीं मैसेज कर दीजिए 🙏 हमारी टीम जल्दी जवाब देगी। वेबसाइट के Contact पेज से भी लिख सकते हैं।'],
    thanks: ['आपका धन्यवाद जी 🙏 कोई भी मदद चाहिए तो बस मैसेज कीजिए — मैं हमेशा हाज़िर हूँ!', 'कोई बात नहीं जी 🙏 हमारा काम ही रिश्ते जोड़ना है। शुभकामनाएँ!'],
    bye: ['ठीक है जी, आपका दिन शुभ हो 🙏 रिश्ते की तलाश में शुभकामनाएँ — जब भी कुछ पूछना हो, मैं यहीं हूँ!'],
    fallback: ['जी बताइए, मैं आपकी क्या मदद कर सकता हूँ? 😊 रिश्ता देखना है, प्रोफाइल बनानी है, या कुछ और पूछना है?',
      'जी, थोड़ा विस्तार से बताइए 🙏 मैं रिश्ते, रजिस्ट्रेशन, कुंडली मिलान — सब में मदद कर सकता हूँ।']
  },

  /* ------------------------------------------------------------ Hinglish */
  hing: {
    greeting: ['Namaste ji! 🙏 Panika Jeevan Sathi me swagat hai. Bataiye — rishta dekhna hai ya profile banana hai?',
      'Hello ji! 😊 Kaise help karun? Rishte, registration ya kisi bhi baat me madad kar dunga.'],
    what: ['Ye Panika Jeevan Sathi hai ji — hamare samaj ki 100% free matrimonial website 🙏 Panika, Manikpuri, Kabirpanthi aur Adivasi parivaron ke liye. Koi paisa nahi lagta!'],
    price: ['Ji, sab kuch 100% FREE hai 🙏 na registration fee, na monthly charge, na hidden cost — bas profile banaiye aur rishte dekhna shuru kijiye!',
      'Ek rupaya bhi nahi lagta ji 😊 Humara promise — free aaj, free hamesha. Bas register kijiye!'],
    register: ['Registration ekdum easy hai ji 😊 Website kholiye → Register dabaiye → naam, umr, details bhariye → done! Koi fee nahi hai.',
      'Bas 2 minute ka kaam hai ji 🙏 Register par jaiye, details bhariye — profile ready! Koi dikkat ho to yahin bataiye.'],
    match: ['Ji bilkul! Hamari site par Panika, Manikpuri, Kabirpanthi aur Adivasi samaj ke verified rishte hain 🙏 Umr, sheher aur pasand ke hisaab se khoj sakte hain.',
      'Sabse pehle profile banaiye ji 😊 Phir aapke hisaab ke best rishte milenge — bilkul free me!'],
    kundali: ['Ji, kundali milan ki jaankari site par free milti hai 🙏 Profile me janm-tithi aur time bhar dijiye, milan aasan ho jayega.'],
    safety: ['Ji, ekdum safe hai 🙏 Team har profile check karti hai. Aap photo/number chhupa kar bhi baat kar sakte hain — aapki marzi.'],
    age: ['Ji, ladki ki umr kam se kam 18 aur ladke ki 21 honi chahiye 😊 Uske baad koi limit nahi — sabke liye rishte hain.'],
    contact: ['Ji, aap yahin message kar dijiye 🙏 Team jaldi reply karegi. Website ke Contact page se bhi likh sakte hain.'],
    thanks: ['Aapka dhanyavaad ji 🙏 Koi bhi madad chahiye to bas message kijiye!', 'Arre kya baat kar rahe hain ji 😊 Humara kaam hi rishte jodna hai. Shubhkamnaye!'],
    bye: ['Theek hai ji, aapka din shubh ho 🙏 Rishte ki talash me best wishes — jab bhi kuch poochna ho, main yahin hoon!'],
    fallback: ['Ji bataiye, kya madad karun? 😊 Rishta dekhna hai, profile banana hai, ya kuch aur poochna hai?',
      'Ji thoda detail me bataiye 🙏 Rishte, registration, kundali — sab me help kar dunga.']
  },

  /* ------------------------------------------------------------ বাংলা */
  bn: {
    greeting: ['নমস্কার জি! 🙏 পানিকা জীবন সাথীতে স্বাগতম। বলুন — ঝিঅ/পুঅর মেল দেখতে চান, নাকি প্রোফাইল বানাতে চান?',
      'নমস্কার জি 🙏 আমি পানিকা জীবন সাথীর সহায়তায় আছি। কী জানতে চান — মেল, রেজিস্ট্রেশন, নাকি অন্য কিছু?'],
    what: ['এটি পানিকা জীবন সাথী জি — আমাদের সমাজের ১০০% ফ্রি বিবাহের ওয়েবসাইট 🙏 পানিকা, মানিকপুরী, কবিরপন্থী এবং আদিবাসী পরিবারের জন্য। কোনো টাকা লাগে না!'],
    price: ['জি, সব সেবা ১০০% ফ্রি 🙏 রেজিস্ট্রেশন ফি নেই, মাসিক চার্জ নেই, লুকানো খরচ নেই — প্রোফাইল বানান, মেল দেখা শুরু করুন!',
      'এক টাকাও লাগবে না জি 😊 আমাদের প্রতিশ্রুতি — আজ ফ্রি, সবসময় ফ্রি। শুধু রেজিস্টার করুন!'],
    register: ['রেজিস্ট্রেশন খুবই সহজ জি 😊 ওয়েবসাইট খুলুন → Register চাপুন → নাম, বয়স, তথ্য দিন → হয়ে গেল! কোনো ফি নেই।',
      'মাত্র ২ মিনিটের কাজ জি 🙏 Register-এ গিয়ে তথ্য দিন — প্রোফাইল তৈরি! কোনো সমস্যা হলে এখানেই বলুন।'],
    match: ['জি অবশ্যই! আমাদের সাইটে পানিকা, মানিকপুরী, কবিরপন্থী ও আদিবাসী সমাজের যাচাই করা পরিবারের মেল আছে 🙏 বয়স, শহর ও পছন্দ অনুযায়ী খুঁজতে পারেন।',
      'প্রথমে প্রোফাইল বানান জি 😊 তারপর আপনার পছন্দমতো সেরা মেল দেখতে পাবেন — একদম ফ্রিতে!'],
    kundali: ['জি, কুণ্ডলী মিলানের তথ্য সাইটে ফ্রি পাওয়া যায় 🙏 প্রোফাইলে জন্মতারিখ ও সময় দিন, মিলান সহজ হয়ে যাবে।'],
    safety: ['জি, একদম নিরাপদ 🙏 আমাদের টিম প্রতিটি প্রোফাইল যাচাই করে। চাইলে ছবি ও নম্বর লুকিয়েও কথা বলতে পারেন — আপনার ইচ্ছা।'],
    age: ['জি, মেয়ের বয়স কমপক্ষে ১৮ এবং ছেলের অন্তত ২১ হতে হবে 😊 এরপর কোনো সীমা নেই — সবার জন্য মেল আছে।'],
    contact: ['জি, এখানেই মেসেজ করুন 🙏 আমাদের টিম দ্রুত উত্তর দেবে। ওয়েবসাইটের Contact পেজ থেকেও লিখতে পারেন।'],
    thanks: ['ধন্যবাদ জি 🙏 কোনো সাহায্য লাগলে শুধু মেসেজ করুন — আমি সবসময় আছি!', 'কোনো ব্যাপার না জি 🙏 মেল জোগাড় করাই আমাদের কাজ। শুভকামনা!'],
    bye: ['ঠিক আছে জি, শুভ দিন 🙏 মেল খোঁজায় শুভকামনা — কিছু জানতে চাইলে আমি এখানেই!'],
    fallback: ['জি বলুন, কীভাবে সাহায্য করব? 😊 মেল দেখতে চান, প্রোফাইল বানাবেন, নাকি অন্য কিছু জানতে চান?',
      'জি একটু বিস্তারিত বলুন 🙏 মেল, রেজিস্ট্রেশন, কুণ্ডলী — সবেই সাহায্য করব।']
  },

  /* ------------------------------------------------------------ Bhojpuri */
  bho: {
    greeting: ['प्रणाम जी! 🙏 Panika Jeevan Sathi me aile khatir swagat ba. Kahe — beta/beti ke rista dekhni ho ki profile banawani ho?',
      'Ram Ram ji 🙏 Ham rista jodne me madad kare la. Ka janna chahti ho — rishta, registration, ya kuch aur?'],
    what: ['E Panika Jeevan Sathi ba ji — hamar samaj ke 100% muft shaadi wali website 🙏 Panika, Manikpuri, Kabirpanthi aru Adivasi pariwar khatir. Ekko paisa nahi lagela!'],
    price: ['Ji, sab kuch ekdum muft ba 🙏 na registration ke paisa, na mahine ka charge, na lukail gupail kharcha — profile bana la aru rista dekha shuru kar la!',
      'Ek rupiya tako nahi lagela ji 😊 hamar bachyal ba — muft aaj, muft sada. Bas register kar la!'],
    register: ['Registration bahut saral ba ji 😊 Website kholi → Register dabai → naam, umr ar jaankari bhar di → bas ho gail! Koi paisa nahi.',
      'Bas 2 minute ke kaam ba ji 🙏 Register par ja ke detail bhar di — profile taiyar! Koi dikkat hoho to yahin batai.'],
    match: ['Ji hokhi! Hamar site par Panika, Manikpuri, Kabirpanthi ar Adivasi samaj ke parghat (verified) pariwar ke rista ba 🙏 Umr, shehar ar pasand ke hisab se khoj sakila.',
      'Pahile profile bana la ji 😊 ta baad me apne hisab ke best rista dekh mile — ekdum muft me!'],
    kundali: ['Ji, kundali milan ke jaankari site par muft mile la 🙏 Profile me janm-tarikh ar samay bhar di, milan aasan ho jai.'],
    safety: ['Ji, ekdum surakshit ba 🙏 Hamar team har profile jaanchat ba. Chaha to photo/namber luki ke bhi baat kar sakila — aapke marzi.'],
    age: ['Ji, kanya ke umr kam se kam 18 ar chhora ke 21 honi chahi 😊 okhar baad koi seema nahi — sabke khatir rista ba.'],
    contact: ['Ji, ahia message kar di 🙏 hamar team jaldi jawab dei. Website ke Contact page se bhi likh sakila.'],
    thanks: ['Ahaar dhanyavaad ji 🙏 koi bhi madad chahi ho to bas message kar di — ham hamesha hajir ba!', 'Kikaa karta ji 😊 rista jodna hi hamar kaam ba. Shubhkamna!'],
    bye: ['Theek ba ji, aapar din shubh raho 🙏 rista khoje me shubhkamna — kabhi kuch puchhna hoho, ham yahin ba!'],
    fallback: ['Ji kahe, ka madad kare? 😊 rista dekhni ho, profile banawani ho, ya kuch aur puchhni ho?',
      'Ji thoda vistar se batai 🙏 rishta, registration, kundali — sab me madad karab.']
  },

  /* ------------------------------------------------------------ ଓଡ଼ିଆ */
  or: {
    greeting: ['ନମସ୍କାର ଜି! 🙏 ପାଣିକା ଜୀବନ ସାଥୀକୁ ସ୍ୱାଗତ। କୁହନ୍ତୁ — ଝିଅ/ପୁଅର ମେଳ ଦେଖିବେ କି ପ୍ରୋଫାଇଲ୍ ତିଆରି କରିବେ?',
      'ନମସ୍କାର ଜି 🙏 ମୁଁ ପାଣିକା ଜୀବନ ସାଥୀ ସହାୟତା ପାଇଁ ଅଛି। କଣ ଜାଣିବାକୁ ଚାହୁଁଛନ୍ତି — ମେଳ, ରେଜିଷ୍ଟ୍ରେସନ୍, ନା ଅନ୍ୟ କିଛି?'],
    what: ['ଏହା ପାଣିକା ଜୀବନ ସାଥୀ ଜି — ଆମ ସମାଜର ୧୦୦% ମାଗଣା ବିବାହ ୱେବସାଇଟ୍ 🙏 ପାଣିକା, ମାନିକପୁରୀ, କବିରପନ୍ଥୀ ଓ ଆଦିବାସୀ ପରିବାର ପାଇଁ। କୌଣସି ପଇସା ଲାଗେ ନାହିଁ!'],
    price: ['ଜୀ, ସବୁ ସେବା ୧୦୦% ମାଗଣା 🙏 ରେଜିଷ୍ଟ୍ରେସନ୍ ଫି ନାହିଁ, ମାସିକ ଚାର୍ଜ ନାହିଁ, ଲୁଚା ଖର୍ଚ୍ଚ ନାହିଁ — ପ୍ରୋଫାଇଲ୍ ତିଆରି କରନ୍ତୁ, ମେଳ ଦେଖା ଆରମ୍ଭ କରନ୍ତୁ!',
      'ଏକ ଟଙ୍କା ବି ଲାଗିବ ନାହିଁ ଜି 😊 ଆମ ପ୍ରତିଶ୍ରୁତି — ଆଜି ମାଗଣା, ସବୁଦିନ ମାଗଣା। କେବଳ ରେଜିଷ୍ଟର କରନ୍ତୁ!'],
    register: ['ରେଜିଷ୍ଟ୍ରେସନ୍ ବହୁତ ସହଜ ଜି 😊 ୱେବସାଇଟ୍ ଖୋଲନ୍ତୁ → Register ଦବାନ୍ତୁ → ନାମ, ବୟସ, ତଥ୍ୟ ଭରନ୍ତୁ → ହୋଇଗଲା! କୌଣସି ଫି ନାହିଁ।',
      'ମାତ୍ର ୨ ମିନିଟ୍ କାମ ଜି 🙏 Register ରେ ଯାଇ ତଥ୍ୟ ଭରନ୍ତୁ — ପ୍ରୋଫାଇଲ୍ ପ୍ରସ୍ତୁତ! କୌଣସି ସମସ୍ୟା ହେଲେ ଏଠାରେ କୁହନ୍ତୁ।'],
    match: ['ଜୀ ନିଶ୍ଚୟ! ଆମ ସାଇଟରେ ପାଣିକା, ମାନିକପୁରୀ, କବିରପନ୍ଥୀ ଓ ଆଦିବାସୀ ସମାଜର ଯାଞ୍ଚିତ ପରିବାରର ମେଳ ଅଛି 🙏 ବୟସ, ସହର ଓ ପସନ୍ଦ ଅନୁଯାୟୀ ଖୋଜିପାରିବେ।',
      'ପ୍ରଥମେ ପ୍ରୋଫାଇଲ୍ ତିଆରି କରନ୍ତୁ ଜି 😊 ପରେ ଆପଣଙ୍କ ପସନ୍ଦର ସେରା ମେଳ ଦେଖିବେ — ଏକଦମ ମାଗଣାରେ!'],
    kundali: ['ଜୀ, କୁଣ୍ଡଳୀ ମିଳନ ସୂଚନା ସାଇଟରେ ମାଗଣା ମିଳେ 🙏 ପ୍ରୋଫାଇଲରେ ଜନ୍ମତାରିଖ ଓ ସମୟ ଭରନ୍ତୁ, ମିଳନ ସହଜ ହୋଇଯିବ।'],
    safety: ['ଜୀ, ଏକଦମ ନିରାପଦ 🙏 ଆମ ଟିମ୍ ପ୍ରତ୍ୟେକ ପ୍ରୋଫାଇଲ୍ ଯାଞ୍ଚ କରନ୍ତି। ଚାହିଁଲେ ଫୋଟୋ/ନମ୍ବର ଲୁଚାଇ ମଧ୍ୟ କଥା ହୋଇପାରିବ — ଆପଣଙ୍କ ଇଚ୍ଛା।'],
    age: ['ଜୀ, ଝିଅର ବୟସ ଅତି କମରେ ୧୮ ଓ ପୁଅର ଅତି କମରେ ୨୧ ହେବା ଦରକାର 😊 ପରେ କୌଣସି ସୀମା ନାହିଁ — ସମସ୍ତଙ୍କ ପାଇଁ ମେଳ ଅଛି।'],
    contact: ['ଜୀ, ଏଠାରେ ମେସେଜ୍ କରନ୍ତୁ 🙏 ଆମ ଟିମ୍ ଶୀଘ୍ର ଉତ୍ତର ଦେବେ। ୱେବସାଇଟ୍‌ର Contact ପେଜ୍ ରୁ ମଧ୍ୟ ଲେଖିପାରିବେ।'],
    thanks: ['ଧନ୍ୟବାଦ ଜି 🙏 କୌଣସି ସହାୟତା ଦରକାର ହେଲେ ମେସେଜ୍ କରନ୍ତୁ — ମୁଁ ସବୁଦିନ ଅଛି!', 'କିଛି ବାତିଲ୍ ନୁହେଁ ଜି 🙏 ମେଳ ଯୋଡ଼ିବା ଆମ କାମ। ଶୁଭକାମନା!'],
    bye: ['ଠିକ୍ ଅଛି ଜି, ଶୁଭ ଦିନ 🙏 ମେଳ ଖୋଜାରେ ଶୁଭକାମନା — କିଛି ପଚାରିବାକୁ ହେଲେ ମୁଁ ଏଠାରେ!'],
    fallback: ['ଜୀ କୁହନ୍ତୁ, କିପରି ସହାୟତା କରିବି? 😊 ମେଳ ଦେଖିବେ, ପ୍ରୋଫାଇଲ୍ ତିଆରି କରିବେ, ନା ଅନ୍ୟ କିଛି?',
      'ଜୀ ଟିକେ ବିସ୍ତାରରେ କୁହନ୍ତୁ 🙏 ମେଳ, ରେଜିଷ୍ଟ୍ରେସନ୍, କୁଣ୍ଡଳୀ — ସବୁରେ ସହାୟତା କରିବି।']
  }
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** Boss ke client ka message do → human-like reply in client's own language. */
function reply(text) {
  var lang = detectLang(text);
  var intent = detectIntent(text);
  var pack = PACK[lang] || PACK.hing;
  return pick(pack[intent] || pack.fallback);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { reply: reply, detectLang: detectLang, detectIntent: detectIntent, PACK: PACK, LANG_LABEL: LANG_LABEL };
}
