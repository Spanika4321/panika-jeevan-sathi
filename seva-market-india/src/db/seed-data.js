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
    name: "Beauty & Personal Care", icon: "\ud83d\udc84", sortOrder: 1,
    children: [
      { name: "Makeup Artist", icon: "\ud83d\udc84", sortOrder: 1 },
      { name: "Bridal Makeup Artist", icon: "\ud83d\udc84", sortOrder: 2 },
      { name: "Groom Makeup Artist", icon: "\ud83d\udc84", sortOrder: 3 },
      { name: "Party Makeup Artist", icon: "\ud83d\udc84", sortOrder: 4 },
      { name: "Engagement Makeup Artist", icon: "\ud83d\udc84", sortOrder: 5 },
      { name: "Reception Makeup Artist", icon: "\ud83d\udc84", sortOrder: 6 },
      { name: "HD Makeup Artist", icon: "\ud83d\udc84", sortOrder: 7 },
      { name: "Airbrush Makeup Artist", icon: "\ud83d\udc84", sortOrder: 8 },
      { name: "Traditional Makeup Artist", icon: "\ud83d\udc84", sortOrder: 9 },
      { name: "Natural Makeup Artist", icon: "\ud83d\udc84", sortOrder: 10 },
      { name: "Photoshoot Makeup Artist", icon: "\ud83d\udc84", sortOrder: 11 },
      { name: "Home Makeup Service", icon: "\ud83d\udc84", sortOrder: 12 },
      { name: "Makeup Trial Service", icon: "\ud83d\udc84", sortOrder: 13 },
      { name: "Hair Stylist", icon: "\ud83d\udc84", sortOrder: 14 },
      { name: "Hair Cutting", icon: "\ud83d\udc84", sortOrder: 15 },
      { name: "Hair Coloring", icon: "\ud83d\udc84", sortOrder: 16 },
      { name: "Hair Spa", icon: "\ud83d\udc84", sortOrder: 17 },
      { name: "Facial", icon: "\ud83d\udc84", sortOrder: 18 },
      { name: "Threading", icon: "\ud83d\udc84", sortOrder: 19 },
      { name: "Waxing", icon: "\ud83d\udc84", sortOrder: 20 },
      { name: "Manicure", icon: "\ud83d\udc84", sortOrder: 21 },
      { name: "Pedicure", icon: "\ud83d\udc84", sortOrder: 22 },
      { name: "Nail Art", icon: "\ud83d\udc84", sortOrder: 23 },
      { name: "Saree Draping", icon: "\ud83d\udc84", sortOrder: 24 },
      { name: "Bridal Dressing", icon: "\ud83d\udc84", sortOrder: 25 },
      { name: "Mehndi Artist", icon: "\ud83d\udc84", sortOrder: 26 },
      { name: "Bridal Mehndi", icon: "\ud83d\udc84", sortOrder: 27 },
      { name: "Wellness Body Massage", icon: "\ud83d\udc84", sortOrder: 28 },
      { name: "Relaxation Massage", icon: "\ud83d\udc84", sortOrder: 29 },
      { name: "Head & Shoulder Massage", icon: "\ud83d\udc84", sortOrder: 30 },
      { name: "Back & Neck Massage", icon: "\ud83d\udc84", sortOrder: 31 },
      { name: "Foot Massage", icon: "\ud83d\udc84", sortOrder: 32 },
    ],
  },
  {
    name: "Home Cleaning & Housekeeping", icon: "\ud83e\uddf9", sortOrder: 2,
    children: [
      { name: "Home Cleaning", icon: "\ud83e\uddf9", sortOrder: 1 },
      { name: "Deep Home Cleaning", icon: "\ud83e\uddf9", sortOrder: 2 },
      { name: "Bathroom Cleaning", icon: "\ud83e\uddf9", sortOrder: 3 },
      { name: "Kitchen Cleaning", icon: "\ud83e\uddf9", sortOrder: 4 },
      { name: "Window & Glass Cleaning", icon: "\ud83e\uddf9", sortOrder: 5 },
      { name: "Floor Cleaning", icon: "\ud83e\uddf9", sortOrder: 6 },
      { name: "Sofa Cleaning", icon: "\ud83e\uddf9", sortOrder: 7 },
      { name: "Carpet Cleaning", icon: "\ud83e\uddf9", sortOrder: 8 },
      { name: "Mattress Cleaning", icon: "\ud83e\uddf9", sortOrder: 9 },
      { name: "Water Tank Cleaning", icon: "\ud83e\uddf9", sortOrder: 10 },
      { name: "Pest Control", icon: "\ud83e\uddf9", sortOrder: 11 },
      { name: "Home Sanitization", icon: "\ud83e\uddf9", sortOrder: 12 },
      { name: "Maid Service", icon: "\ud83e\uddf9", sortOrder: 13 },
      { name: "Domestic Help", icon: "\ud83e\uddf9", sortOrder: 14 },
      { name: "Cook Service", icon: "\ud83e\uddf9", sortOrder: 15 },
      { name: "Gardener", icon: "\ud83e\uddf9", sortOrder: 16 },
      { name: "Laundry Service", icon: "\ud83e\uddf9", sortOrder: 17 },
      { name: "Ironing Service", icon: "\ud83e\uddf9", sortOrder: 18 },
    ],
  },
  {
    name: "Electrical Services", icon: "\u26a1", sortOrder: 3,
    children: [
      { name: "Electrician", icon: "\u26a1", sortOrder: 1 },
      { name: "Emergency Electrician", icon: "\u26a1", sortOrder: 2 },
      { name: "Home Wiring", icon: "\u26a1", sortOrder: 3 },
      { name: "Electrical Repair", icon: "\u26a1", sortOrder: 4 },
      { name: "Switch & Socket Repair", icon: "\u26a1", sortOrder: 5 },
      { name: "MCB/Electrical Panel Service", icon: "\u26a1", sortOrder: 6 },
      { name: "Fan Repair", icon: "\u26a1", sortOrder: 7 },
      { name: "Fan Installation", icon: "\u26a1", sortOrder: 8 },
      { name: "Light Installation", icon: "\u26a1", sortOrder: 9 },
      { name: "Inverter Service", icon: "\u26a1", sortOrder: 10 },
      { name: "UPS Service", icon: "\u26a1", sortOrder: 11 },
      { name: "Generator Repair", icon: "\u26a1", sortOrder: 12 },
      { name: "Solar Panel Service", icon: "\u26a1", sortOrder: 13 },
    ],
  },
  {
    name: "Plumbing & Water Services", icon: "\ud83d\udebf", sortOrder: 4,
    children: [
      { name: "Plumber", icon: "\ud83d\udebf", sortOrder: 1 },
      { name: "Tap Repair", icon: "\ud83d\udebf", sortOrder: 2 },
      { name: "Pipe Repair", icon: "\ud83d\udebf", sortOrder: 3 },
      { name: "Leakage Repair", icon: "\ud83d\udebf", sortOrder: 4 },
      { name: "Drain Cleaning", icon: "\ud83d\udebf", sortOrder: 5 },
      { name: "Bathroom Plumbing", icon: "\ud83d\udebf", sortOrder: 6 },
      { name: "Kitchen Plumbing", icon: "\ud83d\udebf", sortOrder: 7 },
      { name: "Water Pump Repair", icon: "\ud83d\udebf", sortOrder: 8 },
      { name: "Water Motor Repair", icon: "\ud83d\udebf", sortOrder: 9 },
      { name: "Borewell Service", icon: "\ud83d\udebf", sortOrder: 10 },
      { name: "Water Tank Installation", icon: "\ud83d\udebf", sortOrder: 11 },
      { name: "RO Service", icon: "\ud83d\udebf", sortOrder: 12 },
      { name: "Water Purifier Installation", icon: "\ud83d\udebf", sortOrder: 13 },
      { name: "Water Purifier Repair", icon: "\ud83d\udebf", sortOrder: 14 },
    ],
  },
  {
    name: "AC, Cooling & Appliances", icon: "\u2744\ufe0f", sortOrder: 5,
    children: [
      { name: "AC Repair", icon: "\u2744\ufe0f", sortOrder: 1 },
      { name: "AC Installation", icon: "\u2744\ufe0f", sortOrder: 2 },
      { name: "AC Servicing", icon: "\u2744\ufe0f", sortOrder: 3 },
      { name: "AC Cleaning", icon: "\u2744\ufe0f", sortOrder: 4 },
      { name: "AC Gas Charging", icon: "\u2744\ufe0f", sortOrder: 5 },
      { name: "AC Uninstallation", icon: "\u2744\ufe0f", sortOrder: 6 },
      { name: "Cooler Repair", icon: "\u2744\ufe0f", sortOrder: 7 },
      { name: "Refrigerator Repair", icon: "\u2744\ufe0f", sortOrder: 8 },
      { name: "Deep Freezer Repair", icon: "\u2744\ufe0f", sortOrder: 9 },
      { name: "Washing Machine Repair", icon: "\u2744\ufe0f", sortOrder: 10 },
      { name: "Microwave Repair", icon: "\u2744\ufe0f", sortOrder: 11 },
      { name: "Mixer Grinder Repair", icon: "\u2744\ufe0f", sortOrder: 12 },
    ],
  },
  {
    name: "TV, DTH & Electronics", icon: "\ud83d\udcfa", sortOrder: 6,
    children: [
      { name: "TV Repair", icon: "\ud83d\udcfa", sortOrder: 1 },
      { name: "LED TV Repair", icon: "\ud83d\udcfa", sortOrder: 2 },
      { name: "LCD TV Repair", icon: "\ud83d\udcfa", sortOrder: 3 },
      { name: "Smart TV Setup", icon: "\ud83d\udcfa", sortOrder: 4 },
      { name: "TV Wall Mounting", icon: "\ud83d\udcfa", sortOrder: 5 },
      { name: "TV Antenna Setting", icon: "\ud83d\udcfa", sortOrder: 6 },
      { name: "TV Antenna Installation", icon: "\ud83d\udcfa", sortOrder: 7 },
      { name: "DTH Installation", icon: "\ud83d\udcfa", sortOrder: 8 },
      { name: "DTH Repair", icon: "\ud83d\udcfa", sortOrder: 9 },
      { name: "Dish Antenna Alignment", icon: "\ud83d\udcfa", sortOrder: 10 },
      { name: "Set Top Box Setup", icon: "\ud83d\udcfa", sortOrder: 11 },
      { name: "Home Theatre Installation", icon: "\ud83d\udcfa", sortOrder: 12 },
      { name: "Speaker Installation", icon: "\ud83d\udcfa", sortOrder: 13 },
      { name: "Sound System Setup", icon: "\ud83d\udcfa", sortOrder: 14 },
    ],
  },
  {
    name: "Mobile, Computer & Digital", icon: "\ud83d\udcf1", sortOrder: 7,
    children: [
      { name: "Mobile Repair", icon: "\ud83d\udcf1", sortOrder: 1 },
      { name: "Display Replacement", icon: "\ud83d\udcf1", sortOrder: 2 },
      { name: "Battery Replacement", icon: "\ud83d\udcf1", sortOrder: 3 },
      { name: "Charging Port Repair", icon: "\ud83d\udcf1", sortOrder: 4 },
      { name: "Mobile Software Repair", icon: "\ud83d\udcf1", sortOrder: 5 },
      { name: "Laptop Repair", icon: "\ud83d\udcf1", sortOrder: 6 },
      { name: "Computer Repair", icon: "\ud83d\udcf1", sortOrder: 7 },
      { name: "Desktop Repair", icon: "\ud83d\udcf1", sortOrder: 8 },
      { name: "Printer Repair", icon: "\ud83d\udcf1", sortOrder: 9 },
      { name: "Scanner Repair", icon: "\ud83d\udcf1", sortOrder: 10 },
      { name: "Computer Networking", icon: "\ud83d\udcf1", sortOrder: 11 },
      { name: "Wi-Fi Setup", icon: "\ud83d\udcf1", sortOrder: 12 },
      { name: "CCTV Networking", icon: "\ud83d\udcf1", sortOrder: 13 },
      { name: "Internet Device Setup", icon: "\ud83d\udcf1", sortOrder: 14 },
    ],
  },
  {
    name: "Digital & Creator Services", icon: "\ud83c\udfac", sortOrder: 8,
    children: [
      { name: "YouTube Channel Setup", icon: "\ud83c\udfac", sortOrder: 1 },
      { name: "YouTube Channel Management", icon: "\ud83c\udfac", sortOrder: 2 },
      { name: "YouTube Video Editing", icon: "\ud83c\udfac", sortOrder: 3 },
      { name: "YouTube Shorts Editing", icon: "\ud83c\udfac", sortOrder: 4 },
      { name: "YouTube Thumbnail Designer", icon: "\ud83c\udfac", sortOrder: 5 },
      { name: "YouTube SEO", icon: "\ud83c\udfac", sortOrder: 6 },
      { name: "YouTube Script Writing", icon: "\ud83c\udfac", sortOrder: 7 },
      { name: "YouTube Voice Over", icon: "\ud83c\udfac", sortOrder: 8 },
      { name: "YouTube Channel Audit", icon: "\ud83c\udfac", sortOrder: 9 },
      { name: "Video Editor", icon: "\ud83c\udfac", sortOrder: 10 },
      { name: "Reels Editing", icon: "\ud83c\udfac", sortOrder: 11 },
      { name: "Shorts Editing", icon: "\ud83c\udfac", sortOrder: 12 },
      { name: "Wedding Video Editing", icon: "\ud83c\udfac", sortOrder: 13 },
      { name: "Event Video Editing", icon: "\ud83c\udfac", sortOrder: 14 },
      { name: "Promotional Video Editing", icon: "\ud83c\udfac", sortOrder: 15 },
      { name: "Motion Graphics", icon: "\ud83c\udfac", sortOrder: 16 },
      { name: "Color Grading", icon: "\ud83c\udfac", sortOrder: 17 },
      { name: "Subtitle Editing", icon: "\ud83c\udfac", sortOrder: 18 },
      { name: "Graphic Designer", icon: "\ud83c\udfac", sortOrder: 19 },
      { name: "Logo Designer", icon: "\ud83c\udfac", sortOrder: 20 },
      { name: "Poster Designer", icon: "\ud83c\udfac", sortOrder: 21 },
      { name: "Banner Designer", icon: "\ud83c\udfac", sortOrder: 22 },
      { name: "Flyer Designer", icon: "\ud83c\udfac", sortOrder: 23 },
      { name: "Brochure Designer", icon: "\ud83c\udfac", sortOrder: 24 },
      { name: "Visiting Card Designer", icon: "\ud83c\udfac", sortOrder: 25 },
      { name: "Thumbnail Designer", icon: "\ud83c\udfac", sortOrder: 26 },
      { name: "Social Media Manager", icon: "\ud83c\udfac", sortOrder: 27 },
      { name: "Instagram Management", icon: "\ud83c\udfac", sortOrder: 28 },
      { name: "Facebook Page Management", icon: "\ud83c\udfac", sortOrder: 29 },
      { name: "Social Media Posting", icon: "\ud83c\udfac", sortOrder: 30 },
      { name: "Reels Creation", icon: "\ud83c\udfac", sortOrder: 31 },
      { name: "Community Management", icon: "\ud83c\udfac", sortOrder: 32 },
      { name: "Digital Marketing", icon: "\ud83c\udfac", sortOrder: 33 },
      { name: "SEO", icon: "\ud83c\udfac", sortOrder: 34 },
      { name: "Local SEO", icon: "\ud83c\udfac", sortOrder: 35 },
      { name: "Lead Generation", icon: "\ud83c\udfac", sortOrder: 36 },
      { name: "Google Business Profile Assistance", icon: "\ud83c\udfac", sortOrder: 37 },
      { name: "Marketing Strategy", icon: "\ud83c\udfac", sortOrder: 38 },
      { name: "Website Developer", icon: "\ud83c\udfac", sortOrder: 39 },
      { name: "Website Designer", icon: "\ud83c\udfac", sortOrder: 40 },
      { name: "WordPress Developer", icon: "\ud83c\udfac", sortOrder: 41 },
      { name: "E-commerce Website Developer", icon: "\ud83c\udfac", sortOrder: 42 },
      { name: "Frontend Developer", icon: "\ud83c\udfac", sortOrder: 43 },
      { name: "Backend Developer", icon: "\ud83c\udfac", sortOrder: 44 },
      { name: "Full Stack Developer", icon: "\ud83c\udfac", sortOrder: 45 },
      { name: "Android App Developer", icon: "\ud83c\udfac", sortOrder: 46 },
      { name: "UI/UX Designer", icon: "\ud83c\udfac", sortOrder: 47 },
    ],
  },
  {
    name: "Wedding & Marriage", icon: "\ud83d\udc8d", sortOrder: 9,
    children: [
      { name: "Wedding Planner", icon: "\ud83d\udc8d", sortOrder: 1 },
      { name: "Event Management", icon: "\ud83d\udc8d", sortOrder: 2 },
      { name: "Wedding Coordinator", icon: "\ud83d\udc8d", sortOrder: 3 },
      { name: "Wedding Photographer", icon: "\ud83d\udc8d", sortOrder: 4 },
      { name: "Wedding Videographer", icon: "\ud83d\udc8d", sortOrder: 5 },
      { name: "Pre-Wedding Photography", icon: "\ud83d\udc8d", sortOrder: 6 },
      { name: "Wedding Decoration", icon: "\ud83d\udc8d", sortOrder: 7 },
      { name: "Stage Decoration", icon: "\ud83d\udc8d", sortOrder: 8 },
      { name: "Flower Decoration", icon: "\ud83d\udc8d", sortOrder: 9 },
      { name: "Lighting Decoration", icon: "\ud83d\udc8d", sortOrder: 10 },
      { name: "Tent House", icon: "\ud83d\udc8d", sortOrder: 11 },
      { name: "Wedding Samaan Rental", icon: "\ud83d\udc8d", sortOrder: 12 },
      { name: "Chair Rental", icon: "\ud83d\udc8d", sortOrder: 13 },
      { name: "Table Rental", icon: "\ud83d\udc8d", sortOrder: 14 },
      { name: "Stage Rental", icon: "\ud83d\udc8d", sortOrder: 15 },
      { name: "Wedding Catering", icon: "\ud83d\udc8d", sortOrder: 16 },
      { name: "Catering Staff", icon: "\ud83d\udc8d", sortOrder: 17 },
      { name: "Wedding Helpers", icon: "\ud83d\udc8d", sortOrder: 18 },
    ],
  },
  {
    name: "Vehicle Services", icon: "\ud83d\ude97", sortOrder: 10,
    children: [
      { name: "Bike Mechanic", icon: "\ud83d\ude97", sortOrder: 1 },
      { name: "Bike Servicing", icon: "\ud83d\ude97", sortOrder: 2 },
      { name: "Bike Washing", icon: "\ud83d\ude97", sortOrder: 3 },
      { name: "Puncture Repair", icon: "\ud83d\ude97", sortOrder: 4 },
      { name: "Car Mechanic", icon: "\ud83d\ude97", sortOrder: 5 },
      { name: "Car Servicing", icon: "\ud83d\ude97", sortOrder: 6 },
      { name: "Car Washing", icon: "\ud83d\ude97", sortOrder: 7 },
      { name: "Vehicle Detailing", icon: "\ud83d\ude97", sortOrder: 8 },
      { name: "Denting & Painting", icon: "\ud83d\ude97", sortOrder: 9 },
      { name: "Battery Service", icon: "\ud83d\ude97", sortOrder: 10 },
      { name: "Towing Service", icon: "\ud83d\ude97", sortOrder: 11 },
      { name: "Tyre Repair", icon: "\ud83d\ude97", sortOrder: 12 },
      { name: "Oil Change", icon: "\ud83d\ude97", sortOrder: 13 },
      { name: "Driver on Demand", icon: "\ud83d\ude97", sortOrder: 14 },
    ],
  },
  {
    name: "Carpenter & Furniture", icon: "\ud83e\ude9a", sortOrder: 11,
    children: [
      { name: "Carpenter", icon: "\ud83e\ude9a", sortOrder: 1 },
      { name: "Door Repair", icon: "\ud83e\ude9a", sortOrder: 2 },
      { name: "Window Repair", icon: "\ud83e\ude9a", sortOrder: 3 },
      { name: "Woodwork", icon: "\ud83e\ude9a", sortOrder: 4 },
      { name: "Furniture Repair", icon: "\ud83e\ude9a", sortOrder: 5 },
      { name: "Furniture Making", icon: "\ud83e\ude9a", sortOrder: 6 },
      { name: "Sofa Repair", icon: "\ud83e\ude9a", sortOrder: 7 },
      { name: "Bed Making", icon: "\ud83e\ude9a", sortOrder: 8 },
      { name: "Table Making", icon: "\ud83e\ude9a", sortOrder: 9 },
      { name: "Chair Repair", icon: "\ud83e\ude9a", sortOrder: 10 },
      { name: "Modular Kitchen", icon: "\ud83e\ude9a", sortOrder: 11 },
      { name: "Wardrobe Making", icon: "\ud83e\ude9a", sortOrder: 12 },
      { name: "Furniture Polishing", icon: "\ud83e\ude9a", sortOrder: 13 },
    ],
  },
  {
    name: "Construction & Home Improvement", icon: "\ud83c\udfe0", sortOrder: 12,
    children: [
      { name: "Wall Painting", icon: "\ud83c\udfe0", sortOrder: 1 },
      { name: "Interior Painting", icon: "\ud83c\udfe0", sortOrder: 2 },
      { name: "Exterior Painting", icon: "\ud83c\udfe0", sortOrder: 3 },
      { name: "Tile Work", icon: "\ud83c\udfe0", sortOrder: 4 },
      { name: "Marble Work", icon: "\ud83c\udfe0", sortOrder: 5 },
      { name: "Granite Work", icon: "\ud83c\udfe0", sortOrder: 6 },
      { name: "POP Work", icon: "\ud83c\udfe0", sortOrder: 7 },
      { name: "False Ceiling", icon: "\ud83c\udfe0", sortOrder: 8 },
      { name: "Waterproofing", icon: "\ud83c\udfe0", sortOrder: 9 },
      { name: "Roofing", icon: "\ud83c\udfe0", sortOrder: 10 },
      { name: "Welding", icon: "\ud83c\udfe0", sortOrder: 11 },
      { name: "Grill Work", icon: "\ud83c\udfe0", sortOrder: 12 },
      { name: "Gate Work", icon: "\ud83c\udfe0", sortOrder: 13 },
      { name: "Aluminium Work", icon: "\ud83c\udfe0", sortOrder: 14 },
      { name: "Glass Work", icon: "\ud83c\udfe0", sortOrder: 15 },
      { name: "UPVC Work", icon: "\ud83c\udfe0", sortOrder: 16 },
      { name: "Interior Design", icon: "\ud83c\udfe0", sortOrder: 17 },
    ],
  },
  {
    name: "Transport & Moving", icon: "\ud83d\ude9a", sortOrder: 13,
    children: [
      { name: "Packers & Movers", icon: "\ud83d\ude9a", sortOrder: 1 },
      { name: "House Shifting", icon: "\ud83d\ude9a", sortOrder: 2 },
      { name: "Office Shifting", icon: "\ud83d\ude9a", sortOrder: 3 },
      { name: "Furniture Shifting", icon: "\ud83d\ude9a", sortOrder: 4 },
      { name: "Loading & Unloading", icon: "\ud83d\ude9a", sortOrder: 5 },
      { name: "Labour Service", icon: "\ud83d\ude9a", sortOrder: 6 },
      { name: "Helper Service", icon: "\ud83d\ude9a", sortOrder: 7 },
      { name: "Mini Truck", icon: "\ud83d\ude9a", sortOrder: 8 },
      { name: "Pickup Service", icon: "\ud83d\ude9a", sortOrder: 9 },
      { name: "Delivery Service", icon: "\ud83d\ude9a", sortOrder: 10 },
      { name: "Courier Service", icon: "\ud83d\ude9a", sortOrder: 11 },
    ],
  },
  {
    name: "Event & Entertainment", icon: "\ud83c\udf89", sortOrder: 14,
    children: [
      { name: "DJ", icon: "\ud83c\udf89", sortOrder: 1 },
      { name: "Sound System", icon: "\ud83c\udf89", sortOrder: 2 },
      { name: "Singer", icon: "\ud83c\udf89", sortOrder: 3 },
      { name: "Musician", icon: "\ud83c\udf89", sortOrder: 4 },
      { name: "Balloon Decoration", icon: "\ud83c\udf89", sortOrder: 5 },
      { name: "Event Lighting", icon: "\ud83c\udf89", sortOrder: 6 },
      { name: "Anchor", icon: "\ud83c\udf89", sortOrder: 7 },
      { name: "Dance Group", icon: "\ud83c\udf89", sortOrder: 8 },
      { name: "Choreographer", icon: "\ud83c\udf89", sortOrder: 9 },
      { name: "Magic Show", icon: "\ud83c\udf89", sortOrder: 10 },
      { name: "Kids Entertainment", icon: "\ud83c\udf89", sortOrder: 11 },
    ],
  },
  {
    name: "Education & Training", icon: "\ud83d\udcda", sortOrder: 15,
    children: [
      { name: "Home Tutor", icon: "\ud83d\udcda", sortOrder: 1 },
      { name: "Maths Tutor", icon: "\ud83d\udcda", sortOrder: 2 },
      { name: "Science Tutor", icon: "\ud83d\udcda", sortOrder: 3 },
      { name: "English Tutor", icon: "\ud83d\udcda", sortOrder: 4 },
      { name: "Hindi Tutor", icon: "\ud83d\udcda", sortOrder: 5 },
      { name: "Computer Tutor", icon: "\ud83d\udcda", sortOrder: 6 },
      { name: "Spoken English", icon: "\ud83d\udcda", sortOrder: 7 },
      { name: "Music Teacher", icon: "\ud83d\udcda", sortOrder: 8 },
      { name: "Guitar Teacher", icon: "\ud83d\udcda", sortOrder: 9 },
      { name: "Dance Teacher", icon: "\ud83d\udcda", sortOrder: 10 },
      { name: "Drawing Teacher", icon: "\ud83d\udcda", sortOrder: 11 },
      { name: "Competitive Exam Tutor", icon: "\ud83d\udcda", sortOrder: 12 },
    ],
  },
  {
    name: "Fitness & Wellness", icon: "\ud83c\udfcb\ufe0f", sortOrder: 16,
    children: [
      { name: "Personal Trainer", icon: "\ud83c\udfcb\ufe0f", sortOrder: 1 },
      { name: "Fitness Trainer", icon: "\ud83c\udfcb\ufe0f", sortOrder: 2 },
      { name: "Yoga Trainer", icon: "\ud83c\udfcb\ufe0f", sortOrder: 3 },
      { name: "Meditation Trainer", icon: "\ud83c\udfcb\ufe0f", sortOrder: 4 },
      { name: "Zumba Trainer", icon: "\ud83c\udfcb\ufe0f", sortOrder: 5 },
    ],
  },
  {
    name: "Professional & Freelance", icon: "\ud83d\udcbc", sortOrder: 17,
    children: [
      { name: "Accountant", icon: "\ud83d\udcbc", sortOrder: 1 },
      { name: "Tax Consultant", icon: "\ud83d\udcbc", sortOrder: 2 },
      { name: "Business Consultant", icon: "\ud83d\udcbc", sortOrder: 3 },
      { name: "Data Entry", icon: "\ud83d\udcbc", sortOrder: 4 },
      { name: "Computer Operator", icon: "\ud83d\udcbc", sortOrder: 5 },
      { name: "Virtual Assistant", icon: "\ud83d\udcbc", sortOrder: 6 },
      { name: "Resume/CV Maker", icon: "\ud83d\udcbc", sortOrder: 7 },
      { name: "Translator", icon: "\ud83d\udcbc", sortOrder: 8 },
      { name: "Freelance Services", icon: "\ud83d\udcbc", sortOrder: 9 },
    ],
  },
  {
    name: "Pets & Animal Care", icon: "\ud83d\udc3e", sortOrder: 18,
    children: [
      { name: "Pet Grooming", icon: "\ud83d\udc3e", sortOrder: 1 },
      { name: "Pet Care", icon: "\ud83d\udc3e", sortOrder: 2 },
      { name: "Dog Walker", icon: "\ud83d\udc3e", sortOrder: 3 },
      { name: "Pet Sitting", icon: "\ud83d\udc3e", sortOrder: 4 },
      { name: "Pet Boarding", icon: "\ud83d\udc3e", sortOrder: 5 },
      { name: "Animal Care", icon: "\ud83d\udc3e", sortOrder: 6 },
    ],
  },
  {
    name: "Gardening & Agriculture", icon: "\ud83c\udf31", sortOrder: 19,
    children: [
      { name: "Gardening", icon: "\ud83c\udf31", sortOrder: 1 },
      { name: "Lawn Maintenance", icon: "\ud83c\udf31", sortOrder: 2 },
      { name: "Plant Care", icon: "\ud83c\udf31", sortOrder: 3 },
      { name: "Tree Trimming", icon: "\ud83c\udf31", sortOrder: 4 },
      { name: "Landscaping", icon: "\ud83c\udf31", sortOrder: 5 },
      { name: "Nursery Service", icon: "\ud83c\udf31", sortOrder: 6 },
      { name: "Farm Labour", icon: "\ud83c\udf31", sortOrder: 7 },
      { name: "Agricultural Labour", icon: "\ud83c\udf31", sortOrder: 8 },
      { name: "Tractor Service", icon: "\ud83c\udf31", sortOrder: 9 },
    ],
  },
  {
    name: "Security & Technical", icon: "\ud83d\udee1\ufe0f", sortOrder: 20,
    children: [
      { name: "Security Guard", icon: "\ud83d\udee1\ufe0f", sortOrder: 1 },
      { name: "CCTV Installation", icon: "\ud83d\udee1\ufe0f", sortOrder: 2 },
      { name: "CCTV Repair", icon: "\ud83d\udee1\ufe0f", sortOrder: 3 },
      { name: "Alarm Installation", icon: "\ud83d\udee1\ufe0f", sortOrder: 4 },
      { name: "DVR/NVR Setup", icon: "\ud83d\udee1\ufe0f", sortOrder: 5 },
      { name: "Smart Lock Installation", icon: "\ud83d\udee1\ufe0f", sortOrder: 6 },
      { name: "Intercom Installation", icon: "\ud83d\udee1\ufe0f", sortOrder: 7 },
      { name: "Video Doorbell Installation", icon: "\ud83d\udee1\ufe0f", sortOrder: 8 },
      { name: "Home Automation", icon: "\ud83d\udee1\ufe0f", sortOrder: 9 },
    ],
  },
  {
    name: "Local & Personal Services", icon: "\ud83d\udccb", sortOrder: 21,
    children: [
      { name: "Locksmith", icon: "\ud83d\udccb", sortOrder: 1 },
      { name: "Key Maker", icon: "\ud83d\udccb", sortOrder: 2 },
      { name: "Tailor", icon: "\ud83d\udccb", sortOrder: 3 },
      { name: "Boutique", icon: "\ud83d\udccb", sortOrder: 4 },
      { name: "Shoe Repair", icon: "\ud83d\udccb", sortOrder: 5 },
      { name: "Watch Repair", icon: "\ud83d\udccb", sortOrder: 6 },
      { name: "Printing Service", icon: "\ud83d\udccb", sortOrder: 7 },
      { name: "Xerox Service", icon: "\ud83d\udccb", sortOrder: 8 },
      { name: "Passport Photo", icon: "\ud83d\udccb", sortOrder: 9 },
      { name: "Computer Cafe", icon: "\ud83d\udccb", sortOrder: 10 },
    ],
  },
];
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
    category: 'deep-home-cleaning', pin: '600017', business: 'Chennai Sparkle Services', contact: 'Karthik Raja',
    phone: '9000000006', experience: 6, verified: false, rating: 4.2, ratingCount: 19,
    about: 'Full-home deep cleaning with a four-member trained team.',
    areas: ['600017', '600020', '600042'],
    services: [{ title: '2BHK full home deep cleaning', min: 3500, max: 4500, unit: 'job', status: 'active' }],
  },
  {
    category: 'ac-repair', pin: '110024', business: 'Cool Care Delhi', contact: 'Mohit Verma',
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
    category: 'accountant', pin: '226001', business: 'Sharma & Associates CA', contact: 'CA Rahul Sharma',
    phone: '9000000010', experience: 14, verified: true, rating: 4.8, ratingCount: 48,
    about: 'ITR filing, GST registration and small-business bookkeeping.',
    areas: ['226001', '226010', '201301'],
    services: [{ title: 'Individual ITR filing', min: 1000, max: 2500, unit: 'job', status: 'active' }],
  },
];

module.exports = { categories, geography, providers };
