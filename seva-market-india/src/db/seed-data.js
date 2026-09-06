'use strict';
/**
 * SEVA MARKET INDIA — seed dataset.
 *
 * A representative slice of the India -> State -> District -> City ->
 * Locality -> PIN tree, plus the launch category catalogue. Deliberately
 * small and reviewable: the full PIN master (~1.5 lakh rows) is a data
 * import job, not source code.
 *
 * Every PIN below is a real Indian PIN code so the search demo behaves like
 * production rather than a toy.
 */

const categories = [
  {
    name: 'Home Repair & Maintenance', icon: '🔧', sortOrder: 1,
    children: [
      { name: 'Plumber', icon: '🚿', sortOrder: 1 },
      { name: 'Electrician', icon: '💡', sortOrder: 2 },
      { name: 'Carpenter', icon: '🪚', sortOrder: 3 },
      { name: 'Painter', icon: '🎨', sortOrder: 4 },
      { name: 'AC Repair & Service', icon: '❄️', sortOrder: 5 },
      { name: 'Appliance Repair', icon: '🧰', sortOrder: 6 },
      { name: 'TV, DTH & Antenna Repair', icon: '📺', sortOrder: 7 },
      { name: 'Mobile & Computer Repair', icon: '📱', sortOrder: 8 },
      { name: 'Home Renovation & Remodeling', icon: '🏗️', sortOrder: 9 },
      { name: 'Gardening & Landscaping', icon: '🌿', sortOrder: 10 },
      { name: 'CCTV Installation & Repair', icon: '🔒', sortOrder: 11 },
      { name: 'Locksmith & Key Maker', icon: '🔑', sortOrder: 12 },
      { name: 'Aluminium, Glass & UPVC Work', icon: '🪟', sortOrder: 13 },
      { name: 'Sofa & Upholstery Repair', icon: '🛠️', sortOrder: 14 },
      { name: 'Water Purifier / RO Service', icon: '🚰', sortOrder: 15 },
      { name: 'Inverter, Battery & UPS Service', icon: '🔋', sortOrder: 16 },
      { name: 'Printer & Scanner Repair', icon: '🖨️', sortOrder: 17 },
      { name: 'Wi-Fi, Networking & Internet Setup', icon: '📶', sortOrder: 18 },
      { name: 'Shoe & Leather Repair', icon: '👞', sortOrder: 19 },
      { name: 'Washing Machine Repair', icon: '🧺', sortOrder: 20 },
      { name: 'Microwave Oven Repair', icon: '📻', sortOrder: 21 },
      { name: 'Mixer Grinder Repair', icon: '⚙️', sortOrder: 22 },
      { name: 'Water Pump & Motor Repair', icon: '🚿', sortOrder: 23 },
      { name: 'Roofing & Waterproofing', icon: '🏠', sortOrder: 24 },
      { name: 'Tile, Marble & Granite Work', icon: '🧱', sortOrder: 25 },
      { name: 'POP & False Ceiling Work', icon: '🏗️', sortOrder: 26 },
      { name: 'Welding, Grill & Gate Work', icon: '🔧', sortOrder: 27 },
      { name: 'Solar Panel Installation & Repair', icon: '☀️', sortOrder: 28 },
      { name: 'Generator Service & Repair', icon: '🔌', sortOrder: 29 },
    ],
  },
  {
    name: 'Cleaning & Pest Control', icon: '🧽', sortOrder: 2,
    children: [
      { name: 'Home Deep Cleaning', icon: '🏠', sortOrder: 1 },
      { name: 'Pest Control', icon: '🐜', sortOrder: 2 },
      { name: 'Sofa & Carpet Cleaning', icon: '🛋️', sortOrder: 3 },
      { name: 'Housekeeping & Regular Cleaning', icon: '🧹', sortOrder: 4 },
      { name: 'Laundry & Ironing', icon: '👕', sortOrder: 5 },
      { name: 'Carpet, Mattress & Upholstery Cleaning', icon: '🛏️', sortOrder: 6 },
      { name: 'Water Tank Cleaning', icon: '🛢️', sortOrder: 7 },
      { name: 'Home Sanitization Service', icon: '🦠', sortOrder: 8 },
      { name: 'Maid & Domestic Help', icon: '🧹', sortOrder: 9 },
      { name: 'Cook & Home Chef', icon: '🍳', sortOrder: 10 },
    ],
  },
  {
    name: 'Education & Tutoring', icon: '📚', sortOrder: 3,
    children: [
      { name: 'Home Tutor', icon: '🧑‍🏫', sortOrder: 1 },
      { name: 'Competitive Exam Coaching', icon: '🎯', sortOrder: 2 },
      { name: 'Computer Training', icon: '💻', sortOrder: 3 },
    ],
  },
  {
    name: 'Health & Wellness', icon: '🩺', sortOrder: 4,
    children: [
      { name: 'Physiotherapist at Home', icon: '🧘', sortOrder: 1 },
      { name: 'Nurse at Home', icon: '⚕️', sortOrder: 2 },
      { name: 'Yoga Trainer', icon: '🕉️', sortOrder: 3 },
    ],
  },
  {
    name: 'Events & Photography', icon: '📸', sortOrder: 5,
    children: [
      { name: 'Wedding Photographer', icon: '📷', sortOrder: 1 },
      { name: 'Catering Services', icon: '🍛', sortOrder: 2 },
      { name: 'Tent & Decoration', icon: '🎪', sortOrder: 3 },
      { name: 'Photography & Videography', icon: '📹', sortOrder: 4 },
      { name: 'Wedding Planner & Marriage Services', icon: '💍', sortOrder: 5 },
      { name: 'DJ & Sound System', icon: '🎧', sortOrder: 6 },
    ],
  },
  {
    name: 'Vehicles & Transport', icon: '🚗', sortOrder: 6,
    children: [
      { name: 'Car Mechanic', icon: '🔩', sortOrder: 1 },
      { name: 'Two-Wheeler Repair', icon: '🛵', sortOrder: 2 },
      { name: 'Taxi & Rental', icon: '🚕', sortOrder: 3 },
      { name: 'Driver on Hire', icon: '🧑‍✈️', sortOrder: 4 },
      { name: 'Packers & Movers', icon: '🚚', sortOrder: 5 },
      { name: 'Local Delivery & Courier Service', icon: '📦', sortOrder: 6 },
      { name: 'Towing & Roadside Assistance', icon: '🛻', sortOrder: 7 },
    ],
  },
  {
    name: 'Beauty & Personal Care', icon: '💇', sortOrder: 7,
    children: [
      { name: 'Salon at Home', icon: '💅', sortOrder: 1 },
      { name: 'Bridal Makeup', icon: '👰', sortOrder: 2 },
      { name: 'Makeup Artist', icon: '💄', sortOrder: 3 },
      { name: 'Tailor & Boutique Service', icon: '🧵', sortOrder: 4 },
      { name: 'Bridal Makeup Artist', icon: '👰‍♀️', sortOrder: 5 },
      { name: 'Groom Makeup Artist', icon: '🤵', sortOrder: 6 },
      { name: 'Party Makeup Artist', icon: '🎉', sortOrder: 7 },
      { name: 'Engagement Makeup Artist', icon: '💍', sortOrder: 8 },
      { name: 'Reception Makeup Artist', icon: '🥂', sortOrder: 9 },
      { name: 'Wedding Makeup Artist', icon: '💒', sortOrder: 10 },
      { name: 'Traditional Makeup Artist', icon: '🪔', sortOrder: 11 },
      { name: 'HD Makeup Artist', icon: '🎥', sortOrder: 12 },
      { name: 'Airbrush Makeup Artist', icon: '🎨', sortOrder: 13 },
      { name: 'Natural Makeup Artist', icon: '🌿', sortOrder: 14 },
      { name: 'Professional Makeup Artist', icon: '💼', sortOrder: 15 },
      { name: 'Celebrity Makeup Artist', icon: '⭐', sortOrder: 16 },
      { name: 'Fashion Makeup Artist', icon: '👗', sortOrder: 17 },
      { name: 'Photoshoot Makeup Artist', icon: '📸', sortOrder: 18 },
      { name: 'Saree Draping Service', icon: '🥻', sortOrder: 19 },
      { name: 'Bridal Dressing Service', icon: '👰', sortOrder: 20 },
      { name: 'Makeup Trial Service', icon: '🪞', sortOrder: 21 },
      { name: 'Hair Styling & Makeup', icon: '💇‍♀️', sortOrder: 22 },
      { name: 'Home Makeup Service', icon: '🏠', sortOrder: 23 },
    ],
  },
  {
    name: 'Professional Services', icon: '💼', sortOrder: 8,
    children: [
      { name: 'CA & Tax Filing', icon: '🧾', sortOrder: 1 },
      { name: 'Legal Consultant', icon: '⚖️', sortOrder: 2 },
      { name: 'Interior Designer', icon: '📐', sortOrder: 3 },
      { name: 'Website & App Developer', icon: '🌐', sortOrder: 4 },
      { name: 'Video Editing & YouTube Services', icon: '🎬', sortOrder: 5 },
      { name: 'Graphic Design & Thumbnail Design', icon: '🎨', sortOrder: 6 },
      { name: 'Digital Marketing & Social Media Management', icon: '📣', sortOrder: 7 },
      { name: 'Security Guard Service', icon: '🛡️', sortOrder: 8 },
      { name: 'Labour & Helper Service', icon: '🧑‍🔧', sortOrder: 9 },
    ],
  },
  {
    name: 'Pets & Animals', icon: '🐾', sortOrder: 9,
    children: [
      { name: 'Pet Care & Grooming', icon: '🐶', sortOrder: 1 },
    ],
  },
  {
    name: 'Agriculture & Farming', icon: '🌾', sortOrder: 10,
    children: [
      { name: 'Agriculture, Farm Labour & Tractor Service', icon: '🚜', sortOrder: 1 },
      { name: 'Borewell Service', icon: '⛏️', sortOrder: 2 },
    ],
  },
];

