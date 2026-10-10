/**
 * Heart-rate zone + breathing model.
 *
 * All numbers are population averages for a healthy adult and are meant for
 * relative comparison ("Zone 4 pulls in ~12x the air of sitting"), not as
 * medical advice. Sources for the ranges:
 *  - HRmax: Tanaka et al. 2001 (208 - 0.7 x age)
 *  - Minute ventilation by intensity: US EPA Exposure Factors Handbook ch. 6
 *  - Oronasal switch at ~35 L/min: Niinimaa et al. 1980
 *  - PM2.5 lung deposition rising with exercise: Daigle et al. 2003
 */

export type Breathing = 'Nose' | 'Nose + mouth' | 'Mouth';

export interface HeartZone {
  id: number;
  name: string;
  /** % of HRmax */
  low: number;
  high: number;
  /** Typical minute ventilation (litres of air per minute) */
  ventilation: number;
  breathing: Breathing;
  /** Rough fraction of inhaled PM2.5 that deposits in the airways/lungs */
  deposition: number;
  feel: string;
}

export const RESTING_VENTILATION = 7; // L/min sitting quietly
export const RESTING_DEPOSITION = 0.2;

export const ZONES: HeartZone[] = [
  { id: 1, name: 'Recovery', low: 50, high: 60, ventilation: 25, breathing: 'Nose', deposition: 0.25, feel: 'Brisk walk or easy jog, full sentences' },
  { id: 2, name: 'Aerobic base', low: 60, high: 70, ventilation: 40, breathing: 'Nose + mouth', deposition: 0.3, feel: 'Easy run, can chat' },
  { id: 3, name: 'Tempo', low: 70, high: 80, ventilation: 60, breathing: 'Mouth', deposition: 0.35, feel: 'Short phrases only' },
  { id: 4, name: 'Threshold', low: 80, high: 90, ventilation: 85, breathing: 'Mouth', deposition: 0.4, feel: 'A few words at a time' },
  { id: 5, name: 'VO2 max', low: 90, high: 100, ventilation: 120, breathing: 'Mouth', deposition: 0.45, feel: 'All-out, no talking' },
];

export function hrMax(age: number): number {
  return Math.round(208 - 0.7 * age);
}

export function zoneBpm(zone: HeartZone, max: number): [number, number] {
  return [Math.round((zone.low / 100) * max), Math.round((zone.high / 100) * max)];
}

export interface Exposure {
  /** Litres of air breathed during the run */
  litres: number;
  /** µg of PM2.5 inhaled */
  inhaledUg: number;
  /** µg of PM2.5 estimated to stay in the lungs */
  depositedUg: number;
  /** Hours sitting at this same spot that would deposit the same dose */
  restingHoursEquivalent: number;
}

export function exposure(zone: HeartZone, minutes: number, pm25: number): Exposure {
  const litres = zone.ventilation * minutes;
  const inhaledUg = (pm25 * litres) / 1000; // µg/m³ × m³
  const depositedUg = inhaledUg * zone.deposition;
  const restingDepositPerHour = (pm25 * RESTING_VENTILATION * 60 * RESTING_DEPOSITION) / 1000;
  return {
    litres,
    inhaledUg,
    depositedUg,
    restingHoursEquivalent: restingDepositPerHour > 0 ? depositedUg / restingDepositPerHour : 0,
  };
}

/**
 * Highest zone we'd suggest at a given US AQI. 0 means "train indoors".
 * Sensitive = asthma, heart/lung conditions, pregnancy, children, older adults.
 */
export function maxAdvisedZone(aqi: number | null, sensitive: boolean): number {
  if (aqi == null) return 5;
  if (aqi <= 50) return 5;
  if (aqi <= 100) return sensitive ? 3 : 5;
  if (aqi <= 150) return sensitive ? 1 : 2;
  if (aqi <= 200) return sensitive ? 0 : 1;
  return 0;
}

export function maxZoneText(zone: number): string {
  return zone === 0 ? 'Train indoors' : zone === 5 ? 'Any zone' : `Up to Zone ${zone}`;
}

export interface Effort {
  label: string;
  /** Equivalent heart zone (0 = walking below Zone 1) */
  zone: number;
  ventilation: number;
  deposition: number;
  breathing: Breathing;
}

/**
 * Estimate breathing effort from GPS speed. Used for tracked walks/runs where we
 * don't have heart-rate data. Running speed→zone varies a lot with fitness, so
 * treat this as a rough guide.
 */
export function effortFromSpeed(kmh: number): Effort {
  if (kmh < 1) return { label: 'Stopped', zone: 0, ventilation: RESTING_VENTILATION + 3, deposition: RESTING_DEPOSITION, breathing: 'Nose' };
  if (kmh < 4.5) return { label: 'Easy walk', zone: 0, ventilation: 16, deposition: 0.22, breathing: 'Nose' };
  if (kmh < 6.5) return { label: 'Brisk walk', zone: 1, ventilation: 25, deposition: 0.25, breathing: 'Nose' };
  const z = kmh < 8.5 ? 2 : kmh < 11 ? 3 : kmh < 14 ? 4 : 5;
  const zone = ZONES[z - 1];
  return { label: `${kmh < 8.5 ? 'Jog' : 'Run'} (~Z${z})`, zone: z, ventilation: zone.ventilation, deposition: zone.deposition, breathing: zone.breathing };
}

/** Deposited PM2.5 (µg) for `seconds` at a given effort and PM2.5 concentration. */
export function doseUg(effort: Effort, seconds: number, pm25: number): number {
  return ((pm25 * effort.ventilation * (seconds / 60)) / 1000) * effort.deposition;
}

/** Walking advice uses a gentler scale than running. */
export function walkAdvice(aqi: number | null, sensitive: boolean): { ok: boolean; text: string } {
  if (aqi == null) return { ok: true, text: 'No air data yet' };
  const limit = sensitive ? 100 : 150;
  if (aqi <= limit) return { ok: true, text: 'Fine for walking' };
  if (aqi <= 200) return { ok: false, text: 'Keep it short, wear an N95 if you can' };
  return { ok: false, text: 'Head indoors' };
}
