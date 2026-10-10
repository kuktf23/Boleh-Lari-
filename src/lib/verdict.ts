import { clamp } from './format';
import type { ActivityType } from './track';
import { RESTING_DEPOSITION, RESTING_VENTILATION, ZONES, effortFromSpeed, maxAdvisedZone } from './zones';

export interface Profile {
  activity: ActivityType;
  age: number;
  minutes: number;
  /** Planned heart-rate zone for runs (1–5) */
  zone: number;
  sensitive: boolean;
}

export const DEFAULT_PROFILE: Profile = { activity: 'run', age: 30, minutes: 45, zone: 2, sensitive: false };

export type Tone = 'good' | 'caution' | 'bad' | 'unknown';

export interface Verdict {
  tone: Tone;
  title: string;
  detail: string;
}

/** One plain-language answer to "should I go out?" for this AQI and plan. */
export function verdict(aqi: number | null, p: Pick<Profile, 'activity' | 'zone' | 'sensitive'>): Verdict {
  if (aqi == null) return { tone: 'unknown', title: 'Checking air…', detail: '' };

  if (p.activity === 'walk') {
    const limit = p.sensitive ? 100 : 150;
    if (aqi <= limit) return { tone: 'good', title: 'Good for a walk', detail: 'Enjoy it.' };
    if (aqi <= 200) return { tone: 'caution', title: 'Short walk only', detail: 'Keep it brief. An N95 mask helps.' };
    return { tone: 'bad', title: 'Stay indoors', detail: 'The haze is too thick to be outside for long.' };
  }

  const advised = maxAdvisedZone(aqi, p.sensitive);
  if (p.zone <= advised) {
    return {
      tone: 'good',
      title: 'Good for your run',
      detail: advised === 5 ? 'Any intensity is fine.' : `Fine up to Zone ${advised}.`,
    };
  }
  if (advised >= 1) {
    return {
      tone: 'caution',
      title: `Ease off to Zone ${advised}`,
      detail: `Harder efforts pull in a lot more haze. Keep it ${ZONES[advised - 1].name.toLowerCase()}.`,
    };
  }
  return { tone: 'bad', title: 'Treadmill day', detail: 'The air is too hazy for running outside.' };
}

/** Estimated PM2.5 reaching the lungs for the planned session, plus a "sitting" comparison. */
export function plannedDose(p: Profile, pm25: number): { ug: number; sittingH: number } {
  const minutes = clamp(p.minutes, 5, 300);
  const eff = p.activity === 'walk' ? effortFromSpeed(5.5) : ZONES[clamp(p.zone, 1, 5) - 1];
  const ug = ((pm25 * eff.ventilation * minutes) / 1000) * eff.deposition;
  const sittingH = (eff.ventilation * minutes * eff.deposition) / (RESTING_VENTILATION * 60 * RESTING_DEPOSITION);
  return { ug, sittingH };
}