/**
 * state -> districts -> cities -> localities (with PIN codes).
 * Coordinates are approximate city centroids, enough for future map work.
 */
const geography = [
  {
    state: 'Assam', code: 'AS',
    districts: [
      {
        district: 'Kamrup Metropolitan',
        cities: [
          {
            city: 'Guwahati', latitude: 26.1445, longitude: 91.7362,
            localities: [
              { name: 'Uzan Bazar', pin: '781001' },
              { name: 'Dispur', pin: '781006' },
              { name: 'Jalukbari', pin: '781014' },
              { name: 'Basistha', pin: '781028' },
            ],
          },
        ],
      },
      {
        district: 'Kamrup',
        cities: [{ city: 'Hajo', latitude: 26.2414, longitude: 91.5294, localities: [{ name: 'Hajo Town', pin: '781102' }] }],
      },
      {
        district: 'Dibrugarh',
        cities: [{ city: 'Dibrugarh', latitude: 27.4728, longitude: 94.9120, localities: [{ name: 'Graham Bazar', pin: '786001' }] }],
      },
    ],
  },
  {
    state: 'Maharashtra', code: 'MH',
    districts: [
      {
        district: 'Mumbai Suburban',
        cities: [
          {
            city: 'Mumbai', latitude: 19.0760, longitude: 72.8777,
            localities: [
              { name: 'Andheri East', pin: '400069' },
              { name: 'Bandra West', pin: '400050' },
              { name: 'Borivali West', pin: '400092' },
            ],
          },
        ],
      },
      {
        district: 'Pune',
        cities: [
          {
            city: 'Pune', latitude: 18.5204, longitude: 73.8567,
            localities: [
              { name: 'Kothrud', pin: '411038' },
              { name: 'Hinjewadi', pin: '411057' },
              { name: 'Kharadi', pin: '411014' },
            ],
          },
        ],
      },
      {
        district: 'Nagpur',
        cities: [{ city: 'Nagpur', latitude: 21.1458, longitude: 79.0882, localities: [{ name: 'Dharampeth', pin: '440010' }] }],
      },
    ],
  },
  {
    state: 'Karnataka', code: 'KA',
    districts: [
      {
        district: 'Bengaluru Urban',
        cities: [
          {
            city: 'Bengaluru', latitude: 12.9716, longitude: 77.5946,
            localities: [
              { name: 'Indiranagar', pin: '560038' },
              { name: 'Koramangala', pin: '560034' },
              { name: 'Jayanagar', pin: '560041' },
              { name: 'Whitefield', pin: '560066' },
            ],
          },
        ],
      },
      {
        district: 'Mysuru',
        cities: [{ city: 'Mysuru', latitude: 12.2958, longitude: 76.6394, localities: [{ name: 'Vijayanagar', pin: '570017' }] }],
      },
    ],
  },
  {
    state: 'Tamil Nadu', code: 'TN',
    districts: [
      {
        district: 'Chennai',
        cities: [
          {
            city: 'Chennai', latitude: 13.0827, longitude: 80.2707,
            localities: [
              { name: 'T. Nagar', pin: '600017' },
              { name: 'Adyar', pin: '600020' },
              { name: 'Velachery', pin: '600042' },
            ],
          },
        ],
      },
      {
        district: 'Coimbatore',
        cities: [{ city: 'Coimbatore', latitude: 11.0168, longitude: 76.9558, localities: [{ name: 'RS Puram', pin: '641002' }] }],
      },
    ],
  },
  {
    state: 'Delhi', code: 'DL',
    districts: [
      {
        district: 'New Delhi',
        cities: [
          {
            city: 'New Delhi', latitude: 28.6139, longitude: 77.2090,
            localities: [
              { name: 'Connaught Place', pin: '110001' },
              { name: 'Lajpat Nagar', pin: '110024' },
            ],
          },
        ],
      },
      {
        district: 'South West Delhi',
        cities: [{ city: 'Dwarka', latitude: 28.5921, longitude: 77.0460, localities: [{ name: 'Dwarka Sector 6', pin: '110075' }] }],
      },
    ],
  },
  {
    state: 'Uttar Pradesh', code: 'UP',
    districts: [
      {
        district: 'Lucknow',
        cities: [
          {
            city: 'Lucknow', latitude: 26.8467, longitude: 80.9462,
            localities: [
              { name: 'Hazratganj', pin: '226001' },
              { name: 'Gomti Nagar', pin: '226010' },
            ],
          },
        ],
      },
      {
        district: 'Gautam Buddha Nagar',
        cities: [{ city: 'Noida', latitude: 28.5355, longitude: 77.3910, localities: [{ name: 'Sector 18', pin: '201301' }] }],
      },
    ],
  },
  {
    state: 'West Bengal', code: 'WB',
    districts: [
      {
        district: 'Kolkata',
        cities: [
          {
            city: 'Kolkata', latitude: 22.5726, longitude: 88.3639,
            localities: [
              { name: 'Park Street', pin: '700016' },
              { name: 'Salt Lake City', pin: '700064' },
            ],
          },
        ],
      },
    ],
  },
  {
    state: 'Rajasthan', code: 'RJ',
    districts: [
      {
        district: 'Jaipur',
        cities: [
          {
            city: 'Jaipur', latitude: 26.9124, longitude: 75.7873,
            localities: [
              { name: 'Malviya Nagar', pin: '302017' },
              { name: 'Vaishali Nagar', pin: '302021' },
            ],
          },
        ],
      },
    ],
  },
];

