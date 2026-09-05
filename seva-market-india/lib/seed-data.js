'use strict';
/**
 * SEVA MARKET INDIA — reference + demo data.
 *
 * Everything here is public catalogue/demo content. No real personal data,
 * no phone numbers of real people, no credentials in the repository: the
 * demo passwords are set through the environment or written to the private
 * data/ folder on first boot.
 */

const CITIES = [
  { name: 'Delhi', state: 'Delhi' },
  { name: 'Mumbai', state: 'Maharashtra' },
  { name: 'Bengaluru', state: 'Karnataka' },
  { name: 'Hyderabad', state: 'Telangana' },
  { name: 'Chennai', state: 'Tamil Nadu' },
  { name: 'Pune', state: 'Maharashtra' },
  { name: 'Kolkata', state: 'West Bengal' },
  { name: 'Ahmedabad', state: 'Gujarat' },
  { name: 'Jaipur', state: 'Rajasthan' },
  { name: 'Lucknow', state: 'Uttar Pradesh' },
  { name: 'Bhopal', state: 'Madhya Pradesh' },
  { name: 'Raipur', state: 'Chhattisgarh' }
];

const CATEGORIES = [
  { slug: 'plumbing', name: 'Plumbing', tagline: 'Leaks, taps, drains, water tanks', base_price: 299, popular: 1 },
  { slug: 'electrical', name: 'Electrical & Wiring', tagline: 'Switches, fans, inverter, short circuits', base_price: 299, popular: 1 },
  { slug: 'ac-repair', name: 'AC & Refrigerator', tagline: 'Servicing, gas refill, cooling issues', base_price: 499, popular: 1 },
  { slug: 'cleaning', name: 'Home Deep Cleaning', tagline: 'Full home, kitchen, bathroom, sofa', base_price: 999, popular: 1 },
  { slug: 'pest-control', name: 'Pest Control', tagline: 'Cockroach, termite, bed bugs, mosquitoes', base_price: 899, popular: 0 },
  { slug: 'carpentry', name: 'Carpentry & Furniture', tagline: 'Repair, assembly, modular fittings', base_price: 399, popular: 1 },
  { slug: 'painting', name: 'Painting & Waterproofing', tagline: 'Interior, exterior, texture, damp proof', base_price: 1499, popular: 0 },
  { slug: 'salon-at-home', name: 'Salon at Home', tagline: 'Hair, facial, manicure, bridal package', base_price: 599, popular: 1 },
  { slug: 'appliance', name: 'Appliance Repair', tagline: 'Washing machine, microwave, RO, geyser', base_price: 399, popular: 0 },
  { slug: 'packers-movers', name: 'Packers & Movers', tagline: 'Home shifting, packing, loading', base_price: 2499, popular: 0 },
  { slug: 'tutoring', name: 'Home Tutors', tagline: 'Class 1–12, maths, science, English', base_price: 599, popular: 1 },
  { slug: 'vehicle-service', name: 'Car & Bike Service', tagline: 'Doorstep service, battery, breakdown', base_price: 699, popular: 0 }
];

