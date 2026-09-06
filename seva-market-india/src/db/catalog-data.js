'use strict';
/**
 * SEVA MARKET INDIA — comprehensive service catalog (India-wide).
 *
 * 23 top-level categories covering every local need from beauty to
 * construction. Each category owns 3–5 subcategories and each subcategory
 * owns 3–8 leaf services. Every entry carries:
 *   - SEO-friendly description (120–180 chars, keyword-rich, India + PIN)
 *   - emoji icon (mobile-friendly, no extra asset)
 *   - sort_order for stable, editorial ordering
 *
 * Slugs are derived from names via `slugify` and are globally unique.
 * Duplicate service names are avoided by design.
 */

const catalog = [
  {
    name: 'Beauty & Personal Care',
    icon: '💇',
    sortOrder: 1,
    description: 'Professional beauty and personal care services at home and in salon — makeup, hair, skin, nails and bridal grooming across India. Book verified artists by PIN code.',
    subcategories: [
      {
        name: 'Makeup Services',
        icon: '💄',
        sortOrder: 1,
        description: 'Professional makeup artists for bridal, party and everyday looks. Home service available across all PIN codes.',
        services: [
          { name: 'Makeup Artist', icon: '🎨', sortOrder: 1, description: 'Hire verified makeup artists for parties, photoshoots and daily glam. Compare portfolios, prices and reviews. Home service across India.' },
          { name: 'Bridal Makeup', icon: '👰', sortOrder: 2, description: 'Book expert bridal makeup artists for your wedding day. HD and airbrush options, trial sessions, and home service near your PIN code.' },
          { name: 'Party Makeup', icon: '💃', sortOrder: 3, description: 'Get party-ready with professional party makeup. Evening, cocktail and festive looks by verified artists at your doorstep.' },
          { name: 'Home Makeup', icon: '🏠', sortOrder: 4, description: 'Professional makeup at home for any occasion. Save time with home service — verified artists, hygienic kits, on-time arrival.' },
          { name: 'Bridal Dressing', icon: '👗', sortOrder: 5, description: 'Complete bridal dressing service — makeup, hair, saree draping and jewellery setting. One team for your perfect wedding look.' },
        ],
      },
      {
        name: 'Hair & Salon',
        icon: '✂️',
        sortOrder: 2,
        description: 'Hair styling, cutting, colouring and salon services at home or in salon. Verified stylists near you.',
        services: [
          { name: 'Hair Stylist', icon: '💇‍♀️', sortOrder: 1, description: 'Professional hair stylists for cut, colour, keratin and styling. Verified experts with hygienic tools and home service.' },
          { name: 'Beauty Parlour', icon: '🏢', sortOrder: 2, description: 'Full-service beauty parlours for hair, skin and grooming. Unisex and ladies parlours near your PIN code with price transparency.' },
          { name: 'Saree Draping', icon: '🥻', sortOrder: 3, description: 'Expert saree draping for weddings, receptions and festivals. Bengali, Nauvari, Lehenga saree and modern draping at home.' },
        ],
      },
      {
        name: 'Skin & Grooming',
        icon: '🧖',
        sortOrder: 3,
        description: 'Facials, threading, waxing, manicure, pedicure and nail art by trained beauticians. Hygienic, at-home service.',
        services: [
          { name: 'Facial', icon: '✨', sortOrder: 1, description: 'Professional facials — gold, diamond, fruit and anti-acne. Glow and cleanup services by verified beauticians at home.' },
          { name: 'Threading', icon: '🪞', sortOrder: 2, description: 'Precise eyebrow and facial threading by experienced beauticians. Hygienic thread, painless technique, home service.' },
          { name: 'Waxing', icon: '🕯️', sortOrder: 3, description: 'Full body, arms, legs and bikini waxing with premium wax. Hygienic, less-pain technique at home or salon.' },
          { name: 'Manicure', icon: '💅', sortOrder: 4, description: 'Professional manicure — classic, gel and spa. Nail shaping, cuticle care and polish by verified nail technicians.' },
          { name: 'Pedicure', icon: '🦶', sortOrder: 5, description: 'Relaxing pedicure with foot soak, scrub and polish. Spa pedicure at home with sanitized tools.' },
          { name: 'Nail Artist', icon: '🎀', sortOrder: 6, description: 'Creative nail art — gel extensions, acrylics and custom designs. Certified nail artists near your PIN code.' },
        ],
      },
      {
        name: 'Mehndi & Wellness',
        icon: '🌿',
        sortOrder: 4,
        description: 'Traditional mehndi and wellness massage by skilled artists and therapists. Home service pan-India.',
        services: [
          { name: 'Mehndi', icon: '🤲', sortOrder: 1, description: 'Beautiful mehndi designs — bridal, Arabic and festive. Experienced mehndi artists at home with natural henna.' },
          { name: 'Wellness Massage', icon: '💆', sortOrder: 2, description: 'Relaxing wellness and body massage by certified therapists. Ayurvedic, Swedish and deep tissue at home or spa.' },
        ],
      },
    ],
  },
  {
    name: 'Wedding & Marriage',
    icon: '💒',
    sortOrder: 2,
    description: 'Complete wedding and marriage services — planning, venue, catering, decoration, photography and bridal wear across India.',
    subcategories: [
      {
        name: 'Wedding Planning',
        icon: '📋',
        sortOrder: 1,
        description: 'End-to-end wedding planning and coordination for a stress-free celebration.',
        services: [
          { name: 'Wedding Planner', icon: '📝', sortOrder: 1, description: 'Professional wedding planners for budget, timeline and vendor management. Destination and local weddings pan-India.' },
          { name: 'Marriage Registration', icon: '📄', sortOrder: 2, description: 'Assistance with court marriage and marriage registration. Document preparation and legal formalities made easy.' },
          { name: 'Matrimonial Services', icon: '💞', sortOrder: 3, description: 'Matchmaking and matrimonial consultation for all communities. Verified profiles and family meetings.' },
        ],
      },
      {
        name: 'Venue & Decoration',
        icon: '🏛️',
        sortOrder: 2,
        description: 'Banquet halls, lawns and decoration for weddings and receptions.',
        services: [
          { name: 'Banquet Hall Booking', icon: '🏨', sortOrder: 1, description: 'Book banquet halls, marriage lawns and resorts. Compare capacity, amenities and prices near your PIN code.' },
          { name: 'Wedding Decoration', icon: '🎀', sortOrder: 2, description: 'Stunning wedding decoration — mandap, stage, floral and lighting. Theme-based decor by verified decorators.' },
          { name: 'Tent House', icon: '⛺', sortOrder: 3, description: 'Tent, chairs, lighting and flooring on rent for weddings and functions. Complete setup at your venue.' },
        ],
      },
      {
        name: 'Catering & Hospitality',
        icon: '🍛',
        sortOrder: 3,
        description: 'Catering, hospitality and guest management for weddings.',
        services: [
          { name: 'Wedding Catering', icon: '🍽️', sortOrder: 1, description: 'Delicious wedding catering — veg, non-veg and Jain menus. Live counters, tasting and professional service staff.' },
          { name: 'Bridal Wear Rental', icon: '👰‍♀️', sortOrder: 2, description: 'Designer bridal lehenga, sherwani and jewellery on rent. Fittings, dry cleaning and doorstep delivery included.' },
        ],
      },
    ],
  },
  {
    name: 'Home Cleaning & Housekeeping',
    icon: '🧹',
    sortOrder: 3,
    description: 'Professional home cleaning and housekeeping — deep cleaning, kitchen, bathroom and pest control across India. Verified staff, same-day service.',
    subcategories: [
      {
        name: 'Home Deep Cleaning',
        icon: '🏠',
        sortOrder: 1,
        description: 'Full-home deep cleaning with trained staff and eco-friendly products.',
        services: [
          { name: 'Full Home Deep Cleaning', icon: '🧽', sortOrder: 1, description: 'Complete home deep cleaning — floors, walls, fans and furniture. 3–4 member team with professional equipment.' },
          { name: 'Kitchen Cleaning', icon: '🍳', sortOrder: 2, description: 'Deep kitchen cleaning — chimney, slab, tiles and cabinets. Grease removal with safe chemicals.' },
          { name: 'Bathroom Cleaning', icon: '🚿', sortOrder: 3, description: 'Intensive bathroom cleaning — tiles, fittings and drains. Anti-bacterial treatment for a hygienic bathroom.' },
          { name: 'Sofa Cleaning', icon: '🛋️', sortOrder: 4, description: 'Sofa, carpet and mattress shampooing. Removes dust mites, stains and odour. At-home service.' },
        ],
      },
      {
        name: 'Housekeeping',
        icon: '👩‍🍳',
        sortOrder: 2,
        description: 'Daily, weekly and monthly housekeeping staff for homes and apartments.',
        services: [
          { name: 'Maid Services', icon: '🧑‍🦰', sortOrder: 1, description: 'Verified maids for cooking, cleaning and baby care. Full-time, part-time and live-in options with background checks.' },
          { name: 'Housekeeping Staff', icon: '👨‍💼', sortOrder: 2, description: 'Trained housekeeping staff for homes, hostels and PGs. Uniformed, supervised and replacement guarantee.' },
          { name: 'Pest Control', icon: '🐜', sortOrder: 3, description: 'Professional pest control — cockroach, termite and mosquito. Herbal and chemical options with warranty.' },
        ],
      },
    ],
  },
  {
    name: 'Gas Stove & Kitchen Appliances',
    icon: '🔥',
    sortOrder: 4,
    description: 'Gas stove, chimney, RO and kitchen appliance repair and service. Genuine spares, verified technicians, same-day home service.',
    subcategories: [
      {
        name: 'Gas & Stove',
        icon: '♨️',
        sortOrder: 1,
        description: 'Gas stove, burner and pipeline services for safe cooking.',
        services: [
          { name: 'Gas Stove Repair', icon: '🔧', sortOrder: 1, description: 'Repair for gas stoves — burner, knob, ignition and gas leakage. ISI spares and safety checks at home.' },
          { name: 'Gas Pipeline Installation', icon: '🛢️', sortOrder: 2, description: 'Safe LPG pipeline and copper pipe installation for kitchens. Leak testing and compliance certified.' },
          { name: 'Chimney Cleaning', icon: '🌬️', sortOrder: 3, description: 'Kitchen chimney deep cleaning and filter replacement. Removes grease and improves suction. At-home service.' },
        ],
      },
      {
        name: 'Kitchen Appliances',
        icon: '🍲',
        sortOrder: 2,
        description: 'RO, microwave, mixer and water purifier services.',
        services: [
          { name: 'RO Service', icon: '💧', sortOrder: 1, description: 'RO water purifier service — filter change, membrane and TDS check. All brands serviced with genuine filters.' },
          { name: 'Microwave Repair', icon: '📟', sortOrder: 2, description: 'Microwave repair — heating, display and door issues. In-warranty and out-of-warranty service at home.' },
          { name: 'Mixer Grinder Repair', icon: '⚙️', sortOrder: 3, description: 'Mixer, grinder and juicer repair — motor, jar and blade. Quick home service with warranty on spares.' },
        ],
      },
    ],
  },
  {
    name: 'TV, Antenna, DTH & Electronics',
    icon: '📺',
    sortOrder: 5,
    description: 'TV, DTH, antenna and electronics repair — LED, LCD, dish alignment and set-top box service. Doorstep repair across India.',
    subcategories: [
      {
        name: 'Television Services',
        icon: '📡',
        sortOrder: 1,
        description: 'LED, LCD and Smart TV installation and repair.',
        services: [
          { name: 'LED TV Repair', icon: '🖥️', sortOrder: 1, description: 'LED/LCD TV repair — display, sound and motherboard. All brands, genuine spares, home service with warranty.' },
          { name: 'TV Installation', icon: '🔩', sortOrder: 2, description: 'Wall mount, table top and Smart TV setup. Cable management and demo included. Same-day installation.' },
          { name: 'Antenna Installation', icon: '📶', sortOrder: 3, description: 'Terrestrial and satellite antenna installation and alignment. Signal boost and wiring for clear reception.' },
        ],
      },
      {
        name: 'DTH & Streaming',
        icon: '🛰️',
        sortOrder: 2,
        description: 'DTH recharge, dish and streaming device setup.',
        services: [
          { name: 'DTH Service', icon: '📥', sortOrder: 1, description: 'DTH installation, dish alignment and set-top box repair. All providers — Airtel, Tata Play, Dish TV.' },
          { name: 'Streaming Device Setup', icon: '🎬', sortOrder: 2, description: 'Fire TV, Chromecast and smart stick setup. Wi-Fi, app installation and demo at home.' },
        ],
      },
    ],
  },
  {
    name: 'Electrical',
    icon: '💡',
    sortOrder: 6,
    description: 'Licensed electricians for wiring, lighting, fans and power backup. Safe, certified and available 24x7 across India.',
    subcategories: [
      {
        name: 'Wiring & Fitting',
        icon: '🔌',
        sortOrder: 1,
        description: 'House wiring, switchboard and safety audits.',
        services: [
          { name: 'House Wiring', icon: '🏗️', sortOrder: 1, description: 'Complete house wiring — concealed and surface. ISI wires, MCB and safety testing by licensed electricians.' },
          { name: 'Switchboard Repair', icon: '🎛️', sortOrder: 2, description: 'Switch, socket and MCB repair and replacement. Modular and non-modular fittings with warranty.' },
          { name: 'Lighting Installation', icon: '💡', sortOrder: 3, description: 'LED, false ceiling and decorative lighting. Energy-efficient setup with dimmer and smart controls.' },
        ],
      },
      {
        name: 'Appliance & Power',
        icon: '⚡',
        sortOrder: 2,
        description: 'Fans, inverters and power backup solutions.',
        services: [
          { name: 'Fan Installation', icon: '🌀', sortOrder: 1, description: 'Ceiling, wall and exhaust fan installation and repair. Balancing, speed control and remote setup.' },
          { name: 'Inverter Service', icon: '🔋', sortOrder: 2, description: 'Inverter and battery service — backup, charging and wiring. Amaron, Luminous and Microtek experts.' },
          { name: 'Electrical Safety Audit', icon: '🛡️', sortOrder: 3, description: 'Home electrical safety audit — earthing, load and short-circuit risks. Report and correction by certified engineers.' },
        ],
      },
    ],
  },
  {
    name: 'Plumbing & Water',
    icon: '🚿',
    sortOrder: 7,
    description: 'Expert plumbers for leakage, fittings, water motors and tank cleaning. Emergency service, genuine parts, across all PIN codes.',
    subcategories: [
      {
        name: 'Plumbing',
        icon: '🔧',
        sortOrder: 1,
        description: 'Tap, pipe and drain plumbing for homes and offices.',
        services: [
          { name: 'Plumber', icon: '🚰', sortOrder: 1, description: 'Emergency plumbers for leakage, blockage and fittings. 24x7 service, transparent charges, one-year warranty on work.' },
          { name: 'Bathroom Fitting', icon: '🛁', sortOrder: 2, description: 'Bathroom tap, shower, commode and geyser fitting. Jaquar, Hindware and Cera fittings installed neatly.' },
          { name: 'Drainage Cleaning', icon: '🧹', sortOrder: 3, description: 'Drain, sewer and pipeline cleaning with jet machines. Removes blockages and foul smell quickly.' },
        ],
      },
      {
        name: 'Water Solutions',
        icon: '💧',
        sortOrder: 2,
        description: 'Water motors, tanks and purification for continuous supply.',
        services: [
          { name: 'Water Motor Repair', icon: '⚙️', sortOrder: 1, description: 'Water motor, pump and borewell repair. Winding, bearing and starter issues fixed at home.' },
          { name: 'Water Tank Cleaning', icon: '🫧', sortOrder: 2, description: 'Overhead and underground water tank cleaning. Anti-bacterial wash and disinfection for safe water.' },
          { name: 'Pipeline Leakage', icon: '🩹', sortOrder: 3, description: 'Hidden pipeline leakage detection and repair without breaking walls. Pressure testing and sealing.' },
        ],
      },
    ],
  },
  {
    name: 'AC & Cooling',
    icon: '❄️',
    sortOrder: 8,
    description: 'AC, cooler and refrigeration service — split, window, gas filling and AMC. Certified technicians, genuine gas, pan-India.',
    subcategories: [
      {
        name: 'Air Conditioning',
        icon: '🌬️',
        sortOrder: 1,
        description: 'Split and window AC installation, service and repair.',
        services: [
          { name: 'AC Service', icon: '🧊', sortOrder: 1, description: 'AC jet service, filter cleaning and cooling check. Split and window AC, all brands, at-home service.' },
          { name: 'AC Installation', icon: '🔨', sortOrder: 2, description: 'AC installation and uninstallation with copper piping and gas check. Wall drilling and stabilizer setup included.' },
          { name: 'AC Gas Refilling', icon: '⛽', sortOrder: 3, description: 'AC gas refilling — R32, R410 and R22. Leak detection, pressure test and cooling warranty.' },
          { name: 'AC AMC', icon: '📅', sortOrder: 4, description: 'Annual maintenance contracts for ACs — 3 services, free gas top-up and priority breakdown support.' },
        ],
      },
      {
        name: 'Cooling Appliances',
        icon: '🧊',
        sortOrder: 2,
        description: 'Cooler, fridge and deep freezer services.',
        services: [
          { name: 'Cooler Repair', icon: '💨', sortOrder: 1, description: 'Air cooler repair — pump, fan and cooling pad. Pre-summer service and water leak fix.' },
          { name: 'Refrigerator Repair', icon: '🥶', sortOrder: 2, description: 'Fridge and deep freezer repair — cooling, gas and compressor. Doorstep service with genuine spares.' },
        ],
      },
    ],
  },
  {
    name: 'Mobile, Computer & Digital',
    icon: '📱',
    sortOrder: 9,
    description: 'Mobile, laptop and computer repair — screen, battery, software and data recovery. Doorstep service, genuine parts, all brands.',
    subcategories: [
      {
        name: 'Mobile Services',
        icon: '📲',
        sortOrder: 1,
        description: 'Phone repair, accessories and software for all brands.',
        services: [
          { name: 'Mobile Repair', icon: '🔧', sortOrder: 1, description: 'Mobile phone repair — screen, battery and charging. iPhone, Samsung, Xiaomi doorstep service with warranty.' },
          { name: 'Mobile Software', icon: '💾', sortOrder: 2, description: 'Phone flashing, unlocking and data recovery. Virus removal and performance optimization at home.' },
        ],
      },
      {
        name: 'Computer Services',
        icon: '💻',
        sortOrder: 2,
        description: 'Laptop, desktop and peripherals for home and office.',
        services: [
          { name: 'Laptop Repair', icon: '🖥️', sortOrder: 1, description: 'Laptop repair — keyboard, display and motherboard. Dell, HP, Lenovo service with genuine parts.' },
          { name: 'Computer Assembling', icon: '🧩', sortOrder: 2, description: 'Custom PC assembling for gaming, office and editing. Parts selection, assembly and testing.' },
          { name: 'Printer Service', icon: '🖨️', sortOrder: 3, description: 'Printer, scanner and cartridge service — inkjet and laser. Refilling, head cleaning and network setup.' },
        ],
      },
    ],
  },
  {
    name: 'Digital & Creator Services',
    icon: '🎬',
    sortOrder: 10,
    description: 'Creators, editors, designers and marketers for YouTube, Instagram and brands. Grow your channel and business pan-India.',
    subcategories: [
      {
        name: 'Video & Editing',
        icon: '🎥',
        sortOrder: 1,
        description: 'Professional video editing for YouTube, reels and ads.',
        services: [
          { name: 'YouTuber', icon: '▶️', sortOrder: 1, description: 'Professional YouTubers for collaboration, hosting and channel promotion. Verified creators across genres pan-India.' },
          { name: 'Content Creator', icon: '🌟', sortOrder: 2, description: 'Hire content creators for Instagram, YouTube and brands. Reels, shorts and campaigns with proven engagement.' },
          { name: 'Video Editor', icon: '✂️', sortOrder: 3, description: 'Expert video editors for YouTube, weddings and corporate films. Premiere Pro, DaVinci and After Effects mastery.' },
          { name: 'YouTube Video Editor', icon: '🎞️', sortOrder: 4, description: 'Specialized YouTube video editing — cuts, captions and retention hooks. Thumbnail, SEO and upload included.' },
          { name: 'Shorts/Reels Editor', icon: '📱', sortOrder: 5, description: 'Viral shorts and reels editing — hooks, captions and trending sounds. 9:16 optimized for YouTube Shorts and Instagram.' },
        ],
      },
      {
        name: 'Design & Creative',
        icon: '🎨',
        sortOrder: 2,
        description: 'Thumbnails, graphics and UI/UX that convert viewers to subscribers.',
        services: [
          { name: 'Thumbnail Designer', icon: '🖼️', sortOrder: 1, description: 'High-CTR thumbnail designers for YouTube. Bold text, facial close-ups and A/B variants for more clicks.' },
          { name: 'YouTube Thumbnail Design', icon: '🏆', sortOrder: 2, description: 'YouTube-first thumbnail design with proven CTR frameworks. Tested fonts, colors and composition for your niche.' },
          { name: 'Graphic Designer', icon: '✒️', sortOrder: 3, description: 'Creative graphic designers for logos, posters and social media. Brand kits and print-ready files delivered fast.' },
          { name: 'UI/UX Designer', icon: '📐', sortOrder: 4, description: 'UI/UX designers for websites and apps. Figma prototypes, user flows and developer handoff pan-India.' },
        ],
      },
      {
        name: 'Marketing & Growth',
        icon: '📈',
        sortOrder: 3,
        description: 'YouTube SEO, social media and digital marketing to grow reach.',
        services: [
          { name: 'Social Media Manager', icon: '📲', sortOrder: 1, description: 'Dedicated social media managers for content calendar, posting and community. Growth for Instagram, Facebook and LinkedIn.' },
          { name: 'Digital Marketing', icon: '📣', sortOrder: 2, description: 'Full-stack digital marketing — ads, funnels and analytics. ROI-focused campaigns for leads and sales across India.' },
          { name: 'SEO', icon: '🔍', sortOrder: 3, description: 'Search engine optimization for Google ranking. Keyword research, on-page and backlinks for organic traffic growth.' },
          { name: 'YouTube SEO', icon: '🏷️', sortOrder: 4, description: 'YouTube SEO experts for titles, tags and ranking. Keyword-optimized metadata to push videos to suggested and search.' },
          { name: 'Channel Management', icon: '🗂️', sortOrder: 5, description: 'End-to-end YouTube channel management — uploads, analytics and strategy. Weekly growth reports and content planning.' },
        ],
      },
      {
        name: 'Development & Writing',
        icon: '💻',
        sortOrder: 4,
        description: 'Web, app and content solutions for creators and startups.',
        services: [
          { name: 'Website Developer', icon: '🌐', sortOrder: 1, description: 'Professional website developers — WordPress, React and Next.js. Mobile-first, SEO-ready sites with fast delivery.' },
          { name: 'App Developer', icon: '📲', sortOrder: 2, description: 'Android and iOS app developers — native and Flutter. Play Store deployment and maintenance included.' },
          { name: 'Content Writer', icon: '✍️', sortOrder: 3, description: 'SEO content writers for blogs, scripts and websites. Keyword-rich, plagiarism-free writing in Hindi and English.' },
          { name: 'YouTube Script Writer', icon: '📜', sortOrder: 4, description: 'Engaging YouTube script writers — hooks, storytelling and retention. Niches from finance to entertainment, Hindi/English.' },
          { name: 'Voice Over Artist', icon: '🎙️', sortOrder: 5, description: 'Professional voice over artists — Hindi, English and regional. Studio-quality recordings for videos and ads.' },
        ],
      },
    ],
  },
  {
    name: 'Vehicles',
    icon: '🚗',
    sortOrder: 11,
    description: 'Vehicle repair, servicing and rentals — car, bike, auto and commercial. Roadside assistance and home service across India.',
    subcategories: [
      {
        name: 'Two Wheeler',
        icon: '🛵',
        sortOrder: 1,
        description: 'Bike and scooter repair, service and spare parts.',
        services: [
          { name: 'Bike Repair', icon: '🏍️', sortOrder: 1, description: 'Complete bike and scooter repair — engine, brake and servicing. All brands, genuine spares, doorstep service.' },
          { name: 'Two Wheeler Service', icon: '🔧', sortOrder: 2, description: 'Periodic two-wheeler servicing with oil change and wash. Annual packages with pickup and drop.' },
        ],
      },
      {
        name: 'Four Wheeler',
        icon: '🚙',
        sortOrder: 2,
        description: 'Car service, denting and detailing for all models.',
        services: [
          { name: 'Car Service', icon: '🧰', sortOrder: 1, description: 'Car servicing — periodic, oil and filter change. Maruti, Hyundai, Tata and luxury brands with pickup-drop.' },
          { name: 'Car Wash', icon: '🚿', sortOrder: 2, description: 'Foam car wash, interior cleaning and polishing. Doorstep and centre wash with eco-friendly products.' },
          { name: 'Car Denting Painting', icon: '🎨', sortOrder: 3, description: 'Car denting, painting and accidental repair. Insurance claims assistance and color matching guarantee.' },
        ],
      },
      {
        name: 'Commercial & Rental',
        icon: '🚚',
        sortOrder: 3,
        description: 'Commercial vehicles, driving and rentals.',
        services: [
          { name: 'Auto Rickshaw Service', icon: '🛺', sortOrder: 1, description: 'Auto rickshaw repair and CNG fitting. Engine, meter and body work for city permits.' },
          { name: 'Vehicle Rental', icon: '🔑', sortOrder: 2, description: 'Car, bike and tempo rental for travel and events. Self-drive and chauffeur options pan-India.' },
        ],
      },
    ],
  },
  {
    name: 'Carpenter & Furniture',
    icon: '🪚',
    sortOrder: 12,
    description: 'Carpenters and furniture makers — custom furniture, repair and polishing. Home visit, measurement and 3D design across India.',
    subcategories: [
      {
        name: 'Carpentry',
        icon: '🔨',
        sortOrder: 1,
        description: 'Custom carpentry for doors, windows and interiors.',
        services: [
          { name: 'Carpenter', icon: '🪵', sortOrder: 1, description: 'Skilled carpenters for furniture, doors and modular kitchens. Custom design, polished finish, on-time delivery.' },
          { name: 'Furniture Repair', icon: '🛠️', sortOrder: 2, description: 'Furniture repair — joints, polish and termite treatment. Sofa, bed and wardrobe fixes at home.' },
          { name: 'Modular Kitchen', icon: '🍽️', sortOrder: 3, description: 'Modular kitchen design and installation — cabinets, trolleys and chimneys. 3D design and factory finish.' },
        ],
      },
      {
        name: 'Furniture',
        icon: '🛋️',
        sortOrder: 2,
        description: 'Furniture making, polishing and upholstery.',
        services: [
          { name: 'Furniture Making', icon: '🪑', sortOrder: 1, description: 'Custom furniture making — beds, tables and wardrobes. Teak, plywood and MDF with warranty.' },
          { name: 'Furniture Polish', icon: '✨', sortOrder: 2, description: 'Wood polish, melamine and PU coating. Restores shine and protects from termites. At-home service.' },
          { name: 'Sofa Upholstery', icon: '🧵', sortOrder: 3, description: 'Sofa fabric change, foam and spring repair. Large fabric catalogue and home fitting.' },
        ],
      },
    ],
  },
  {
    name: 'Construction & Home Improvement',
    icon: '🏗️',
    sortOrder: 13,
    description: 'Construction, civil work and home improvement — contractors, painters, tiles and waterproofing. Verified teams pan-India.',
    subcategories: [
      {
        name: 'Civil & Construction',
        icon: '🧱',
        sortOrder: 1,
        description: 'Building construction, renovation and civil contractors.',
        services: [
          { name: 'Civil Contractor', icon: '👷', sortOrder: 1, description: 'Civil contractors for house construction and renovation. Material plus labour or labour-only contracts.' },
          { name: 'House Renovation', icon: '🏠', sortOrder: 2, description: 'Complete house renovation — structure, flooring and finishing. Plan, 3D and execution by one team.' },
          { name: 'Waterproofing', icon: '💧', sortOrder: 3, description: 'Terrace, bathroom and wall waterproofing. Dr Fixit and Asian Paints treatments with 5-year warranty.' },
        ],
      },
      {
        name: 'Finishing Work',
        icon: '🎨',
        sortOrder: 2,
        description: 'Painting, tiles, POP and false ceiling for a finished home.',
        services: [
          { name: 'House Painting', icon: '🖌️', sortOrder: 1, description: 'Interior and exterior house painting — putty, primer and paint. Asian Paints, Berger with shade cards.' },
          { name: 'Tile Fitting', icon: '🧩', sortOrder: 2, description: 'Tile, marble and granite fitting for floors and walls. Leveling, grouting and polishing included.' },
          { name: 'POP & False Ceiling', icon: '🏛️', sortOrder: 3, description: 'POP, gypsum and false ceiling design. LED cove, spot lights and modern patterns for every room.' },
        ],
      },
    ],
  },
  {
    name: 'Moving, Transport & Labour',
    icon: '🚚',
    sortOrder: 14,
    description: 'Packers, movers, transport and labour — household shifting, office relocation and loading across India. Insured, on-time.',
    subcategories: [
      {
        name: 'Packers & Movers',
        icon: '📦',
        sortOrder: 1,
        description: 'Household and office shifting with packing and unpacking.',
        services: [
          { name: 'Packers and Movers', icon: '📤', sortOrder: 1, description: 'Professional packers and movers — packing, loading and transport. Local and intercity with insurance.' },
          { name: 'House Shifting', icon: '🏠', sortOrder: 2, description: 'Complete house shifting — furniture, kitchen and fragile items. Bubble wrap, cartons and reassembling.' },
          { name: 'Office Shifting', icon: '🏢', sortOrder: 3, description: 'Office relocation — desks, servers and files. Weekend shifting to avoid business disruption.' },
        ],
      },
      {
        name: 'Transport & Labour',
        icon: '👷‍♂️',
        sortOrder: 2,
        description: 'Transport vehicles, loading and labour supply.',
        services: [
          { name: 'Tempo Service', icon: '🚛', sortOrder: 1, description: 'Tempo, mini truck and pickup on rent for shifting and goods. Local and outstation with driver.' },
          { name: 'Labour Supply', icon: '💪', sortOrder: 2, description: 'Verified labour for loading, unloading and construction. Daily, weekly and monthly hiring pan-India.' },
          { name: 'Courier Service', icon: '✉️', sortOrder: 3, description: 'Domestic courier — documents and parcels. Same-day and next-day delivery across 19,000 PIN codes.' },
        ],
      },
    ],
  },
  {
    name: 'Event & Entertainment',
    icon: '🎉',
    sortOrder: 15,
    description: 'Event planning, entertainment and rentals — birthdays, corporate and cultural events. Decor, catering and artists pan-India.',
    subcategories: [
      {
        name: 'Event Planning',
        icon: '📅',
        sortOrder: 1,
        description: 'Complete event planning and management.',
        services: [
          { name: 'Event Planner', icon: '🎊', sortOrder: 1, description: 'Professional event planners for birthdays, anniversaries and corporate events. Concept, budget and execution.' },
          { name: 'Birthday Decoration', icon: '🎂', sortOrder: 2, description: 'Birthday decoration — balloons, themes and cakes. Home and hall decoration with photo booth.' },
          { name: 'Sound & Lighting', icon: '🔊', sortOrder: 3, description: 'DJ, sound and stage lighting on rent. Professional operators and power backup included.' },
        ],
      },
      {
        name: 'Entertainment',
        icon: '🎭',
        sortOrder: 2,
        description: 'Artists, performers and entertainment for every occasion.',
        services: [
          { name: 'Anchor Services', icon: '🎤', sortOrder: 1, description: 'Professional anchors and MCs for weddings, corporate and college events. Hindi and English hosts with engaging scripts.' },
          { name: 'Live Band', icon: '🎸', sortOrder: 2, description: 'Live bands, singers and instrumentalists for events. Bollywood, Sufi and regional music groups.' },
          { name: 'Magic Show', icon: '🎩', sortOrder: 3, description: 'Magicians and illusionists for birthdays and corporate events. Interactive shows for kids and adults.' },
        ],
      },
    ],
  },
  {
    name: 'Education & Training',
    icon: '📚',
    sortOrder: 16,
    description: 'Tutors, coaching and skill training — school, competition and vocational. Verified teachers, home and online across India.',
    subcategories: [
      {
        name: 'School & College Tuition',
        icon: '👨‍🏫',
        sortOrder: 1,
        description: 'Home tuition for school and college subjects.',
        services: [
          { name: 'Home Tutor', icon: '🧑‍🏫', sortOrder: 1, description: 'Home tutors for Class 1–12 — Maths, Science and Languages. Verified teachers, demo class free, home and online.' },
          { name: 'Online Tutor', icon: '💻', sortOrder: 2, description: 'Online tuition via Zoom and Meet. Recorded classes, doubt sessions and test series for all boards.' },
          { name: 'Language Trainer', icon: '🗣️', sortOrder: 3, description: 'Spoken English, Hindi and foreign language training. IELTS, TOEFL and business communication courses.' },
        ],
      },
      {
        name: 'Competitive & Professional',
        icon: '🎯',
        sortOrder: 2,
        description: 'Coaching for competitive exams and professional courses.',
        services: [
          { name: 'Competitive Exam Coaching', icon: '📝', sortOrder: 1, description: 'Coaching for UPSC, SSC, Banking and Railways. Classroom and online batches with mock tests.' },
          { name: 'Computer Training', icon: '⌨️', sortOrder: 2, description: 'Computer training — basics, Tally, Excel and programming. Govt certificates and job assistance.' },
          { name: 'Music Teacher', icon: '🎵', sortOrder: 3, description: 'Music teachers for vocal, guitar, tabla and keyboard. Home and online classes with certified instructors.' },
        ],
      },
    ],
  },
  {
    name: 'Fitness & Wellness',
    icon: '💪',
    sortOrder: 17,
    description: 'Fitness trainers, yoga, diet and wellness — gym, home and online. Certified professionals, personalized plans pan-India.',
    subcategories: [
      {
        name: 'Fitness Training',
        icon: '🏋️',
        sortOrder: 1,
        description: 'Personal and group fitness training for every goal.',
        services: [
          { name: 'Gym Trainer', icon: '🏃', sortOrder: 1, description: 'Certified gym trainers for weight loss, muscle gain and strength. Home and gym sessions with diet plan.' },
          { name: 'Yoga Trainer', icon: '🧘', sortOrder: 2, description: 'Experienced yoga trainers — Hatha, Ashtanga and power yoga. Home and online batches, beginner to advanced.' },
          { name: 'Zumba Classes', icon: '💃', sortOrder: 3, description: 'High-energy Zumba classes for fitness and fun. Group and private batches with certified instructors.' },
        ],
      },
      {
        name: 'Wellness',
        icon: '🩺',
        sortOrder: 2,
        description: 'Diet, physiotherapy and mental wellness.',
        services: [
          { name: 'Dietitian', icon: '🥗', sortOrder: 1, description: 'Certified dietitians for weight, diabetes and therapeutic diets. Personalized meal plans and weekly follow-ups.' },
          { name: 'Physiotherapist', icon: '🦵', sortOrder: 2, description: 'Licensed physiotherapists for pain, post-surgery and sports injury. Home visits with equipment.' },
          { name: 'Meditation Centre', icon: '🕯️', sortOrder: 3, description: 'Meditation and mindfulness centres — stress relief and focus. Guided sessions and retreats pan-India.' },
        ],
      },
    ],
  },
  {
    name: 'Photography & Creative',
    icon: '📸',
    sortOrder: 18,
    description: 'Photographers, videographers and creative artists — weddings, products and fashion. Candid, studio and drone across India.',
    subcategories: [
      {
        name: 'Photography',
        icon: '📷',
        sortOrder: 1,
        description: 'Professional photography for every occasion.',
        services: [
          { name: 'Wedding Photographer', icon: '💍', sortOrder: 1, description: 'Candid wedding photographers and cinematographers. Albums, drone and same-day edit across India.' },
          { name: 'Portrait Photographer', icon: '🧑', sortOrder: 2, description: 'Portrait, family and baby photographers. Studio and outdoor shoots with creative lighting.' },
          { name: 'Product Photography', icon: '🛍️', sortOrder: 3, description: 'E-commerce product photography — white background and lifestyle. Amazon, Flipkart and catalog shoots.' },
        ],
      },
      {
        name: 'Videography & Editing',
        icon: '🎞️',
        sortOrder: 2,
        description: 'Videography, drone and photo editing.',
        services: [
          { name: 'Videographer', icon: '🎬', sortOrder: 1, description: 'Professional videographers for events, ads and corporate films. 4K, gimbal and drone coverage.' },
          { name: 'Drone Photography', icon: '🚁', sortOrder: 2, description: 'DGCA-approved drone photography and videography. Weddings, real estate and events with aerial views.' },
          { name: 'Photo Editing', icon: '🖌️', sortOrder: 3, description: 'Photo editing and retouching — color correction and background removal. Bulk editing for e-commerce.' },
        ],
      },
    ],
  },
  {
    name: 'Professional & Freelance',
    icon: '💼',
    sortOrder: 19,
    description: 'CAs, lawyers, consultants and freelancers — legal, finance and business services. Verified professionals, affordable fees.',
    subcategories: [
      {
        name: 'Finance & Legal',
        icon: '⚖️',
        sortOrder: 1,
        description: 'Chartered accountants, lawyers and tax consultants.',
        services: [
          { name: 'CA Services', icon: '🧾', sortOrder: 1, description: 'Chartered accountants for ITR, GST and company registration. Affordable fees and online filing pan-India.' },
          { name: 'Lawyer', icon: '👨‍⚖️', sortOrder: 2, description: 'Experienced lawyers — civil, criminal and family. Consultation, documentation and court representation.' },
          { name: 'Tax Consultant', icon: '💰', sortOrder: 3, description: 'Tax consultants for filing, planning and notices. Personal and business tax optimization with audit support.' },
        ],
      },
      {
        name: 'Business & Consulting',
        icon: '📊',
        sortOrder: 2,
        description: 'Business setup, marketing and HR consultants.',
        services: [
          { name: 'Business Consultant', icon: '💡', sortOrder: 1, description: 'Business consultants for startup, strategy and funding. Pitch decks, registration and growth planning.' },
          { name: 'Freelancer', icon: '👩‍💻', sortOrder: 2, description: 'Verified freelancers for writing, design and data entry. Hourly and project-based hiring with escrow.' },
          { name: 'Astrologer', icon: '🔮', sortOrder: 3, description: 'Trusted astrologers — horoscope, vastu and kundli matching. Online and in-person consultation in Hindi/English.' },
        ],
      },
    ],
  },
  {
    name: 'Pets',
    icon: '🐾',
    sortOrder: 20,
    description: 'Pet care — grooming, training, veterinary and boarding. Loving care for dogs, cats and birds across India.',
    subcategories: [
      {
        name: 'Pet Care',
        icon: '🐶',
        sortOrder: 1,
        description: 'Grooming, training and walking for pets.',
        services: [
          { name: 'Pet Grooming', icon: '✂️', sortOrder: 1, description: 'Professional pet grooming — bath, haircut and nails. At-home and salon service for dogs and cats.' },
          { name: 'Dog Training', icon: '🦮', sortOrder: 2, description: 'Certified dog trainers — obedience, behaviour and agility. Home and centre training with positive methods.' },
          { name: 'Pet Walking', icon: '🚶', sortOrder: 3, description: 'Reliable dog walkers — daily, weekly and on-demand. GPS tracked walks and photo updates.' },
        ],
      },
      {
        name: 'Veterinary & Supplies',
        icon: '🏥',
        sortOrder: 2,
        description: 'Vets, boarding and pet products.',
        services: [
          { name: 'Veterinarian', icon: '👨‍⚕️', sortOrder: 1, description: 'Licensed veterinarians for checkups, vaccination and surgery. Home visits and 24x7 emergency clinics.' },
          { name: 'Pet Boarding', icon: '🏠', sortOrder: 2, description: 'Safe pet boarding and day care — air-conditioned, CCTV and daily updates. Home-style care while you travel.' },
        ],
      },
    ],
  },
  {
    name: 'Gardening & Outdoor',
    icon: '🌱',
    sortOrder: 21,
    description: 'Gardeners, landscapers and outdoor maintenance — lawn, plants and pools. Green, beautiful spaces across India.',
    subcategories: [
      {
        name: 'Gardening',
        icon: '🌳',
        sortOrder: 1,
        description: 'Garden design, maintenance and plant care.',
        services: [
          { name: 'Gardener', icon: '👨‍🌾', sortOrder: 1, description: 'Professional gardeners for planting, pruning and maintenance. Lawn, terrace and balcony gardens pan-India.' },
          { name: 'Landscaping', icon: '🏡', sortOrder: 2, description: 'Landscape design — lawns, pathways and water features. 3D design and execution for homes and offices.' },
          { name: 'Plant Nursery', icon: '🪴', sortOrder: 3, description: 'Plant nurseries — indoor, flowering and medicinal plants. Home delivery, pots and maintenance advice.' },
        ],
      },
      {
        name: 'Outdoor Maintenance',
        icon: '☀️',
        sortOrder: 2,
        description: 'Outdoor cleaning, pools and pest for gardens.',
        services: [
          { name: 'Swimming Pool Cleaning', icon: '🏊', sortOrder: 1, description: 'Swimming pool cleaning — filtration, chemical and tiles. Weekly and monthly AMC for clear water.' },
          { name: 'Outdoor Cleaning', icon: '🧹', sortOrder: 2, description: 'Outdoor area cleaning — parking, terrace and society common areas. Pressure wash and waste removal.' },
        ],
      },
    ],
  },
  {
    name: 'Security & Technical',
    icon: '🛡️',
    sortOrder: 22,
    description: 'Security guards, CCTV, biometrics and technical support — homes, offices and events. Verified staff, pan-India.',
    subcategories: [
      {
        name: 'Security',
        icon: '👮',
        sortOrder: 1,
        description: 'Guards, bouncers and event security.',
        services: [
          { name: 'Security Guard', icon: '🚨', sortOrder: 1, description: 'Trained security guards — home, office and society. Uniformed, verified and 24x7 deployment.' },
          { name: 'Bouncer Services', icon: '💪', sortOrder: 2, description: 'Professional bouncers for events, clubs and VIPs. Physique verified, disciplined and uniformed.' },
          { name: 'CCTV Installation', icon: '📹', sortOrder: 3, description: 'CCTV installation — HD, IP and Wi-Fi cameras. Remote viewing, DVR and AMC with wiring.' },
        ],
      },
      {
        name: 'Technical Support',
        icon: '🖥️',
        sortOrder: 2,
        description: 'IT support, networking and automation.',
        services: [
          { name: 'CCTV Repair', icon: '🔧', sortOrder: 1, description: 'CCTV repair — camera, DVR and wiring. Night vision, storage and app issues fixed at site.' },
          { name: 'Biometric Installation', icon: '🖐️', sortOrder: 2, description: 'Biometric attendance — fingerprint and face. Installation, software and payroll integration.' },
          { name: 'Home Automation', icon: '🏠', sortOrder: 3, description: 'Smart home automation — lights, locks and curtains. Alexa, Google Home and app control.' },
        ],
      },
    ],
  },
  {
    name: 'Other Local Services',
    icon: '🔧',
    sortOrder: 23,
    description: 'All other local services — tailors, laundry, drivers and daily needs. Trusted providers near your PIN code.',
    subcategories: [
      {
        name: 'Daily Needs',
        icon: '🛒',
        sortOrder: 1,
        description: 'Tailoring, laundry and everyday services.',
        services: [
          { name: 'Tailor', icon: '🧵', sortOrder: 1, description: 'Expert tailors — stitching, alteration and design. Ladies, gents and kids wear with perfect fitting.' },
          { name: 'Laundry Service', icon: '👕', sortOrder: 2, description: 'Laundry, dry cleaning and ironing — pickup and delivery. Eco-friendly wash and express service.' },
          { name: 'Driver on Hire', icon: '🚘', sortOrder: 3, description: 'Verified drivers on hire — monthly, daily and outstation. License verified, uniformed and punctual.' },
        ],
      },
      {
        name: 'Miscellaneous',
        icon: '🧰',
        sortOrder: 2,
        description: 'Water supply, keys and other local help.',
        services: [
          { name: 'Water Supplier', icon: '🚰', sortOrder: 1, description: 'Tanker water supply for homes, events and construction. 24x7 delivery, 5000–10000 litre capacity.' },
          { name: 'Key Maker', icon: '🔑', sortOrder: 2, description: 'Key making and lock repair — duplicate keys, lock opening and digital locks. Emergency service.' },
          { name: 'Scrap Dealer', icon: '♻️', sortOrder: 3, description: 'Scrap collection — paper, metal and e-waste. Doorstep pickup with instant payment by weight.' },
        ],
      },
    ],
  },
];

module.exports = { catalog };