/**
 * Launch listings: [categorySlug, localityPin, business, phone, services].
 * Phone numbers use the 90000xxxxx demo range on purpose — never seed real
 * subscriber numbers into a public repository.
 */
const providers = [
  {
    category: 'plumber', pin: '781001', business: 'Borah Plumbing Works', contact: 'Nayan Borah',
    phone: '9000000001', experience: 12, verified: true, rating: 4.7, ratingCount: 63,
    about: 'Leak repair, bathroom fittings and motor installation across Guwahati. Same-day response for emergencies.',
    areas: ['781001', '781006', '781014'],
    services: [
      { title: 'Bathroom tap & shower repair', min: 299, max: 699, unit: 'visit', status: 'active' },
      { title: 'Water motor installation', min: 1200, max: 2500, unit: 'job', status: 'active' },
    ],
  },
  {
    category: 'electrician', pin: '781006', business: 'Dispur Electric Care', contact: 'Pranab Deka',
    phone: '9000000002', experience: 9, verified: true, rating: 4.6, ratingCount: 41,
    about: 'Wiring, fan and inverter work for homes and small offices. ISI-grade materials only.',
    areas: ['781006', '781028'],
    services: [
      { title: 'House wiring fault diagnosis', min: 400, max: 900, unit: 'visit', status: 'active' },
      { title: 'Inverter & battery setup', min: 800, max: 1500, unit: 'job', status: 'active' },
    ],
  },
  {
    category: 'plumber', pin: '560038', business: 'Namma Pipe Solutions', contact: 'Ravi Kumar',
    phone: '9000000003', experience: 7, verified: false, rating: 4.3, ratingCount: 28,
    about: 'Residential plumbing across east Bengaluru, including CPVC re-piping.',
    areas: ['560038', '560066'],
    services: [{ title: 'Kitchen sink leakage repair', min: 350, max: 800, unit: 'visit', status: 'active' }],
  },
  {
    category: 'electrician', pin: '400069', business: 'Andheri Electricians Hub', contact: 'Salim Shaikh',
    phone: '9000000004', experience: 15, verified: true, rating: 4.8, ratingCount: 112,
    about: '24x7 electrical emergency service for Andheri East and MIDC.',
    areas: ['400069', '400050'],
    services: [
      { title: 'Emergency power failure visit', min: 500, max: 500, unit: 'visit', status: 'active' },
      { title: 'MCB & distribution board upgrade', min: 1500, max: 4000, unit: 'job', status: 'active' },
    ],
  },
  {
    category: 'home-tutor', pin: '411038', business: 'Shiksha Home Tutors', contact: 'Anjali Deshpande',
    phone: '9000000005', experience: 11, verified: true, rating: 4.9, ratingCount: 87,
    about: 'Class 8-12 Maths and Science tutors, verified background checks, demo class free.',
    areas: ['411038', '411057', '411014'],
    services: [{ title: 'Class 10 Maths home tuition', min: 3000, max: 5000, unit: 'month', status: 'active' }],
  },
  {
    category: 'home-deep-cleaning', pin: '600017', business: 'Chennai Sparkle Services', contact: 'Karthik Raja',
    phone: '9000000006', experience: 6, verified: false, rating: 4.2, ratingCount: 19,
    about: 'Full-home deep cleaning with a four-member trained team.',
    areas: ['600017', '600020', '600042'],
    services: [{ title: '2BHK full home deep cleaning', min: 3500, max: 4500, unit: 'job', status: 'active' }],
  },
  {
    category: 'ac-repair-service', pin: '110024', business: 'Cool Care Delhi', contact: 'Mohit Verma',
    phone: '9000000007', experience: 10, verified: true, rating: 4.5, ratingCount: 74,
    about: 'Split & window AC service, gas top-up and installation across south Delhi.',
    areas: ['110024', '110075', '110001'],
    services: [
      { title: 'Split AC jet service', min: 599, max: 899, unit: 'visit', status: 'active' },
      { title: 'AC gas refilling', min: 2200, max: 3500, unit: 'job', status: 'active' },
    ],
  },
  {
    category: 'car-mechanic', pin: '700064', business: 'Salt Lake Auto Garage', contact: 'Debashis Ghosh',
    phone: '9000000008', experience: 18, verified: true, rating: 4.4, ratingCount: 56,
    about: 'Doorstep car service and breakdown assistance in Salt Lake and New Town.',
    areas: ['700064', '700016'],
    services: [{ title: 'Doorstep general car service', min: 2500, max: 5500, unit: 'visit', status: 'active' }],
  },
  {
    category: 'wedding-photographer', pin: '302017', business: 'Vivah Frames Studio', contact: 'Neha Agarwal',
    phone: '9000000009', experience: 8, verified: false, rating: 4.6, ratingCount: 33,
    about: 'Candid wedding photography and cinematography across Rajasthan.',
    areas: ['302017', '302021'],
    services: [{ title: 'Full-day candid wedding coverage', min: 45000, max: 85000, unit: 'day', status: 'active' }],
  },
  {
    category: 'ca-tax-filing', pin: '226001', business: 'Sharma & Associates CA', contact: 'CA Rahul Sharma',
    phone: '9000000010', experience: 14, verified: true, rating: 4.8, ratingCount: 48,
    about: 'ITR filing, GST registration and small-business bookkeeping.',
    areas: ['226001', '226010', '201301'],
    services: [{ title: 'Individual ITR filing', min: 1000, max: 2500, unit: 'job', status: 'active' }],
  },
];

module.exports = { categories, geography, providers };
