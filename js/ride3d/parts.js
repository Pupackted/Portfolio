/*
 * The taxonomy that turns node names in ridecheck-car.glb into a browsable UI.
 *
 * The model is the same asset the iOS app ships (RideCheckCar.usdz, converted
 * to glTF for the web), so the naming convention is the app's, not ours:
 *
 *   SHELL_*          body, hood, interior, bay liner — scenery, never tappable
 *   GRP_<assembly>   an assembly that explodes as a unit
 *   PART_<component> a tracked component; the thing a rider actually replaces
 *   PART_*_static    a housing that explodes with its group but carries no label
 *
 * Corner-scoped nodes end in _FL / _FR / _RL / _RR. All four corners explode
 * together and only the front-left set is labelled, so the canvas never fills
 * with four copies of "Brake Pads".
 */

export const CORNERS = ['FL', 'FR', 'RL', 'RR'];

/* Cosmetic paint, mirroring the app's own picker, tuned for a dark stage. */
export const PAINTS = [
  { id: 'graphite', hex: '#333B47', label: 'Graphite' },
  { id: 'silver', hex: '#9BA3AE', label: 'Silver' },
  { id: 'blue', hex: '#1E4FA3', label: 'Deep Blue' },
  { id: 'red', hex: '#8E1B18', label: 'Racing Red' },
];

export const PARTS = {
  PART_engineOil: {
    label: 'Engine Oil',
    blurb: 'The single most-missed service. RideCheck counts it down by distance and by time, whichever runs out first.',
    interval: 'Every 5,000 – 10,000 km',
  },
  PART_engineOilFilter: {
    label: 'Oil Filter',
    blurb: 'Catches the metal the oil picks up. Skipped filters are why fresh oil goes dark in a week.',
    interval: 'Every 10,000 km',
  },
  PART_sparkPlug: {
    label: 'Spark Plugs',
    blurb: 'Worn plugs show up as a rough idle and a heavier thirst long before they actually fail.',
    interval: 'Every 20,000 – 40,000 km',
  },
  PART_timingBelt: {
    label: 'Timing Belt',
    blurb: 'The one component where “I’ll do it next month” can cost an engine. Tracked to the kilometre.',
    interval: 'Every 60,000 – 100,000 km',
  },
  PART_coolant: {
    label: 'Coolant',
    blurb: 'Old coolant stops carrying heat away long before the level drops. Time-based, not level-based.',
    interval: 'Every 2 years',
  },
  PART_airFilter: {
    label: 'Air Filter',
    blurb: 'A clogged filter is the cheapest fix for a vehicle that suddenly feels slow and thirsty.',
    interval: 'Every 10,000 – 20,000 km',
  },
  PART_brakeFluid: {
    label: 'Brake Fluid',
    blurb: 'Absorbs water from the air over time, which is what makes the pedal go soft on a long descent.',
    interval: 'Every 2 years',
  },
  PART_powerSteeringFluid: {
    label: 'Power Steering Fluid',
    blurb: 'Whining on full lock is the last warning, not the first. RideCheck gets there earlier.',
    interval: 'Every 60,000 km',
  },
  PART_battery12v: {
    label: '12V Battery',
    blurb: 'Batteries die on age, not mileage — so this one is counted in months from the day it went in.',
    interval: 'Every 3 – 5 years',
  },
  PART_cabinAirFilter: {
    label: 'Cabin Air Filter',
    blurb: 'The reason the AC smells. Two minutes to swap, and almost nobody remembers it exists.',
    interval: 'Every 15,000 km',
  },
  PART_wiperBlades: {
    label: 'Wiper Blades',
    blurb: 'Rubber perishes in the sun whether you drive or not, so this is a calendar item.',
    interval: 'Every 12 months',
  },
  PART_tire: {
    label: 'Tires',
    blurb: 'The only part touching the road. Tracked per corner, because they never wear evenly.',
    interval: 'Every 40,000 km or 5 years',
  },
  PART_brakePads: {
    label: 'Brake Pads',
    blurb: 'Wear depends entirely on how you drive, so RideCheck learns from your actual distance.',
    interval: 'Every 15,000 – 30,000 km',
  },
  PART_brakeDisks: {
    label: 'Brake Discs',
    blurb: 'Outlast two or three sets of pads — which is exactly why the interval is so easy to lose track of.',
    interval: 'Every 30,000 – 50,000 km',
  },
  PART_shockBreakerFluid: {
    label: 'Shock Absorbers',
    blurb: 'Fade so gradually that the ride feels normal right up until the rear steps out mid-corner.',
    interval: 'Every 50,000 km',
  },
  PART_transmissionOil: {
    label: 'Transmission Oil',
    blurb: 'Rarely on anyone’s list, and the reason shifting turns notchy after a few years.',
    interval: 'Every 20,000 – 40,000 km',
  },
  PART_transmissionGear: {
    label: 'Transmission Gears',
    blurb: 'Inspected rather than replaced — RideCheck schedules the check so it never silently lapses.',
    interval: 'Inspect every 60,000 km',
  },
  PART_clutchAssembly: {
    label: 'Clutch Assembly',
    blurb: 'Slipping under load is the symptom everyone recognises far too late to be cheap.',
    interval: 'Every 40,000 – 80,000 km',
  },
  PART_fuelFilter: {
    label: 'Fuel Filter',
    blurb: 'Quietly starves the engine as it clogs. Cheap to change, expensive to ignore.',
    interval: 'Every 20,000 – 40,000 km',
  },
};

