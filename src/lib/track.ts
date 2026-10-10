import { doseUg, effortFromSpeed } from './zones';

export type ActivityType = 'walk' | 'run';

export interface TrackPoint {
  lat: number;
  lon: number;
  /** epoch ms */
  t: number;
  /** GPS accuracy in metres */
  acc: number;
  /** Segment index; increments after each pause so we don't join gaps */
  seg: number;
}

export interface AqiSample {
  t: number;
  lat: number;
  lon: number;
  usAqi: number | null;
  pm25: number | null;
}

export interface Activity {
  id: string;
  type: ActivityType;
  startedAt: number;
  endedAt: number;
  points: TrackPoint[];
  samples: AqiSample[];
}

export interface Summary {
  distanceM: number;
  movingS: number;
  doseUg: number;
  avgAqi: number | null;
  maxAqi: number | null;
}

const EARTH_R = 6371000;
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/** AQI sample in effect at time t (latest sample at or before t, else the first one). */
export function sampleAt(samples: AqiSample[], t: number): AqiSample | undefined {
  let found: AqiSample | undefined = samples[0];
  for (const s of samples) {
    if (s.t <= t) found = s;
    else break;
  }
  return found;
}

export function summarize(points: TrackPoint[], samples: AqiSample[]): Summary {
  let distanceM = 0;
  let movingS = 0;
  let dose = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.seg !== b.seg) continue;
    const d = haversineM(a, b);
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    const kmh = (d / dt) * 3.6;
    distanceM += d;
    if (kmh >= 1) movingS += dt;
    const pm25 = sampleAt(samples, b.t)?.pm25;
    if (pm25 != null) dose += doseUg(effortFromSpeed(kmh), dt, pm25);
  }
  const aqis = samples.map((s) => s.usAqi).filter((v): v is number => v != null);
  return {
    distanceM,
    movingS,
    doseUg: dose,
    avgAqi: aqis.length ? Math.round(aqis.reduce((x, y) => x + y, 0) / aqis.length) : null,
    maxAqi: aqis.length ? Math.max(...aqis) : null,
  };
}

/** Speed over roughly the last `windowS` seconds of the current segment. */
export function recentSpeedKmh(points: TrackPoint[], windowS = 30): number | null {
  const last = points[points.length - 1];
  if (!last) return null;
  let i = points.length - 1;
  let d = 0;
  while (i > 0 && points[i - 1].seg === last.seg && (last.t - points[i - 1].t) / 1000 <= windowS) {
    d += haversineM(points[i - 1], points[i]);
    i--;
  }
  const dt = (last.t - points[i].t) / 1000;
  return dt >= 5 ? (d / dt) * 3.6 : null;
}

export function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

export function formatPace(distanceM: number, movingS: number): string {
  if (distanceM < 50 || movingS <= 0) return '–';
  const secPerKm = movingS / (distanceM / 1000);
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')} /km`;
}

// ---- persistence (localStorage, stays on the device) ----
const STORAGE_KEY = 'hazerun.activities.v1';

export function loadActivities(): Activity[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as Activity[]) : [];
  } catch {
    return [];
  }
}

export function saveActivities(list: Activity[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Quota exceeded or storage disabled; activity stays in memory only.
  }
}
