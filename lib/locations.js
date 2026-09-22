'use strict';
/**
 * One location tree for three jobs:
 *   1. State → city dropdowns on the profile form, search and home search
 *   2. Indexable community / place / guide pages
 *   3. The sitemap (only pages that are worth crawling)
 *
 * Dropdown-only cities have no `page` flag. A city page is published only when
 * it has its own note — thin copies of the same paragraph are not added.
 * Spelling here is the spelling stored on profiles. Do not "correct" a name
 * in the page without changing the dropdown, or the filter will miss it.
 */

function city(name, extra) {
  const slug = (extra && extra.slug) || String(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return Object.assign({ name, slug }, extra || {});
}

const STATE_ALIASES = {
  cg: 'Chhattisgarh',
  'c.g.': 'Chhattisgarh',
  chattisgarh: 'Chhattisgarh',
  chhatisgarh: 'Chhattisgarh',
  'chhattisgarh state': 'Chhattisgarh',
  mp: 'Madhya Pradesh',
  'm.p.': 'Madhya Pradesh',
  'madhya pradesh state': 'Madhya Pradesh',
  orissa: 'Odisha',
  odisha: 'Odisha',
  up: 'Uttar Pradesh',
  'u.p.': 'Uttar Pradesh',
  uk: 'Uttarakhand',
  'u.k.': 'Uttarakhand',
  uttarakhand: 'Uttarakhand',
  'nct': 'Delhi',
  'new delhi': 'Delhi',
  delhi: 'Delhi',
  'west bengal': 'West Bengal',
  bengal: 'West Bengal'
};

const CITY_ALIASES = {
  'naya raipur': 'Raipur',
  'new raipur': 'Raipur',
  'raipur cg': 'Raipur',
  'bhilai nagar': 'Bhilai',
  'bhilai-3': 'Bhilai',
  guwahati: 'Guwahati',
  gauhati: 'Guwahati',
  banaras: 'Varanasi',
  kashi: 'Varanasi',
  benares: 'Varanasi',
  jabalpur: 'Jabalpur',
  'jubbulpore': 'Jabalpur'
};

const STATES = [
  {
    slug: 'chhattisgarh',
    name: 'Chhattisgarh',
    hindi: 'छत्तीसगढ़',
    page: true,
    languages: ['Chhattisgarhi', 'Hindi'],
    summary: 'Most Panika and Manikpuri searches start here — set the city, not just the state.',
    lead: [
      'Chhattisgarh is the state most families name first when they look for a Panika, Manikpuri or Kabirpanthi match. Households are spread across the plains and the north: Raipur and Durg in the centre, Bilaspur and Janjgir further north, Korba and Raigarh to the east, Ambikapur in Surguja, and Jagdalpur in Bastar. A profile that only says “Chhattisgarh” is hard to use. Parents want a city they can travel to for a first meeting.',
      'Choose the city your family will actually host guests in. Durg is not Raipur. Mungeli is not Bilaspur. Ambikapur is not “near Bilaspur”. The search filter reads the City field exactly. A sentence in About me does not put you into that city’s results. If the town is missing from the list, choose the district city relatives will type, and write the village in About me. Use Other only when relatives will search the smaller name.'
    ],
    faqs: [
      {
        q: 'Should a family in Bhilai select Raipur?',
        a: 'No. Bhilai and Durg are their own cities in the dropdown. A Raipur-only search will not show a Bhilai profile. Search both cities if you can travel between them.'
      },
      {
        q: 'We say Kabirdham at home. What do we select?',
        a: 'Select Kawardha. That is the name in the city list. Write Kabirdham in About me if you want elders to see the name they use.'
      }
    ],
    cities: [
      city('Raipur', {
        page: true,
        hindi: 'रायपुर',
        summary: 'Covers the capital and Naya Raipur, not Durg or Bhilai.',
        nearby: ['Durg', 'Bhilai', 'Mahasamund', 'Baloda Bazar', 'Dhamtari'],
        note: [
          'Select Raipur if the household lives in the capital, in Naya Raipur, or in a Raipur colony such as Tatibandh, and this is where parents can sit with the other family. Many profiles that say Raipur belong to households that moved for work and still meet relatives here. That is fine. The city field is the meeting place, not a birth certificate.',
          'Do not select Raipur for a house in Bhilai, Durg, Mahasamund or Baloda Bazar. Those are separate filters, and families who can only travel inside Raipur will skip a profile that made them come further than they agreed. If you are willing to look in Durg as well, run a second search. One profile cannot sit in two city filters at once.',
          'Write the neighbourhood in About me after the city is set. “Raipur, near Pandri” is useful. “CG” is not. Chhattisgarhi or Hindi is what most elders on this search will read.'
        ]
      }),
      city('Bhilai'),
      city('Durg'),
      city('Bilaspur', {
        page: true,
        hindi: 'बिलासपुर',
        summary: 'Northern Chhattisgarh — Mungeli, Janjgir and Korba are separate filters.',
        nearby: ['Mungeli', 'Janjgir', 'Champa', 'Korba'],
        note: [
          'Bilaspur is the name northern Chhattisgarh families use when the first meeting will happen in the city or in a nearby town such as Takhatpur. It is one of the older centres people mention for Panika and Manikpuri rishtas. Select it when that is the place your elders will receive guests, not because it is the biggest city you have visited.',
          'Mungeli, Janjgir, Champa and Korba are not Bilaspur in the filter. A family that lives in Mungeli and types Bilaspur will be found by people searching Bilaspur and missed by people searching Mungeli. Pick the name your relatives will type into search. If both sides of the family use Bilaspur for any northern trip, Bilaspur is the honest choice, and the village goes in About me.',
          'There is also a Bilaspur in Himachal Pradesh. This page and this dropdown city mean Bilaspur, Chhattisgarh. If you live in the Himachal town, choose Himachal Pradesh and type the city under Other. Do not use this filter.'
        ]
      }),
      city('Korba', {
        page: true,
        hindi: 'कोरबा',
        summary: 'Use Korba for the town families will travel to, not the plant or colony code.',
        nearby: ['Katghora', 'Janjgir', 'Raigarh', 'Bilaspur'],
        note: [
          'Korba profiles are usually households in the town or in villages that treat Korba as the meeting point. Families often work at the power stations or in the coal belt and then write a plant name, a colony number or “KTPS” in the city field. Members cannot filter on those words. Select Korba, and put the plant, the colony or the village in About me.',
          'Katghora does not have its own city in the list. If relatives say Katghora, choose Korba only when they will also search Korba. Otherwise choose Other and type Katghora. Janjgir and Raigarh are separate searches. A Korba filter does not reach them.',
          'Say clearly in About me whether the family can meet in Bilaspur. Some Korba households can, many cannot on a working day. That one line saves a wasted journey.'
        ]
      }),
      city('Raigarh', {
        page: true,
        hindi: 'रायगढ़',
        summary: 'Raigarh is not Raipur. Eastern Chhattisgarh, towards the Odisha side.',
        nearby: ['Sakti', 'Sarangarh', 'Kharsia', 'Sambalpur'],
        note: [
          'Raigarh and Raipur are different cities, and families mix the names when they are typing in a hurry. If the house is in Raigarh district — Raigarh town, Kharsia, or a village that meets people in Raigarh — select Raigarh. A Raipur search will not show you, which is what you want if the other family cannot travel east.',
          'Sakti and Sarangarh are in the dropdown as their own cities. Use them when that is the name elders will search. Households near the Odisha border sometimes also look at Sambalpur. That is a different state filter. Set your own state to Chhattisgarh, and set Preferred state to Odisha only if that is a search you actually want.',
          'Write the district in About me in one line: “Raigarh, not Raipur.” It sounds obvious. It stops the wrong families from writing to you.'
        ]
      }),
      city('Ambikapur', {
        page: true,
        hindi: 'अंबिकापुर',
        summary: 'Surguja families should select Ambikapur — Surguja is not in the city list.',
        nearby: ['Surajpur', 'Baikunthpur', 'Jashpur'],
        note: [
          'Families in Surguja often say the district name, not the city. The dropdown does not have a city called Surguja. Select Ambikapur if that is where you can meet, and write Surguja in About me. People who follow this page and the city filter are searching the word Ambikapur.',
          'Surajpur, Baikunthpur (Korea) and Jashpur are separate cities in the list. The north of the state is a long journey from Raipur and Bilaspur. Do not select those cities hoping a Raipur family will travel. If you want a match from the plains, say so in partner preferences, and keep your own city honest.',
          'A profile that says only “North CG” will not appear for Ambikapur, Raipur or anywhere else useful. Pick the town.'
        ]
      }),
      city('Jagdalpur', {
        page: true,
        hindi: 'जगदलपुर',
        summary: 'Bastar meetings happen in Jagdalpur — a Raipur filter will not see them.',
        nearby: ['Kondagaon', 'Kanker', 'Dantewada'],
        note: [
          'Jagdalpur is the meeting town for most Bastar searches. Weaving is part of the community’s older work, and Bastar is one region where that tradition is still known in families. It is not a requirement on this site, and it is not a reason to hide a teaching or government job. Mention it only if it is part of your house.',
          'Distance from Raipur is the practical point. A family that filtered only Raipur will not see a Jagdalpur profile, and they should not — the journey is not a short visit. Select Jagdalpur, not Raipur, if this is where elders will receive the other family. Kondagaon and Kanker are in the city list if that is the closer town.',
          'If a marriage would mean moving to the plains, say that in About me. Do not imply you live in Raipur in order to be found there.'
        ]
      }),
      city('Rajnandgaon'),
      city('Janjgir'),
      city('Champa'),
      city('Mahasamund'),
      city('Kawardha'),
      city('Bemetara'),
      city('Mungeli'),
      city('Baloda Bazar'),
      city('Dhamtari'),
      city('Kanker'),
      city('Kondagaon'),
      city('Jashpur'),
      city('Baikunthpur'),
      city('Surajpur'),
      city('Sakti')
    ]
  },
  {
    slug: 'madhya-pradesh',
    name: 'Madhya Pradesh',
    hindi: 'मध्य प्रदेश',
    page: true,
    languages: ['Hindi', 'Bagheli'],
    summary: 'Shahdol, Rewa, Satna, Jabalpur and the eastern districts — not a Chhattisgarh profile.',
    lead: [
      'Panika families in Madhya Pradesh are associated especially with the eastern districts — Shahdol, Anuppur, Umaria, Rewa, Satna, Sidhi, Singrauli — and with towns such as Jabalpur, Katni, Mandla and Balaghat. A Madhya Pradesh profile is not a Chhattisgarh profile. The states share families and marriages, but the filter does not treat them as one place.',
      'Set the state you live in now. If you want the search to look toward Chhattisgarh, use Preferred state. Do not write Chhattisgarh in the State field while the house is in Rewa. Families who can only meet inside Chhattisgarh will travel to the wrong state.'
    ],
    faqs: [
      {
        q: 'Our daughter lives in Indore for work and the parents live in Satna. Which city?',
        a: 'Use the city where the first family meeting will happen. If parents will host in Satna, select Satna and mention Indore in About me. A work city that the family will not travel to is the wrong filter.'
      },
      {
        q: 'Is Shahdol the same search as Anuppur or Umaria?',
        a: 'No. All three are in the city list. Select the town relatives will type. Name the other two in About me if you are willing to travel.'
      }
    ],
    cities: [
      city('Jabalpur', {
        page: true,
        hindi: 'जबलपुर',
        summary: 'A Mahakaushal city filter — Bhopal and Indore are not included.',
        nearby: ['Katni', 'Mandla', 'Narsinghpur', 'Seoni'],
        note: [
          'Select Jabalpur when the household lives in the city or will hold the first meeting there. Families sometimes write “Jabalpur side” for Katni, Mandla or Narsinghpur. Those towns are in the list. A Jabalpur-only search does not include them.',
          'Bhopal and Indore are in the dropdown because people move there for work. They are not the same search as Jabalpur, and they are not a substitute for an eastern-district profile. If the parents still live in Shahdol or Rewa, put that city on the profile and mention the work city in About me.',
          'Do not abbreviate the state to MP in the State field if you can avoid it. The form stores “Madhya Pradesh”. Old profiles that say MP are recognised when you open Edit profile, and saving will store the full name.'
        ]
      }),
      city('Shahdol', {
        page: true,
        hindi: 'शहडोल',
        summary: 'Eastern Madhya Pradesh. Anuppur and Umaria stay separate cities.',
        nearby: ['Anuppur', 'Umaria', 'Katni'],
        note: [
          'Shahdol is one of the Madhya Pradesh districts community descriptions name when they talk about where Panika households live. That is a reason families search the word. It is not a reason to file Anuppur or Umaria under Shahdol. Each of those is its own city in the form.',
          'Select Shahdol if the meeting will be in Shahdol town or in a village whose relatives already search that name. Write the village and the tehsil in About me. A profile that says only “eastern MP” is invisible to this filter.',
          'Chhattisgarh is a different state search. If both families are used to crossing the border, say so in preferences. Keep State as Madhya Pradesh if that is where you live.'
        ]
      }),
      city('Rewa', {
        page: true,
        hindi: 'रीवा',
        summary: 'Baghelkhand. Satna is a different city filter from Rewa.',
        nearby: ['Satna', 'Sidhi', 'Mauganj'],
        note: [
          'Rewa and Satna are the two names Baghelkhand families mix most often. They are both in the dropdown, and they do not share results. Select Rewa only if a Satna family would be wrong to expect a meeting in Satna. If you can do either, pick the city where your elders will actually host, and write the other city in About me.',
          'Sidhi and Singrauli are further east and have their own cities in the list. Do not collapse them into Rewa to appear in a larger search. The family that filtered Rewa asked for Rewa.',
          'Preferred state can be Chhattisgarh or Uttar Pradesh if that is a real hope. It does not change the city on your own profile.'
        ]
      }),
      city('Bhopal'),
      city('Indore'),
      city('Satna'),
      city('Anuppur'),
      city('Umaria'),
      city('Katni'),
      city('Sidhi'),
      city('Singrauli'),
      city('Mandla'),
      city('Dindori'),
      city('Balaghat'),
      city('Seoni'),
      city('Chhindwara'),
      city('Narsinghpur'),
      city('Sagar')
    ]
  },
  {
    slug: 'odisha',
    name: 'Odisha',
    hindi: 'ओडिशा',
    page: true,
    languages: ['Odia', 'Hindi'],
    summary: 'Western and southern Odisha — Sambalpur, Balangir, Nuapada, Koraput. The form uses Odisha, not Orissa.',
    lead: [
      'Panika households in Odisha are described especially in the west and south: Bargarh, Balangir, Nuapada, Sambalpur, Kalahandi, Koraput and Nabarangpur. The language at home is often Odia. Write the profile in Odia or Hindi, whichever the elders who will read it actually use. A Hindi-only profile is not rejected. An empty city is.',
      'The state name on the form is Odisha. Orissa is accepted when an old profile is opened, and saving stores Odisha. Do not create two profiles to cover both spellings. Sambalpur, Bargarh, Balangir, Nuapada, Bhawanipatna, Koraput, Jeypore and Nabarangpur are separate cities. Pick the one relatives will type.'
    ],
    faqs: [
      {
        q: 'We use the word bansa, not gotra. Where does it go?',
        a: 'Put it in the Gotra field, and write “bansa” next to the name so the other family knows which word you use. The site does not keep an official list and does not reject a match on this field.'
      },
      {
        q: 'Is a Raigarh search the same as a Sambalpur search?',
        a: 'No. Raigarh is Chhattisgarh. Sambalpur is Odisha. Families near the border should set the state they live in and say in About me if they can meet across the border.'
      }
    ],
    cities: [
      city('Sambalpur', {
        page: true,
        hindi: 'संबलपुर',
        summary: 'Western Odisha. Not the Raigarh filter, even for border families.',
        nearby: ['Bargarh', 'Jharsuguda', 'Balangir'],
        note: [
          'Select Sambalpur when the first meeting will be in Sambalpur. Bargarh, Jharsuguda and Balangir are their own cities. Western Odisha families often know all three towns and still expect the filter to be specific. A profile filed under the wrong town wastes the one weekend both elders were free.',
          'Write in Odia if that is what your parents will read, or in Hindi if that is the language of the rishta talk. The form does not translate. The other family will read exactly what you wrote.',
          'A Chhattisgarh Raigarh search does not show Sambalpur profiles. If your house is on the Odisha side, stay on Odisha. Mention Raigarh in About me only if a meeting there is realistic.'
        ]
      }),
      city('Bhubaneswar'),
      city('Cuttack'),
      city('Bargarh'),
      city('Balangir'),
      city('Nuapada'),
      city('Bhawanipatna'),
      city('Koraput'),
      city('Jeypore'),
      city('Nabarangpur'),
      city('Jharsuguda'),
      city('Rourkela')
    ]
  },
  {
    slug: 'jharkhand',
    name: 'Jharkhand',
    hindi: 'झारखंड',
    page: true,
    languages: ['Hindi', 'Sadri'],
    summary: 'Ranchi, the coal belt, and families who moved from Chhattisgarh or Odisha.',
    lead: [
      'Jharkhand is a smaller search on this site than Chhattisgarh or Madhya Pradesh, and the page exists so families who actually live here are not told to pretend they live in Raipur. Ranchi, Jamshedpur, Dhanbad, Bokaro, Hazaribagh, Gumla, Simdega and Lohardaga are in the city list. Gumla and Simdega matter because families with relatives in northern Chhattisgarh or western Odisha sometimes meet there.',
      'Set Jharkhand if the house is in Jharkhand. Preferred state can point at Chhattisgarh or Odisha. A Ranchi profile that says Chhattisgarh in the State field will be shown to people who cannot travel to Ranchi, and hidden from people who filtered Jharkhand on purpose.'
    ],
    faqs: [
      {
        q: 'There is no city page for Ranchi. Will a Ranchi profile still be found?',
        a: 'Yes. City pages explain the search. They are not required for a profile to appear. Select Ranchi in the form. Members who filter State Jharkhand and City Ranchi will see a searchable profile.'
      },
      {
        q: 'We live in a village that is not listed.',
        a: 'Choose the town your relatives will type — often Ranchi, Gumla or Simdega — or choose Other and type the village name if that is the word they search. Put the district in About me either way.'
      }
    ],
    cities: [
      city('Ranchi'),
      city('Jamshedpur'),
      city('Dhanbad'),
      city('Bokaro'),
      city('Hazaribagh'),
      city('Gumla'),
      city('Simdega'),
      city('Lohardaga'),
      city('Daltonganj'),
      city('Garhwa')
    ]
  },
  {
    slug: 'uttar-pradesh',
    name: 'Uttar Pradesh',
    hindi: 'उत्तर प्रदेश',
    page: true,
    languages: ['Hindi'],
    summary: 'Varanasi, Mirzapur, Sonbhadra and families who use Kabirpanth as the panth name.',
    lead: [
      'Uttar Pradesh on this site is mainly the eastern districts families already connect with the community or with Kabirpanth: Varanasi, Mirzapur, Sonbhadra (Robertsganj), Prayagraj, and households that have moved to Lucknow, Kanpur or Noida. It is not a claim that every district of Uttar Pradesh has the same search. If you live in the west of the state, the city list still has Lucknow, Noida and Kanpur, and Other is there for a town that is missing.',
      'Kabir’s tradition is associated with the Varanasi region and with Maghar. That is history families already know. It does not make a Varanasi profile a Chhattisgarh profile, and it does not make every Kabirpanthi family Panika. Fill Religion / Panth and Community as two fields. Fill State with the state you live in.'
    ],
    faqs: [
      {
        q: 'Maghar is not in the city list. What should we select?',
        a: 'Choose Other and type Maghar if that is the name relatives search. Do not select Varanasi unless a Varanasi meeting is what you are offering. You can mention Sant Kabir and Maghar in About me either way.'
      },
      {
        q: 'Our parents say Sonbhadra, not Robertsganj.',
        a: 'Robertsganj is the city in the list for that district. Select it if they will also understand Robertsganj, and write Sonbhadra in About me. If they will only search the word Sonbhadra, choose Other and type Sonbhadra.'
      }
    ],
    cities: [
      city('Varanasi', {
        page: true,
        hindi: 'वाराणसी',
        summary: 'Kashi / Banaras profiles should select Varanasi. Maghar is Other.',
        nearby: ['Mirzapur', 'Prayagraj', 'Robertsganj'],
        note: [
          'The city in the dropdown is Varanasi. Banaras and Kashi are accepted as old profile text and mapped to Varanasi when you open Edit profile, so saving does not lose them. New profiles should select Varanasi directly. Families searching this page are using that spelling.',
          'This is not a Chhattisgarh search and not a general India search. Mirzapur, Prayagraj and Robertsganj (Sonbhadra) are separate cities. Maghar is not in the list — type it under Other if that is the meeting place. Mentioning Sant Kabir in About me is welcome if it is how your family introduces itself. It does not replace the city.',
          'A Kabirpanthi family in Varanasi should still set Community to the word they use for a rishta — Kabirpanthi, Panika, Manikpuri or Adivasi. Religion / Panth can be Kabirpanth at the same time. One field does not fill the other.'
        ]
      }),
      city('Lucknow'),
      city('Prayagraj'),
      city('Gorakhpur'),
      city('Mirzapur'),
      city('Robertsganj'),
      city('Kanpur'),
      city('Ayodhya'),
      city('Sultanpur'),
      city('Azamgarh'),
      city('Noida')
    ]
  },
  {
    slug: 'maharashtra',
    name: 'Maharashtra',
    hindi: 'महाराष्ट्र',
    page: true,
    languages: ['Marathi', 'Hindi'],
    summary: 'Vidarbha is the usual community search. Mumbai and Pune are work cities, not the same filter.',
    lead: [
      'Eastern Maharashtra is where this search is most useful: Nagpur, Chandrapur, Gadchiroli, Gondia, Bhandara and Wardha. Families there often have relatives in Bastar, Balaghat or southern Chhattisgarh. Mumbai, Thane, Navi Mumbai and Pune are in the list because people move west for work. A Mumbai profile is a Mumbai profile. It does not appear in a Nagpur search.',
      'Set the state you live in. If the marriage is expected to be discussed with parents who still live in Chhattisgarh, write that in About me and set Preferred state. Do not list Chhattisgarh as your own state to be found by a Raipur filter while you live in Nagpur. The other family will plan a meeting in the wrong city.'
    ],
    faqs: [
      {
        q: 'We live in Mumbai and want a match from Chhattisgarh. What do we select?',
        a: 'State Maharashtra, city Mumbai (or Thane or Navi Mumbai). Preferred state Chhattisgarh. Say in About me which city in Chhattisgarh the parents can travel to. Do not put Raipur in your own City field unless you can meet in Raipur.'
      },
      {
        q: 'Is Gondia part of the Nagpur filter?',
        a: 'No. Gondia, Bhandara, Wardha, Chandrapur and Gadchiroli are separate cities. Select the town you will meet in.'
      }
    ],
    cities: [
      city('Nagpur', {
        page: true,
        hindi: 'नागपुर',
        summary: 'Vidarbha. Gondia, Wardha and Chandrapur are not inside this filter.',
        nearby: ['Wardha', 'Bhandara', 'Gondia', 'Chandrapur'],
        note: [
          'Select Nagpur for a household in the city. Wardha, Bhandara, Gondia, Chandrapur and Gadchiroli are separate filters even though families talk about them as one side of the state. A Nagpur search is not a Vidarbha-wide search. If you need the wider search, leave City empty and filter only by Maharashtra, then read the city on each profile.',
          'Relatives in Jagdalpur or Balaghat are a reason to write those towns in About me. They are not a reason to set your state to Chhattisgarh or Madhya Pradesh while you live in Nagpur. Preferred state exists for that hope.',
          'Mumbai is not a nearby city in any practical sense for a first meeting. Do not select Nagpur for a Mumbai job posting. Select the city where the elders will sit down with the other family.'
        ]
      }),
      city('Mumbai'),
      city('Navi Mumbai'),
      city('Thane'),
      city('Pune'),
      city('Chandrapur'),
      city('Gadchiroli'),
      city('Gondia'),
      city('Bhandara'),
      city('Wardha')
    ]
  },
  {
    slug: 'assam',
    name: 'Assam',
    hindi: 'असम',
    page: true,
    languages: ['Assamese', 'Hindi', 'Bengali'],
    summary: 'For Kabirpanthi families in Assam, and for Panika households who have moved — not a copy of the Chhattisgarh page.',
    lead: [
      'This page is for families who live in Assam. Kabirpanthi households are part of the community this site serves, including families outside Chhattisgarh and Madhya Pradesh. Some Panika and Manikpuri households have also moved to Assam for work. The page does not claim that Assam has the same number of Panika households as Raipur or Bilaspur. Inventing that would waste everyone’s time.',
      'Guwahati, Dibrugarh, Jorhat, Silchar, Tezpur and Nagaon are in the city list. Select the town you live in. If you hope for a match from Chhattisgarh, set Preferred state and say which city your side can travel to. Do not file the profile as Raipur. A Raipur family cannot meet you in Guwahati next Sunday just because the form said Raipur.'
    ],
    faqs: [
      {
        q: 'We are Kabirpanthi and not Panika. Can we register?',
        a: 'Yes, if your family is one of the communities the service is for: Panika, Manikpuri, Kabirpanthi or Adivasi. Select Kabirpanthi as Community and Kabirpanth as Religion / Panth if both are true. Read the community page if you are unsure which name your elders use.'
      },
      {
        q: 'Our town is not listed.',
        a: 'Choose Other and type the town. Do not select Guwahati unless relatives will search Guwahati or you can meet there. Write the district in About me.'
      }
    ],
    cities: [
      city('Guwahati', {
        page: true,
        hindi: 'गुवाहाटी',
        summary: 'Assam’s meeting city for families who search Guwahati. Gauhati is stored as Guwahati.',
        nearby: ['Nagaon', 'Tezpur'],
        note: [
          'Select Guwahati if you live in Guwahati or will hold the first meeting there. The older spelling Gauhati is mapped to Guwahati when an existing profile is opened. Dibrugarh, Jorhat, Silchar, Tezpur and Nagaon are different cities. A tea-garden town that relatives call by its own name should be typed under Other, not hidden inside Guwahati.',
          'Say which language the elders will read — Assamese, Hindi or Bengali — and write About me in that language. The site does not translate profiles. A Hindi profile is acceptable. A profile with no city is not useful.',
          'If the family moved from Chhattisgarh or Uttar Pradesh, name the home district in About me and keep State as Assam. Preferred state is the right place for “we are also looking toward Raipur”. The City field is where you are.'
        ]
      }),
      city('Dibrugarh'),
      city('Jorhat'),
      city('Silchar'),
      city('Tezpur'),
      city('Nagaon')
    ]
  },
  {
    slug: 'west-bengal',
    name: 'West Bengal',
    hindi: 'पश्चिम बंगाल',
    page: true,
    languages: ['Bengali', 'Hindi'],
    summary: 'A smaller search. Kolkata is for families who live there, not a substitute for a Chhattisgarh city.',
    lead: [
      'West Bengal is in the dropdown because Panika families are also reported in the state, and because Kabirpanthi and Adivasi households live in Kolkata, Asansol, Durgapur, Siliguri and Purulia. This is a smaller search than Chhattisgarh. The page is here so a family in Kolkata can file an honest profile instead of borrowing Raipur.',
      'Select the city you live in. Howrah is separate from Kolkata. Purulia is in the list for families in the west of the state who have relatives toward Jharkhand. Write Bengali or Hindi, the language the other parents will read. Preferred state can point home if home is elsewhere.'
    ],
    faqs: [
      {
        q: 'Why is there no separate Kolkata page?',
        a: 'A city page is added only when it can say something the state page cannot. Kolkata profiles are found by filtering State West Bengal and City Kolkata. The missing page does not hide a profile.'
      },
      {
        q: 'We live in a district that is not listed.',
        a: 'Choose Other and type the town elders will search. Put the district in About me. Do not select Kolkata for a district town you will not travel to.'
      }
    ],
    cities: [
      city('Kolkata'),
      city('Howrah'),
      city('Asansol'),
      city('Durgapur'),
      city('Siliguri'),
      city('Purulia')
    ]
  },
  {
    slug: 'bihar',
    name: 'Bihar',
    hindi: 'बिहार',
    page: true,
    languages: ['Hindi', 'Bhojpuri'],
    summary: 'Patna, Gaya and families with ties toward eastern Uttar Pradesh. Set the city you can meet in.',
    lead: [
      'Bihar is a smaller search on this site. The page exists for families who live in Patna, Gaya, Bhagalpur, Muzaffarpur, Sasaram or Ara, and for Kabirpanthi households who should not be told to pick a Chhattisgarh city they cannot meet in. Bhojpuri or Hindi is what most elders will read. Write the profile in that language.',
      'If the family’s rishta talk still happens in Uttar Pradesh, set Preferred state to Uttar Pradesh and name the town. Keep your own State as Bihar. A Gaya profile filed as Varanasi will disappoint the family that travels to the wrong city.'
    ],
    faqs: [
      {
        q: 'Sasaram is listed. Our village is in Rohtas and is not.',
        a: 'Select Sasaram if that is the meeting town relatives already search. Otherwise choose Other and type the village. Write Rohtas in About me so the district is visible.'
      },
      {
        q: 'Will anyone from Chhattisgarh see us?',
        a: 'Only if they search Bihar, or if they leave the state filter empty. You can also send interest to profiles you find by searching Chhattisgarh yourself. Do not fake your city to appear in their filter.'
      }
    ],
    cities: [
      city('Patna'),
      city('Gaya'),
      city('Bhagalpur'),
      city('Muzaffarpur'),
      city('Sasaram'),
      city('Ara')
    ]
  },
  {
    slug: 'delhi',
    name: 'Delhi',
    hindi: 'दिल्ली',
    page: true,
    languages: ['Hindi'],
    summary: 'For families who live in Delhi now. The home district belongs in About me, not in the State field.',
    lead: [
      'Delhi is a work city for many families whose parents still describe themselves as being from a district in Chhattisgarh, Madhya Pradesh or Uttar Pradesh. Select Delhi, and select New Delhi or Delhi as the city you can actually meet in. Write the home district in About me in one line: “Family home: Raigarh. We live in Delhi.” That is more useful than a State field that pretends you are still in Raigarh.',
      'Preferred state is where you hope to find a match. It can be Chhattisgarh while you live in Delhi. Members who filter Delhi will find you. Members who filter only Raigarh will not, unless you search them yourself and send interest. Both can be true. Neither requires a false city.'
    ],
    faqs: [
      {
        q: 'New Delhi or Delhi — which one?',
        a: 'Pick the name your relatives will type. If you are unsure, New Delhi is the name most people search for the capital. Say the neighbourhood — Dwarka, Rohini, Laxmi Nagar — in About me. The neighbourhood is not the city filter.'
      },
      {
        q: 'We are in Gurugram or Noida, not Delhi.',
        a: 'Gurugram is Haryana. Noida is Uttar Pradesh. Do not select Delhi for either. Both cities are in those states’ lists. A Delhi family will not cross that as if it were the same colony unless you say, in About me, that you can meet in Delhi.'
      }
    ],
    cities: [
      city('New Delhi'),
      city('Delhi')
    ]
  },
  plainState('Andhra Pradesh', 'andhra-pradesh', ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Tirupati']),
  plainState('Arunachal Pradesh', 'arunachal-pradesh', ['Itanagar']),
  plainState('Goa', 'goa', ['Panaji', 'Margao']),
  plainState('Gujarat', 'gujarat', ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot']),
  plainState('Haryana', 'haryana', ['Gurugram', 'Faridabad', 'Panipat', 'Ambala']),
  plainState('Himachal Pradesh', 'himachal-pradesh', ['Shimla', 'Dharamshala', 'Solan', 'Mandi']),
  plainState('Karnataka', 'karnataka', ['Bengaluru', 'Mysuru', 'Hubballi']),
  plainState('Kerala', 'kerala', ['Thiruvananthapuram', 'Kochi', 'Kozhikode']),
  plainState('Manipur', 'manipur', ['Imphal']),
  plainState('Meghalaya', 'meghalaya', ['Shillong']),
  plainState('Mizoram', 'mizoram', ['Aizawl']),
  plainState('Nagaland', 'nagaland', ['Kohima', 'Dimapur']),
  plainState('Punjab', 'punjab', ['Ludhiana', 'Amritsar', 'Jalandhar', 'Chandigarh']),
  plainState('Rajasthan', 'rajasthan', ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota']),
  plainState('Sikkim', 'sikkim', ['Gangtok']),
  plainState('Tamil Nadu', 'tamil-nadu', ['Chennai', 'Coimbatore', 'Madurai']),
  plainState('Telangana', 'telangana', ['Hyderabad', 'Warangal']),
  plainState('Tripura', 'tripura', ['Agartala']),
  plainState('Uttarakhand', 'uttarakhand', ['Dehradun', 'Haridwar', 'Haldwani']),
  plainState('Jammu and Kashmir', 'jammu-and-kashmir', ['Jammu', 'Srinagar']),
  plainState('Ladakh', 'ladakh', ['Leh']),
  plainState('Chandigarh', 'chandigarh', ['Chandigarh']),
  plainState('Puducherry', 'puducherry', ['Puducherry']),
  plainState('Andaman and Nicobar Islands', 'andaman-and-nicobar-islands', ['Port Blair'])
];

function plainState(name, slug, cities) {
  return {
    name,
    slug,
    page: false,
    languages: [],
    cities: cities.map((item) => city(item))
  };
}

const COMMUNITIES = [
  {
    slug: 'panika',
    name: 'Panika',
    hindi: 'पनिका',
    also: ['Panka', 'Panikar'],
    summary: 'Also called Panka and Panikar. Select Panika if that is the word your family uses.',
    paragraphs: [
      'Panika is the name this website is built around. Families are also called Panka and Panikar. The community is Hindu, and published descriptions place households in Chhattisgarh, Madhya Pradesh, Odisha, Jharkhand and Uttar Pradesh. Weaving is the traditional occupation. On this site today you will also see teaching, farming, government work, private jobs, skilled trades and business. None of those is more “correct” on the form. Write the work you actually do.',
      'Select Community → Panika if that is the word your elders use when they propose a rishta. Manikpuri, Kabirpanthi and Adivasi are separate options because families search those words separately. This page does not decide whether two of those names are the same jati. If relatives might search a second name, write that name in About me and search it yourself. Do not create two accounts.',
      'Religion / Panth is a different field. Many Panika families follow Kabirpanth. Some do not. Set Kabirpanth there if it is true, and still set Community to Panika. A community filter does not read the religion field. Leaving Community empty, or setting only the panth, hides the profile from the search your own relatives are using.',
      'Gotra, bansa or the local sept name goes in the Gotra field as your elders say it. The site does not keep a master list, and it will not block a match because the field is empty or unfamiliar. Sub-community is there for a more specific name if your family uses one. Reservation category, caste certificate and political status are not collected. This is a matrimonial form, not an official record.',
      'Then set State and City from the dropdown, using the same spelling as the place pages. A Panika profile in Raipur is found by families who filter Community Panika, State Chhattisgarh, City Raipur. A different spelling, or the city written only in About me, does not enter that filter. Registration, search, interest and messaging stay free. There is no paid plan that reveals a hidden profile.'
    ],
    faqs: [
      {
        q: 'We are called Panka at home. Which option is that?',
        a: 'Select Panika. Panka and Panikar are other spellings of the same name used in older descriptions. Write Panka in About me if you want that spelling visible. Do not register a second account under a different community just to catch both words.'
      },
      {
        q: 'Does the site check caste certificates?',
        a: 'No. You are asked to choose the community name your family uses. The service is intended for Panika, Manikpuri, Kabirpanthi and Adivasi families. It does not collect or display a certificate, and these pages do not discuss reservation status.'
      }
    ]
  },
  {
    slug: 'manikpuri',
    name: 'Manikpuri',
    hindi: 'माणिकपुरी',
    also: ['Manikpur'],
    summary: 'Select Manikpuri if that is the word your family says. The site will not decide if it is the same as Panika.',
    paragraphs: [
      'Manikpuri is its own community option because that is the word many families — especially in Chhattisgarh — say when they introduce a rishta. Some of those families also say Panika. Some do not want the names treated as the same. This website will not settle that question. A matrimonial form that pretends to is how families get angry before they have even met.',
      'Select Manikpuri if that is the word your elders use. If cousins will search Panika, write “also searched as Panika” in About me, and when you search, run both community filters. One profile can have only one community value. Two accounts for the same person are not allowed and will be removed if reported.',
      'Sub-community and Gotra are free text. Put the name your family uses. Do not leave Community as Manikpuri and then type a contradictory community into every other box as a trick to appear in more searches. Members report profiles that do this, and a report is reviewed.',
      'Location still decides who can actually meet you. A Manikpuri household in Bilaspur should select Chhattisgarh and Bilaspur, not “Panika cities” as if that were a place. Read the place page for your city before you choose a nearby town. The filter is literal.',
      'Kabirpanth, if it applies, goes in Religion / Panth. It does not replace Manikpuri in the Community field. Adivasi is a different option. Select it only if that is also a name your family uses for itself. When you are unsure, ask an elder which single word they want on the rishta, and use that word here.'
    ],
    faqs: [
      {
        q: 'Should we select Panika so more people find us?',
        a: 'Select the name your family uses. A larger filter full of the wrong name is how you get interests you will decline. Write the other name in About me, and search both yourself.'
      },
      {
        q: 'The form says Manikpuri and we spell it Manikpur.',
        a: 'Select Manikpuri. Add the spelling you use in About me. The filter matches the option, not the About me spelling.'
      }
    ]
  },
  {
    slug: 'kabirpanthi',
    name: 'Kabirpanthi',
    hindi: 'कबीरपंथी',
    also: ['Kabirpanth'],
    summary: 'A community option and a panth. Fill both fields if both are true. Assam and Uttar Pradesh families should use their own state.',
    paragraphs: [
      'Kabirpanthi on this form means the word your family uses for the rishta. Kabirpanth in Religion / Panth means the tradition you follow. They are separate because they are not always the same answer. Many Panika families follow Kabirpanth and still say Panika when they talk about community. Some households say Kabirpanthi as the community name itself. Some Kabirpanthi families are not Panika. The form allows each of those without forcing the others.',
      'If both are true, set both. Community Kabirpanthi, Religion / Panth Kabirpanth. If you are Panika and Kabirpanthi, choose the community word your elders want on the rishta — usually Panika — and set the panth to Kabirpanth. Write the second community word in About me. A search for Community Kabirpanthi will not see a profile that only set the religion field.',
      'Sant Kabir’s tradition is associated with the Varanasi region and with Maghar. Families know that. It is not an instruction to set your state to Uttar Pradesh if you live in Raipur, and it is not an instruction to set Raipur if you live in Guwahati. Kabirpanthi families in Assam should select Assam and their city. Families in Uttar Pradesh should select Uttar Pradesh. The place pages for Guwahati and Varanasi say the same thing, because this mistake is common and it ruins the first meeting.',
      'The site does not describe how your local satsang conducts a marriage, and it will not rank one way as more correct. If the form of the wedding matters to you — a simple Kabirpanthi ceremony, or the rites your elders already follow — write that in partner preferences in plain language. Do not assume the other family uses the same word for the same rite.',
      'The service is for Panika, Manikpuri, Kabirpanthi and Adivasi families. Selecting Kabirpanthi is a statement that your family is registering on that basis. It is not a public directory of satsangs, and these pages never list members.'
    ],
    faqs: [
      {
        q: 'Which field does a Kabirpanth filter use?',
        a: 'Search has its own Religion / Panth filter and its own Community filter. Set the field you want to be found by. Setting only one means the other filter misses you.'
      },
      {
        q: 'We live in Assam. Is this page for us?',
        a: 'Yes, if Kabirpanthi is the community name your family uses. Select Assam and your city on the profile. Read the Assam and Guwahati pages so the state is not copied from a Chhattisgarh example.'
      }
    ]
  },
  {
    slug: 'adivasi',
    name: 'Adivasi',
    hindi: 'आदिवासी',
    also: [],
    summary: 'A wide name. Put the specific community in Sub-community. Do not use it as a synonym for Panika.',
    paragraphs: [
      'Adivasi is a wide description. It is not one gotra, not one language, and not a polite synonym for Panika. The option exists because Adivasi families asked to search here, and because the service’s own notice names Adivasi as one of the four communities it is for. Select it if that is the word your family uses. Do not select it in addition to Panika by opening two accounts.',
      'Put the specific name in Sub-community — the word your elders use for the community, clan or group. Put gotra or the local clan name in Gotra. Members who understand those names will read them. The site does not auto-match them and does not reject a profile because the name is unfamiliar to someone from another state.',
      'Do not write a stereotype in About me, and do not expect one on the profile you receive. Education, work and family type are ordinary fields. Fill them the same way any other member does. A profile that only says “Adivasi family, simple” is how interested families lose confidence. Say the city, the work, and who will come to the first meeting.',
      'State and City still have to be true. An Adivasi household in Jagdalpur selects Chhattisgarh and Jagdalpur. A household in Gumla selects Jharkhand and Gumla. A household in Gadchiroli selects Maharashtra and Gadchiroli. The community page does not change the distance.',
      'Privacy settings work the same as for every other member. You can hide your photo and your phone number, and you can leave search. These public pages do not show member names. If a profile asks you for money, report it. That rule is not different here.'
    ],
    faqs: [
      {
        q: 'Our specific community is not in the Community dropdown.',
        a: 'The Community dropdown is only the four names the service is for. Select Adivasi, and type the specific name in Sub-community. If your elders do not use the word Adivasi at all, do not select it — talk to them about which of the four names, if any, they want used.'
      },
      {
        q: 'Will Panika families see an Adivasi profile in a Panika search?',
        a: 'No. A Panika community filter shows Panika. They will see you only if they leave Community empty, or if they filter Adivasi. Search their community yourself if you want to send interest.'
      }
    ]
  }
];

const GUIDES = [
  {
    slug: 'how-to-create-a-profile',
    title: 'How to create a free matrimonial profile',
    hindi: 'मुफ्त प्रोफाइल कैसे बनाएँ',
    summary: 'What to fill, which city spelling matches search, and what to leave out.',
    paragraphs: [
      'A useful profile is a form another family can filter, not a long advertisement. Registration is free. You need an email address and a password. After that the site opens Edit profile. Nothing is locked behind a payment, and there is no second plan that shows your photo to more people. If someone says there is, they are not speaking for this website.',
      'Start with the fields search actually reads. Age, gender, marital status, community, religion, state, city, education and occupation are filters. About me is not a filter. A beautiful paragraph that mentions Raipur will not appear when someone filters City Raipur. The City dropdown has to say Raipur.',
      'State and City are dropdowns, fed by the same list as the place pages on this site. Chhattisgarh and the other community states are listed first, then the rest of India. Choose the state you live in. Choose the city where your elders can meet the other family. If the town is missing, choose Other and type it. Do not invent a spelling. “Bilaspur CG”, “BSP” and “near Bilaspur” are three ways to disappear from a Bilaspur search. Old short forms such as CG, MP, Orissa, Banaras and Gauhati are recognised when you reopen the profile, and the form offers the full name. Save once so the stored value matches the filter.',
      'Community is Panika, Manikpuri, Kabirpanthi or Adivasi — one of them. Read the community page if two names are used in your house, then pick the one elders will say at a meeting. Religion / Panth is separate. Kabirpanth does not fill Community for you. Gotra is free text. Type what your family says. The site does not reject a rishta because gotra is blank, and it does not keep an official gotra list that you must match.',
      'Photo: a recent, clear photo of the person who is getting married, not a group photo and not a photo from ten years ago. You can hide the photo from people who are not logged in, or from everyone except members you choose, in privacy settings. Hiding it reduces interests. That is your decision, and it is free either way. Phone number is optional. If you type it, you can hide it until you accept an interest. Do not also paste the number into About me, or the hide switch does nothing.',
      'About me should say how the household lives: who is in the house, what the work actually is, whether you can move, and what a first meeting looks like. “Family oriented, simple, god fearing” could be any profile on any site. “Father is a teacher in Raigarh. We can meet in Raigarh on a Sunday. We are not looking at Raipur.” is a profile someone can answer. Partner preferences are the same. Preferred state is a real field. Use it if you hope for a particular state. Do not put that state in your own City field.',
      'Then save. The strength bar is a reminder, not a score other members see as a rank you paid for. Search is available as soon as you are logged in. Filter the city you just selected and see whether the form is doing what you think. Send interest only after you have read the profile. Accept or decline interests you receive. Silence is how families decide the site does not work.',
      'Do not send money. Do not ask for money. Do not share an OTP. Meet with elders present, in a place both families chose. Report a profile that breaks those rules — the report goes to the moderation queue, and it is not published on these pages. If you want the profile taken down entirely, Settings has account deletion. It removes the account. It is not a paid service.'
    ]
  },
  {
    slug: 'family-gotra-and-introductions',
    title: 'Gotra, community names and family introductions',
    hindi: 'गोत्र, समाज का नाम और परिवार का परिचय',
    summary: 'How to write gotra or bansa, which community name to pick, and how to introduce the family.',
    paragraphs: [
      'Families ask three questions before they ask anything else: which community name, which gotra, and who will come to the meeting. The form has a field for each. None of them is checked against a government list. What you type is what the other family reads. Write it the way your elders say it, not the way a form from another state spelled it.',
      'Community is one of four options: Panika, Manikpuri, Kabirpanthi, Adivasi. Pick the word that will be said out loud when the rishta is proposed. If the house uses two words, pick the one the elders insist on, and put the other in About me. The Panika page, the Manikpuri page and the Kabirpanthi page explain why the site refuses to declare those names identical. Read the one that matches the argument in your own family before you pick. Adivasi families should add the specific community name in Sub-community. A wide label alone is not an introduction.',
      'Gotra has different local words. Some families say gotra. In parts of Odisha the word families recognise is bansa, a named sept. Other regions have their own clan word. Type that name in Gotra, and if the word itself matters, write “bansa: …” or “gotra: …” so the other side does not think you left the field half finished. The site will not auto-reject a match with the same gotra, and it will not auto-approve a different one. Elders decide. An empty gotra field does not hide your profile from search. A made-up gotra, written to look complete, is worse than a blank one — the other family will ask, and the conversation will start with a correction.',
      'Do not paste a list of gotra names you found on another website into your profile to look informed. Those lists are incomplete, they differ by region, and they are not the list this site uses, because this site does not have one. If an elder wants a particular gotra excluded, write that in partner preferences in a sentence: “We do not propose a match in our own gotra, which is …”. That is readable. A code in the Gotra field is not.',
      'The introduction itself belongs in About me and in the message you send with an interest. Say who is getting married, their age and work, the parents’ work, the city of the meeting, and whether a sibling is already married. Leave out the phone number if you have hidden contact details. Leave out money. A family introduction is not a negotiation about gifts, land or a payment, and a profile that opens with one is reported.',
      'Marriage customs are not the same in every Panika, Manikpuri, Kabirpanthi or Adivasi house. Some Kabirpanthi families want a simple ceremony in their own tradition. Other families follow the local Hindu rites their elders already use. Some regions have their own rules about remarriage, about who may propose, and about when the families meet. This website will not publish one custom as the custom of the whole community. If a custom matters to your decision, write it in plain words in partner preferences. If it does not, do not invent a strict rule to sound traditional.',
      'The first meeting is still the practical custom that protects people on this site. Meet with elders present. Meet in the city you wrote on the profile. Do not move the meeting to a private place because a profile asked you to. Do not send money for travel, a hall, a photograph or a “confirmation”. The contact page and WhatsApp support are there if a profile pressures you. Reporting it is free, and the public place pages never show the member’s name while that review happens.',
      'When the other family accepts an interest, messaging opens. Use it to introduce the parents, agree the city, and agree who is coming. Then meet. The website is the search. It is not the wedding, and it does not take a commission when two families decide to continue.'
    ]
  }
];

function assertConsistent() {
  const stateSlugs = new Set();
  const stateNames = new Set();
  for (const state of STATES) {
    if (!state.slug || stateSlugs.has(state.slug)) throw new Error(`Bad or duplicate state slug: ${state.slug}`);
    stateSlugs.add(state.slug);
    if (stateNames.has(state.name)) throw new Error(`Duplicate state name: ${state.name}`);
    stateNames.add(state.name);
    const citySlugs = new Set();
    const cityNames = new Set();
    for (const item of state.cities) {
      if (!item.slug || citySlugs.has(item.slug)) throw new Error(`Bad city slug in ${state.slug}: ${item.slug}`);
      citySlugs.add(item.slug);
      if (cityNames.has(item.name)) throw new Error(`Duplicate city ${item.name} in ${state.name}`);
      cityNames.add(item.name);
      if (item.page) {
        if (!item.note || item.note.length < 2) throw new Error(`City page ${state.slug}/${item.slug} needs its own note`);
        if (!item.summary) throw new Error(`City page ${state.slug}/${item.slug} needs a summary`);
      }
    }
    if (state.page && (!state.lead || state.lead.length < 2)) throw new Error(`State page ${state.slug} needs a lead`);
  }
  const communitySlugs = new Set();
  for (const item of COMMUNITIES) {
    if (communitySlugs.has(item.slug)) throw new Error(`Duplicate community ${item.slug}`);
    communitySlugs.add(item.slug);
    if (!item.paragraphs || item.paragraphs.join(' ').split(/\s+/).length < 250) {
      throw new Error(`Community page ${item.slug} is too thin`);
    }
  }
  const guideSlugs = new Set();
  for (const item of GUIDES) {
    if (guideSlugs.has(item.slug)) throw new Error(`Duplicate guide ${item.slug}`);
    guideSlugs.add(item.slug);
    if (item.paragraphs.join(' ').split(/\s+/).length < 400) throw new Error(`Guide ${item.slug} is too thin`);
  }
}

assertConsistent();

function dropdownTree() {
  return STATES.map((state) => ({
    name: state.name,
    slug: state.slug,
    cities: state.cities.map((item) => item.name)
  }));
}

function findState(slug) {
  return STATES.find((state) => state.slug === slug) || null;
}

function findCity(stateSlug, citySlug) {
  const state = findState(stateSlug);
  if (!state) return null;
  const found = state.cities.find((item) => item.slug === citySlug);
  return found ? { state, city: found } : null;
}

function findCommunity(slug) {
  return COMMUNITIES.find((item) => item.slug === slug) || null;
}

function findGuide(slug) {
  return GUIDES.find((item) => item.slug === slug) || null;
}

function pageCities(state) {
  return state.cities.filter((item) => item.page);
}

module.exports = {
  STATES,
  COMMUNITIES,
  GUIDES,
  STATE_ALIASES,
  CITY_ALIASES,
  dropdownTree,
  findState,
  findCity,
  findCommunity,
  findGuide,
  pageCities
};
