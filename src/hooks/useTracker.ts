import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPointAir } from '../lib/aqi';
import { haversineM, type Activity, type ActivityType, type AqiSample, type TrackPoint } from '../lib/track';

export type TrackStatus = 'idle' | 'tracking' | 'paused';

const MAX_ACCURACY_M = 35; // ignore fixes worse than this
const MIN_STEP_M = 3; // ignore GPS jitter while standing still
const MAX_SPEED_KMH = 40; // anything faster is a GPS jump for a walk/run
const AQI_EVERY_MS = 10 * 60 * 1000; // re-sample air every 10 min...
const AQI_EVERY_M = 1500; // ...or every 1.5 km, whichever comes first

interface WakeLockLike {
  release: () => Promise<void>;
}

export function useTracker(type: ActivityType, onFinish: (a: Activity) => void) {
  const [status, setStatus] = useState<TrackStatus>('idle');
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [samples, setSamples] = useState<AqiSample[]>([]);
  const [current, setCurrent] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const watchId = useRef<number | null>(null);
  const seg = useRef(0);
  const startedAt = useRef(0);
  const pointsRef = useRef<TrackPoint[]>([]);
  const samplesRef = useRef<AqiSample[]>([]);
  const sampling = useRef(false);
  const wakeLock = useRef<WakeLockLike | null>(null);

  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const sampleAir = useCallback(async (lat: number, lon: number, t: number) => {
    if (sampling.current) return;
    sampling.current = true;
    try {
      const air = await fetchPointAir(lat, lon);
      const s: AqiSample = { t, lat, lon, ...air };
      samplesRef.current = [...samplesRef.current, s];
      setSamples(samplesRef.current);
    } catch {
      // Offline or API down: keep tracking, retry on next point.
    } finally {
      sampling.current = false;
    }
  }, []);

  const handlePosition = useCallback(
    (pos: GeolocationPosition) => {
      setCurrent(pos);
      setError(null);
      const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
      if (acc > MAX_ACCURACY_M) return;

      const p: TrackPoint = { lat, lon, acc, t: pos.timestamp, seg: seg.current };
      const prev = pointsRef.current[pointsRef.current.length - 1];
      if (prev && prev.seg === p.seg) {
        const d = haversineM(prev, p);
        const dt = (p.t - prev.t) / 1000;
        if (d < MIN_STEP_M) return;
        if (dt > 0 && (d / dt) * 3.6 > MAX_SPEED_KMH) return;
      }
      pointsRef.current = [...pointsRef.current, p];
      setPoints(pointsRef.current);

      const lastSample = samplesRef.current[samplesRef.current.length - 1];
      if (!lastSample || p.t - lastSample.t > AQI_EVERY_MS || haversineM(lastSample, p) > AQI_EVERY_M) {
        void sampleAir(lat, lon, p.t);
      }
    },
    [sampleAir],
  );

  const handleError = useCallback((err: GeolocationPositionError) => {
    const msg =
      err.code === err.PERMISSION_DENIED
        ? 'Location permission denied. Allow location access for this site to track.'
        : err.code === err.POSITION_UNAVAILABLE
          ? 'GPS signal unavailable. Try moving to an open area.'
          : 'Waiting for GPS…';
    setError(msg);
  }, []);

  const startWatch = useCallback(() => {
    watchId.current = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });
    // Keep the screen awake; browsers pause GPS when the page is hidden.
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } }).wakeLock;
    wl?.request('screen').then((l) => (wakeLock.current = l)).catch(() => {});
  }, [handlePosition, handleError]);

  const stopWatch = useCallback(() => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }, []);

  const start = useCallback(() => {
    if (!supported) return setError('This browser has no GPS/geolocation support.');
    if (!window.isSecureContext) return setError('Tracking needs HTTPS (or localhost) for location access.');
    pointsRef.current = [];
    samplesRef.current = [];
    seg.current = 0;
    startedAt.current = Date.now();
    setPoints([]);
    setSamples([]);
    setStatus('tracking');
    startWatch();
  }, [supported, startWatch]);

  const pause = useCallback(() => {
    stopWatch();
    setStatus('paused');
  }, [stopWatch]);

  const resume = useCallback(() => {
    seg.current += 1;
    setStatus('tracking');
    startWatch();
  }, [startWatch]);

  const reset = useCallback(() => {
    stopWatch();
    pointsRef.current = [];
    samplesRef.current = [];
    setPoints([]);
    setSamples([]);
    setStatus('idle');
  }, [stopWatch]);

  const finish = useCallback(() => {
    if (pointsRef.current.length >= 2) {
      onFinish({
        id: `${startedAt.current}`,
        type,
        startedAt: startedAt.current,
        endedAt: Date.now(),
        points: pointsRef.current,
        samples: samplesRef.current,
      });
    }
    reset();
  }, [onFinish, reset, type]);

  // Ticker for the elapsed clock.
  useEffect(() => {
    if (status !== 'tracking') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Re-acquire wake lock when the tab becomes visible again.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && status === 'tracking' && !wakeLock.current) {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } }).wakeLock;
        wl?.request('screen').then((l) => (wakeLock.current = l)).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [status]);

  useEffect(() => stopWatch, [stopWatch]);

  return { status, points, samples, current, error, now, supported, start, pause, resume, finish, reset };
}
