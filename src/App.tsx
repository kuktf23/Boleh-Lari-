import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polyline, useMap } from 'react-leaflet';
import { ROUTES, type RunningRoute } from './data/routes';
import { aqiLevel, fetchAirQuality, formatHour, type AirReading } from './lib/aqi';
import { formatHours } from './lib/format';
import { DEFAULT_PROFILE, plannedDose, verdict, type Profile } from './lib/verdict';
import { loadActivities, sampleAt, saveActivities, type Activity, type AqiSample, type TrackPoint } from './lib/track';
import { useTracker } from './hooks/useTracker';
import { Settings } from './components/Settings';
import { TrackPanel } from './components/TrackPanel';

const REFRESH_MS = 15 * 60 * 1000; // source data updates hourly
const PROFILE_KEY = 'hazerun.profile.v1';
type Tab = 'spots' | 'track';

function loadProfile(): Profile {
  try {
    return { ...DEFAULT_PROFILE, ...(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') as Partial<Profile>) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('spots');
  const [readings, setReadings] = useState<Record<string, AirReading>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [stateFilter, setStateFilter] = useState('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>(loadProfile);

  const [history, setHistory] = useState<Activity[]>(() => loadActivities());
  const [viewingId, setViewingId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }, [profile]);

  const onFinish = useCallback((a: Activity) => {
    setHistory((h) => {
      const next = [a, ...h];
      saveActivities(next);
      return next;
    });
    setViewingId(a.id);
  }, []);
  const tracker = useTracker(profile.activity, onFinish);

  const deleteActivity = useCallback((id: string) => {
    if (!window.confirm('Delete this activity? This cannot be undone.')) return;
    setHistory((h) => {
      const next = h.filter((a) => a.id !== id);
      saveActivities(next);
      return next;
    });
    setViewingId((v) => (v === id ? null : v));
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setReadings(await fetchAirQuality(ROUTES, signal));
      setUpdatedAt(new Date());
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('Couldn’t reach the air quality service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    const id = setInterval(() => load(), REFRESH_MS);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [load]);

  const states = useMemo(() => [...new Set(ROUTES.map((r) => r.state))].sort(), []);

  // Always cleanest first: that's the question people are asking.
  const visible = useMemo(
    () =>
      ROUTES.filter((r) => stateFilter === 'All' || r.state === stateFilter).sort(
        (a, b) => (readings[a.id]?.usAqi ?? Infinity) - (readings[b.id]?.usAqi ?? Infinity),
      ),
    [stateFilter, readings],
  );

  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) document.getElementById(`spot-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // Map content for the Track tab: live session, else the selected saved one.
  const tracking = tracker.status !== 'idle';
  const viewed = history.find((a) => a.id === viewingId);
  const trackPoints = tracking ? tracker.points : (viewed?.points ?? []);
  const trackSamples = tracking ? tracker.samples : (viewed?.samples ?? []);
  const here = tracker.current?.coords;
  const selectedRoute = ROUTES.find((r) => r.id === selectedId);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          Boleh Lari?
        </div>
        <nav className="tabs" aria-label="Sections">
          <button className={tab === 'spots' ? 'on' : ''} aria-current={tab === 'spots' ? 'page' : undefined} onClick={() => setTab('spots')}>
            Spots
          </button>
          <button className={tab === 'track' ? 'on' : ''} aria-current={tab === 'track' ? 'page' : undefined} onClick={() => setTab('track')}>
            Track
            {tracking && <span className="rec" role="img" aria-label="Recording" />}
          </button>
        </nav>
      </header>

      <main className="layout">
        <section className="map" aria-label="Map">
          <MapContainer center={[4.2, 108]} zoom={6} zoomControl={false} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              className="muted-tiles"
            />
            {tab === 'spots' && (
              <>
                {visible.map((r) => (
                  <SpotMarker key={r.id} route={r} reading={readings[r.id]} selected={r.id === selectedId} onSelect={select} />
                ))}
                <FlyTo target={selectedRoute ? [selectedRoute.lat, selectedRoute.lon] : null} />
              </>
            )}
            {tab === 'track' && (
              <>
                <TrackLine points={trackPoints} samples={trackSamples} />
                {tracking && here && (
                  <CircleMarker
                    center={[here.latitude, here.longitude]}
                    radius={8}
                    pathOptions={{ color: '#fff', weight: 3, fillColor: '#111827', fillOpacity: 1 }}
                  />
                )}
                <FitTrack points={trackPoints} follow={tracking} />
              </>
            )}
          </MapContainer>
        </section>

        <div className="side">
          {tab === 'spots' ? (
            <>
              <div className="toolbar">
                <label className="sr-only" htmlFor="state">
                  Area
                </label>
                <select id="state" className="select" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
                  <option value="All">All of Malaysia</option>
                  {states.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button className="icon-btn" onClick={() => load()} disabled={loading} aria-label="Refresh air quality">
                  <span className={loading ? 'spin' : ''} aria-hidden="true">
                    ↻
                  </span>
                </button>
              </div>
              <p className="hint" role="status" aria-live="polite">
                {error ? <span className="error">{error}</span> : updatedAt ? `Live AQI · updated ${updatedAt.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' })}` : 'Loading live AQI…'}
              </p>

              <Settings profile={profile} onChange={setProfile} />

              <ul className="spots" aria-label="Spots, cleanest air first">
                {visible.map((r) => (
                  <SpotCard
                    key={r.id}
                    route={r}
                    profile={profile}
                    reading={readings[r.id]}
                    loading={loading && !readings[r.id]}
                    open={r.id === selectedId}
                    onToggle={() => select(r.id === selectedId ? null : r.id)}
                  />
                ))}
              </ul>
            </>
          ) : (
            <TrackPanel
              tracker={tracker}
              profile={profile}
              onActivityChange={(a) => setProfile((p) => ({ ...p, activity: a }))}
              history={history}
              viewingId={viewingId}
              onView={setViewingId}
              onDelete={deleteActivity}
            />
          )}

          <p className="fineprint">
            AQI (US EPA scale) from{' '}
            <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noreferrer">
              Open-Meteo
            </a>
            , model estimates on an ~11 km grid. Official readings:{' '}
            <a href="https://eqms.doe.gov.my/APIMS/main" target="_blank" rel="noreferrer">
              DOE APIMS
            </a>
            . Health figures are averages, not medical advice.
          </p>
        </div>
      </main>
    </div>
  );
}

function SpotCard({
  route,
  profile,
  reading,
  loading,
  open,
  onToggle,
}: {
  route: RunningRoute;
  profile: Profile;
  reading?: AirReading;
  loading: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const aqi = reading?.usAqi ?? null;
  const level = aqiLevel(aqi);
  const v = verdict(aqi, profile);
  const dose = reading?.pm25 != null ? plannedDose(profile, reading.pm25) : null;
  const noun = profile.activity === 'walk' ? 'walk' : 'run';
  const better = reading?.bestWindow && aqi != null && reading.bestWindow.usAqi < aqi - 10 ? reading.bestWindow : null;

  return (
    <li id={`spot-${route.id}`} className={`spot${open ? ' open' : ''}`}>
      <button className="spot-head" onClick={onToggle} aria-expanded={open} aria-controls={`spot-${route.id}-detail`}>
        <span className="aqi-dot" style={{ background: level.color, color: level.textColor }} aria-label={`AQI ${aqi ?? 'unknown'}`}>
          {loading ? '·' : (aqi ?? '–')}
        </span>
        <span className="grow">
          <span className="title">{route.name}</span>
          <span className={`verdict tone-${v.tone}`}>{v.title}</span>
        </span>
        <span className="chev" aria-hidden="true" />
      </button>

      {open && (
        <div className="spot-detail" id={`spot-${route.id}-detail`}>
          <p className="muted">
            {route.city} · {route.distanceKm} km loop · {route.surface.toLowerCase()}
          </p>
          {v.detail && <p>{v.detail}</p>}
          {dose && (
            <p>
              A {profile.minutes}-min {noun} here puts about <strong>{dose.ug.toFixed(1)} µg</strong> of haze in your lungs,
              the same as sitting outside for {formatHours(dose.sittingH)}.
            </p>
          )}
          {better && (
            <p className="better">
              Cleaner {formatHour(better.time).toLowerCase()} · AQI {better.usAqi}
            </p>
          )}
          {reading && (
            <p className="muted small">
              {level.label} · PM2.5 {reading.pm25 ?? '–'} µg/m³
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function SpotMarker({
  route,
  reading,
  selected,
  onSelect,
}: {
  route: RunningRoute;
  reading?: AirReading;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const level = aqiLevel(reading?.usAqi ?? null);
  return (
    <CircleMarker
      center={[route.lat, route.lon]}
      radius={selected ? 11 : 7}
      eventHandlers={{ click: () => onSelect(route.id) }}
      pathOptions={{ color: '#fff', weight: 2, fillColor: level.color, fillOpacity: 1 }}
    />
  );
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  const key = target?.join(',');
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 12), { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** Draws the track, coloured by the AQI sample in effect for each stretch. */
function TrackLine({ points, samples }: { points: TrackPoint[]; samples: AqiSample[] }) {
  const pieces = useMemo(() => {
    const out: { color: string; coords: [number, number][] }[] = [];
    let prev: TrackPoint | undefined;
    for (const p of points) {
      const color = aqiLevel(sampleAt(samples, p.t)?.usAqi ?? null).color;
      const last = out[out.length - 1];
      if (last && prev && prev.seg === p.seg && last.color === color) {
        last.coords.push([p.lat, p.lon]);
      } else {
        const start: [number, number][] = prev && prev.seg === p.seg ? [[prev.lat, prev.lon]] : [];
        out.push({ color, coords: [...start, [p.lat, p.lon]] });
      }
      prev = p;
    }
    return out;
  }, [points, samples]);

  return (
    <>
      {pieces.map((pc, i) => (
        <Polyline key={i} positions={pc.coords} pathOptions={{ color: pc.color, weight: 5, opacity: 0.95, lineCap: 'round' }} />
      ))}
    </>
  );
}

/** Zooms to a saved track, or follows the latest point while recording. */
function FitTrack({ points, follow }: { points: TrackPoint[]; follow: boolean }) {
  const map = useMap();
  const last = points[points.length - 1];
  const first = points[0];
  useEffect(() => {
    if (!points.length) return;
    if (follow) map.setView([last.lat, last.lon], Math.max(map.getZoom(), 16), { animate: true });
    else map.fitBounds(points.map((p) => [p.lat, p.lon] as [number, number]), { padding: [30, 30] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, follow, last?.t, first?.t]);
  return null;
}