const SERVICES = {
  plumbing: [
    ['Tap & faucet repair', 249, 45],
    ['Pipe leakage fixing', 349, 60],
    ['Drain / blocked sink clearing', 499, 60],
    ['Water tank cleaning', 699, 90]
  ],
  electrical: [
    ['Switch & socket replacement', 199, 30],
    ['Fan installation', 299, 45],
    ['Inverter & wiring check', 599, 90],
    ['Full home wiring inspection', 899, 120]
  ],
  'ac-repair': [
    ['AC service (split)', 599, 60],
    ['AC gas refill', 1499, 90],
    ['AC installation', 1299, 120],
    ['Refrigerator repair', 499, 60]
  ],
  cleaning: [
    ['1 BHK deep cleaning', 2499, 180],
    ['2 BHK deep cleaning', 3499, 240],
    ['Bathroom deep cleaning', 899, 90],
    ['Sofa & carpet shampooing', 1299, 120]
  ],
  'pest-control': [
    ['Cockroach control (1 BHK)', 899, 60],
    ['Bed bug treatment', 1499, 90],
    ['Termite treatment', 2499, 120],
    ['Mosquito fogging', 799, 45]
  ],
  carpentry: [
    ['Furniture repair', 399, 60],
    ['Modular wardrobe fitting', 899, 120],
    ['Door / window repair', 499, 60],
    ['Custom shelf making', 1299, 180]
  ],
  painting: [
    ['1 room repainting', 1499, 240],
    ['Full 2 BHK painting', 8999, 480],
    ['Waterproofing (terrace)', 3499, 240],
    ['Texture & wallpaper', 2499, 180]
  ],
  'salon-at-home': [
    ['Hair cut & styling', 499, 45],
    ['Facial & clean-up', 899, 60],
    ['Manicure & pedicure', 799, 60],
    ['Bridal package', 5999, 240]
  ],
  appliance: [
    ['Washing machine repair', 499, 60],
    ['RO water purifier service', 399, 45],
    ['Geyser repair', 449, 60],
    ['Microwave repair', 499, 60]
  ],
  'packers-movers': [
    ['1 BHK local shifting', 3499, 240],
    ['2 BHK local shifting', 5999, 360],
    ['Packing only', 1999, 120],
    ['Bike transport (local)', 1499, 90]
  ],
  tutoring: [
    ['Class 1–5 all subjects', 499, 60],
    ['Class 6–10 maths & science', 699, 60],
    ['Class 11–12 physics / maths', 999, 90],
    ['Spoken English coaching', 599, 60]
  ],
  'vehicle-service': [
    ['Car doorstep service', 1499, 120],
    ['Bike doorstep service', 699, 60],
    ['Battery replacement', 999, 45],
    ['Breakdown assistance', 799, 60]
  ]
};

/**
 * [business name, city, area, category slug, years of experience, headline, verified]
 */
const PROVIDERS = [
  ['Sharma Plumbing Works', 'Delhi', 'Rohini', 'plumbing', 12, 'Leak-proof plumbing with a 90-day work guarantee.', 1],
  ['Nayak Electricals & Repairs', 'Delhi', 'Dwarka', 'electrical', 9, 'Licensed electrician for homes and small offices.', 1],
  ['Cool Breeze AC Care', 'Mumbai', 'Andheri West', 'ac-repair', 11, 'Same-day AC service by factory-trained technicians.', 1],
  ['Sparkle Home Cleaning', 'Mumbai', 'Powai', 'cleaning', 6, 'Professional deep cleaning with eco-safe chemicals.', 1],
  ['Kumar Pest Shield', 'Bengaluru', 'Whitefield', 'pest-control', 14, 'Odourless, child-safe pest treatment for apartments.', 1],
  ['Sai Woodcraft Carpenters', 'Bengaluru', 'Jayanagar', 'carpentry', 15, 'Furniture repair and modular fittings done on site.', 1],
  ['Rangoli Paint Studio', 'Hyderabad', 'Gachibowli', 'painting', 10, 'Clean painting with branded paints and full covering.', 1],
  ['Glow Salon at Home', 'Hyderabad', 'Madhapur', 'salon-at-home', 7, 'Certified stylists at your doorstep, hygiene first.', 1],
  ['Fixit Appliance Clinic', 'Chennai', 'Velachery', 'appliance', 13, 'Genuine spare parts with 3-month service warranty.', 1],
  ['SafeShift Packers', 'Chennai', 'Tambaram', 'packers-movers', 8, 'Insured, on-time shifting with trained packing crew.', 1],
  ['Vidya Home Tutors', 'Pune', 'Kothrud', 'tutoring', 9, 'Verified tutors with weekly progress reports.', 1],
  ['WheelCare Doorstep Service', 'Pune', 'Hinjewadi', 'vehicle-service', 6, 'Pickup, service and drop with digital job card.', 1],
  ['Ganga Plumbing Solutions', 'Kolkata', 'Salt Lake', 'plumbing', 10, 'Emergency plumber — we answer calls till 11 pm.', 0],
  ['Bijli Electric Works', 'Kolkata', 'Howrah', 'electrical', 7, 'Fault finding and rewiring for old buildings.', 1],
  ['Frostline Refrigeration', 'Ahmedabad', 'Satellite', 'ac-repair', 12, 'Fridge and AC repair with transparent pricing.', 1],
  ['Shuddh Deep Clean', 'Ahmedabad', 'Vastrapur', 'cleaning', 5, 'Trained cleaning crew, sanitised equipment every day.', 1],
  ['Pink City Painters', 'Jaipur', 'Malviya Nagar', 'painting', 11, 'Interior and exterior painting, waterproofing experts.', 1],
  ['Aarogya Pest Free', 'Jaipur', 'Vaishali Nagar', 'pest-control', 8, 'Herbal and chemical treatments, AMC available.', 0],
  ['Lucknow Wood Works', 'Lucknow', 'Gomti Nagar', 'carpentry', 16, 'Handcrafted repairs, polish and hinge replacement.', 1],
  ['Prerna Home Tutors', 'Lucknow', 'Aliganj', 'tutoring', 6, 'Patient tutors for CBSE, ICSE and state boards.', 1],
  ['Capital Appliance Doctors', 'Bhopal', 'Arera Colony', 'appliance', 9, 'All brands, all appliances — one visit diagnosis.', 1],
  ['City Movers Bhopal', 'Bhopal', 'MP Nagar', 'packers-movers', 7, 'Local and intercity shifting with packing material.', 0],
  ['Raipur Cool Care', 'Raipur', 'Shankar Nagar', 'ac-repair', 8, 'AC installation, service and AMC for homes.', 1],
  ['Maa Shakti Cleaning Services', 'Raipur', 'Telibandha', 'cleaning', 4, 'Society and office cleaning contracts available.', 1],
  ['Delhi NCR Salon Studio', 'Delhi', 'Saket', 'salon-at-home', 8, 'Bridal and party makeup at home across Delhi NCR.', 1],
  ['Metro Bike & Car Care', 'Mumbai', 'Thane West', 'vehicle-service', 10, 'Doorstep two-wheeler and four-wheeler servicing.', 1],
  ['Namma Tutor Bureau', 'Bengaluru', 'Koramangala', 'tutoring', 7, 'Background-verified tutors for all boards.', 1],
  ['Deccan Electricians', 'Hyderabad', 'Kukatpally', 'electrical', 9, '24x7 emergency electrician with proper tools.', 1]
];

