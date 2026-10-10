import type { RunningRoute } from '../data/routes';

const API_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export interface AirReading {
  time: string; // local ISO, e.g. 2026-10-10T15:00
  usAqi: number | null;
  pm25: number | null;
  pm10: number | null;
  /** Which sub-index is driving the overall AQI */
  dominant: 'PM2.5' | 'PM10' | 'Ozone' | null;
  /** Lowest-AQI hour in the next 12h during typical running hours (05:00–21:00) */
  bestWindow: { time: string; usAqi: number } | null;
}

export interface AqiLevel {
  label: string;
  color: string;
  textColor: string;
  advice: string;
}

// US EPA AQI bands, phrased for runners.
export function aqiLevel(aqi: number | null): AqiLevel {
  if (aqi == null) return { label: 'No data', color: '#9ca3af', textColor: '#111827', advice: 'Air quality data unavailable.' };
  if (aqi <= 50) return { label: 'Good', color: '#16a34a', textColor: '#ffffff', advice: 'Great conditions. Run as planned.' };
  if (aqi <= 100) return { label: 'Moderate', color: '#facc15', textColor: '#111827', advice: 'Fine for most. Sensitive runners keep it easy.' };
  if (aqi <= 150) return { label: 'Unhealthy for sensitive groups', color: '#f97316', textColor: '#111827', advice: 'Shorten the run and lower intensity. Asthma? Skip it.' };
  if (aqi <= 200) return { label: 'Unhealthy', color: '#dc2626', textColor: '#ffffff', advice: 'Move indoors. Treadmill day.' };
  if (aqi <= 300) return { label: 'Very unhealthy', color: '#7e22ce', textColor: '#ffffff', advice: 'Avoid outdoor exercise.' };
  return { label: 'Hazardous', color: '#7f1d1d', textColor: '#ffffff', advice: 'Stay indoors. Do not run outside.' };
}

type Num = number | null;
interface OpenMeteoLocation {
  current: {
    time: string;
    us_aqi: Num;
    pm2_5: Num;
    pm10: Num;
    us_aqi_pm2_5: Num;
    us_aqi_pm10: Num;
    us_aqi_ozone: Num;
  };
  hourly: { time: string[]; us_aqi: Num[] };
}

function dominantPollutant(c: OpenMeteoLocation['current']): AirReading['dominant'] {
  const candidates: [AirReading['dominant'], Num][] = [
    ['PM2.5', c.us_aqi_pm2_5],
    ['PM10', c.us_aqi_pm10],
    ['Ozone', c.us_aqi_ozone],
  ];
  let best: AirReading['dominant'] = null;
  let max = -1;
  for (const [name, v] of candidates) {
    if (v != null && v > max) {
      max = v;
      best = name;
    }
  }
  return best;
}

function findBestWindow(loc: OpenMeteoLocation): AirReading['bestWindow'] {
  const now = loc.current.time;
  const { time, us_aqi } = loc.hourly;
  const start = time.findIndex((t) => t >= now);
  if (start < 0) return null;

  let best: AirReading['bestWindow'] = null;
  for (let i = start; i < Math.min(start + 12, time.length); i++) {
    const hour = Number(time[i].slice(11, 13));
    const v = us_aqi[i];
    if (v == null || hour < 5 || hour > 21) continue;
    if (!best || v < best.usAqi) best = { time: time[i], usAqi: v };
  }
  return best;
}

/** Fetch current + short-range forecast AQI for all routes in a single request. */
export async function fetchAirQuality(routes: RunningRoute[], signal?: AbortSignal): Promise<Record<string, AirReading>> {
  const params = new URLSearchParams({
    latitude: routes.map((r) => r.lat).join(','),
    longitude: routes.map((r) => r.lon).join(','),
    current: 'us_aqi,pm2_5,pm10,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone',
    hourly: 'us_aqi',
    forecast_days: '2',
    timezone: 'Asia/Kuala_Lumpur',
  });

  const res = await fetch(`${API_URL}?${params}`, { signal });
  if (!res.ok) throw new Error(`Air quality API returned ${res.status}`);

  const body = (await res.json()) as OpenMeteoLocation | OpenMeteoLocation[];
  const locations = Array.isArray(body) ? body : [body];

  const result: Record<string, AirReading> = {};
  routes.forEach((route, i) => {
    const loc = locations[i];
    if (!loc) return;
    result[route.id] = {
      time: loc.current.time,
      usAqi: loc.current.us_aqi,
      pm25: loc.current.pm2_5,
      pm10: loc.current.pm10,
      dominant: dominantPollutant(loc.current),
      bestWindow: findBestWindow(loc),
    };
  });
  return result;
}

export function formatHour(isoLocal: string): string {
  const [date, hm] = isoLocal.split('T');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
  return `${date === today ? 'Today' : 'Tomorrow'} ${hm}`;
}

export interface PointAir {
  usAqi: number | null;
  pm25: number | null;
}

/** Current AQI at an arbitrary coordinate (used while tracking an activity). */
export async function fetchPointAir(lat: number, lon: number, signal?: AbortSignal): Promise<PointAir> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'us_aqi,pm2_5',
    timezone: 'Asia/Kuala_Lumpur',
  });
  const res = await fetch(`${API_URL}?${params}`, { signal });
  if (!res.ok) throw new Error(`Air quality API returned ${res.status}`);
  const body = (await res.json()) as { current: { us_aqi: number | null; pm2_5: number | null } };
  return { usAqi: body.current.us_aqi, pm25: body.current.pm2_5 };
}