export const ZONES = [
  {
    id: 'engine',
    label: 'Engine',
    groups: ['GRP_engine'],
    parts: ['PART_engineOil', 'PART_engineOilFilter', 'PART_sparkPlug', 'PART_timingBelt'],
    bodyStays: true,
  },
  {
    id: 'cooling',
    label: 'Cooling & Intake',
    groups: ['GRP_cooling', 'GRP_airIntake'],
    parts: ['PART_coolant', 'PART_airFilter'],
    bodyStays: true,
  },
  {
    id: 'fluids',
    label: 'Fluids & Battery',
    groups: ['GRP_brakeFluid', 'GRP_powerSteering', 'GRP_battery12v', 'GRP_cabinFilter', 'GRP_wipers'],
    parts: ['PART_brakeFluid', 'PART_powerSteeringFluid', 'PART_battery12v', 'PART_cabinAirFilter', 'PART_wiperBlades'],
    bodyStays: true,
  },
  {
    id: 'wheels',
    label: 'Wheels & Brakes',
    groups: [
      ...CORNERS.map((c) => `GRP_wheel_${c}`),
      ...CORNERS.map((c) => `GRP_brake_${c}`),
      ...CORNERS.map((c) => `GRP_suspension_${c}`),
    ],
    parts: ['PART_tire', 'PART_brakePads', 'PART_brakeDisks', 'PART_shockBreakerFluid'],
    corners: true,
    bodyStays: true,
  },
  {
    id: 'transmission',
    label: 'Transmission',
    groups: ['GRP_transmission'],
    parts: ['PART_transmissionOil', 'PART_transmissionGear', 'PART_clutchAssembly'],
    bodyStays: false,
  },
  {
    id: 'fuel',
    label: 'Fuel System',
    groups: ['GRP_fuelSystem'],
    parts: ['PART_fuelFilter'],
    bodyStays: false,
  },
];

/*
 * Parts that travel with a neighbour instead of fanning out on their own. The
 * oil filter sits against the sump and reads as its filler cap, so throwing it
 * off on its own vector looks like the pan shed a lid. It rides with the oil.
 */
export const BONDED_TO = {
  PART_engineOilFilter: 'PART_engineOil',
};

/** Node name → taxonomy key, dropping any corner suffix. */
export function partKeyOf(nodeName) {
  if (!nodeName.startsWith('PART_')) return null;
  if (nodeName.endsWith('_static')) return null;
  const withoutCorner = nodeName.replace(/_(FL|FR|RL|RR)$/, '');
  return PARTS[withoutCorner] ? withoutCorner : null;
}

/** Only the front-left corner is labelled. */
export function isLabelCorner(nodeName) {
  const corner = /_(FL|FR|RL|RR)$/.exec(nodeName);
  return !corner || corner[1] === 'FL';
}

export function zoneById(id) {
  return ZONES.find((zone) => zone.id === id);
}