const REVIEWERS = [
  ['Anjali Verma', 5, 'On time, polite and cleaned up after the work. Very professional.'],
  ['Rohit Sharma', 5, 'Fair pricing and explained the problem clearly. Highly recommended.'],
  ['Meera Iyer', 4, 'Good work quality. Reached 20 minutes late but informed me in advance.'],
  ['Imran Qureshi', 5, 'Second time booking. Same technician, same quality. Trustworthy.'],
  ['Sunita Devi', 4, 'Work was neat. I would like faster response on WhatsApp next time.'],
  ['Arjun Nair', 5, 'Excellent service. The issue was fixed within an hour of arrival.'],
  ['Priya Singh', 5, 'Very happy with the finishing. Worth every rupee.'],
  ['Kabir Das', 3, 'Work was fine but the final bill had an extra visit charge.'],
  ['Neha Kulkarni', 5, 'Booked for my parents — they were very comfortable with the team.'],
  ['Farhan Sheikh', 4, 'Skilled professional, carried all tools and spare parts.']
];

const SLOTS = ['Morning (9 am – 12 pm)', 'Afternoon (12 pm – 3 pm)', 'Evening (3 pm – 6 pm)', 'Late evening (6 pm – 9 pm)'];

const TRUST_POINTS = [
  ['Verified professionals', 'ID and address checks before a provider goes live on the platform.'],
  ['Upfront pricing', 'See the service price before you book. No surprise charges at the door.'],
  ['Work guarantee', 'Every completed booking carries a 30-day rework guarantee.'],
  ['Secure payments', 'Pay after the work is done — cash or UPI, straight to the professional.']
];

const STEPS = [
  ['1', 'Choose a service', 'Pick from 12 categories covering every home and family need.'],
  ['2', 'Compare & book', 'Check real ratings, transparent prices and pick a time slot.'],
  ['3', 'Work gets done', 'The professional arrives, completes the job and shares the bill.'],
  ['4', 'Rate the service', 'Your review keeps quality high for the next customer.']
];

module.exports = { CITIES, CATEGORIES, SERVICES, PROVIDERS, REVIEWERS, SLOTS, TRUST_POINTS, STEPS };
