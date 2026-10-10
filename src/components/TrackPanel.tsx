import { aqiLevel } from '../lib/aqi';
import { formatHours } from '../lib/format';
import { formatDuration, formatPace, recentSpeedKmh, summarize, type Activity, type ActivityType } from '../lib/track';
import { verdict, type Profile } from '../lib/verdict';
import { RESTING_DEPOSITION, RESTING_VENTILATION, effortFromSpeed } from '../lib/zones';
import type { useTracker } from '../hooks/useTracker';
import { Segmented } from './Segmented';

interface Props {
  tracker: ReturnType<typeof useTracker>;
  profile: Profile;
  onActivityChange: (a: ActivityType) => void;
  history: Activity[];
  viewingId: string | null;
  onView: (id: string | null) => void;
  onDelete: (id: string) => void;
}

export function TrackPanel({ tracker, profile, onActivityChange, history, viewingId, onView, onDelete }: Props) {
  const { status, points, samples, error, start, pause, resume, finish, reset } = tracker;
  const active = status !== 'idle';
  const sum = summarize(points, samples);
  const latest = samples[samples.length - 1];
  const level = aqiLevel(latest?.usAqi ?? null);
  const speed = recentSpeedKmh(points);
  const effort = speed != null ? effortFromSpeed(speed) : null;
  // Judge a run by the zone you're actually moving at, if we can tell.
  const v = verdict(latest?.usAqi ?? null, { ...profile, zone: effort?.zone || profile.zone });
  const noun = profile.activity === 'walk' ? 'walk' : 'run';

  return (
    <>
      <section className="panel tracker" aria-labelledby="track-title">
        <h2 id="track-title" className="sr-only">
          Track a {noun}
        </h2>

        <Segmented
          label="Activity"
          value={profile.activity}
          disabled={active}
          options={[
            { value: 'walk', label: 'Walk' },
            { value: 'run', label: 'Run' },
          ]}
          onChange={onActivityChange}
        />

        <div className="timer" aria-live="off">
          {formatDuration(sum.movingS)}
          {status === 'paused' && <span className="paused">Paused</span>}
        </div>

        <dl className="stats">
          <div>
            <dt>Distance</dt>
            <dd>
              {(sum.distanceM / 1000).toFixed(2)} <small>km</small>
            </dd>
          </div>
          <div>
            <dt>Pace</dt>
            <dd>{formatPace(sum.distanceM, sum.movingS).replace(' /km', '')}</dd>
          </div>
          <div>
            <dt>Haze inhaled</dt>
            <dd>
              {sum.doseUg.toFixed(1)} <small>µg</small>
            </dd>
          </div>
        </dl>

        {active && (
          <div className={`banner tone-${v.tone}`} role="status">
            <span className="dot" style={{ background: level.color }} aria-hidden="true" />
            <div>
              <strong>
                AQI {latest?.usAqi ?? '–'} · {v.title}
              </strong>
              <span>{effort ? `${effort.label}, breathing ~${effort.ventilation} L/min` : 'Finding your pace…'}</span>
            </div>
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="actions">
          {status === 'idle' && (
            <button className="btn primary big" onClick={start}>
              Start {noun}
            </button>
          )}
          {status === 'tracking' && (
            <button className="btn big" onClick={pause}>
              Pause
            </button>
          )}
          {status === 'paused' && (
            <>
              <button className="btn primary big" onClick={resume}>
                Resume
              </button>
              <button className="btn big" onClick={finish}>
                Finish
              </button>
            </>
          )}
        </div>
        {status === 'paused' && (
          <button className="link" onClick={reset}>
            Discard this {noun}
          </button>
        )}
        {!active && <p className="hint center">Keep this tab open with the screen on while you move.</p>}
      </section>

      <section aria-labelledby="history-title">
        <h2 id="history-title" className="section-title">
          History
        </h2>
        {history.length === 0 ? (
          <p className="empty">Your walks and runs will show up here, with how much haze you breathed.</p>
        ) : (
          <ul className="history">
            {history.map((a) => {
              const s = summarize(a.points, a.samples);
              const lv = aqiLevel(s.avgAqi);
              const viewing = a.id === viewingId;
              return (
                <li key={a.id} className={viewing ? 'on' : ''}>
                  <button className="history-main" onClick={() => onView(viewing ? null : a.id)} aria-pressed={viewing}>
                    <span className="aqi-dot sm" style={{ background: lv.color, color: lv.textColor }}>
                      {s.avgAqi ?? '–'}
                    </span>
                    <span className="grow">
                      <span className="title">
                        {a.type === 'walk' ? 'Walk' : 'Run'} · {(s.distanceM / 1000).toFixed(2)} km
                      </span>
                      <span className="muted block">
                        {new Date(a.startedAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })} ·{' '}
                        {formatDuration(s.movingS)} · {s.doseUg.toFixed(1)} µg haze
                        {s.doseUg > 0 && ` (≈ ${formatHours(restingEquivalentH(s.doseUg, a))} sitting)`}
                      </span>
                    </span>
                  </button>
                  <button className="icon-btn" onClick={() => onDelete(a.id)} aria-label="Delete activity">
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="hint">Saved only on this device.</p>
      </section>
    </>
  );
}

/** Hours of sitting at the activity's mean PM2.5 that would deposit the same dose. */
function restingEquivalentH(dose: number, a: Activity): number {
  const pm = a.samples.map((s) => s.pm25).filter((v): v is number => v != null);
  if (!pm.length) return 0;
  const mean = pm.reduce((x, y) => x + y, 0) / pm.length;
  const perHour = (mean * RESTING_VENTILATION * 60 * RESTING_DEPOSITION) / 1000;
  return perHour > 0 ? dose / perHour : 0;
}
