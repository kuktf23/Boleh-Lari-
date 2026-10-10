import { clamp } from '../lib/format';
import type { Profile } from '../lib/verdict';
import { RESTING_VENTILATION, ZONES, hrMax, zoneBpm } from '../lib/zones';
import { Segmented } from './Segmented';

interface Props {
  profile: Profile;
  onChange: (p: Profile) => void;
}

/** Collapsed by default: a one-line summary of the plan, tap to adjust. */
export function Settings({ profile, onChange }: Props) {
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => onChange({ ...profile, [k]: v });
  const zone = ZONES[clamp(profile.zone, 1, 5) - 1];
  const max = hrMax(clamp(profile.age, 12, 90));
  const [lo, hi] = zoneBpm(zone, max);
  const minutes = clamp(profile.minutes, 5, 300);

  return (
    <details className="panel settings">
      <summary>
        <span>
          <span className="eyebrow">Your plan</span>
          <span className="summary-line">
            {profile.activity === 'walk' ? 'Walk' : `Run · Zone ${zone.id}`} · {minutes} min
            {profile.sensitive && ' · sensitive'}
          </span>
        </span>
        <span className="edit" aria-hidden="true">
          Edit
        </span>
      </summary>

      <div className="settings-body">
        <Segmented
          label="Activity"
          value={profile.activity}
          options={[
            { value: 'walk', label: 'Walk' },
            { value: 'run', label: 'Run' },
          ]}
          onChange={(v) => set('activity', v)}
        />

        {profile.activity === 'run' && (
          <fieldset className="field">
            <legend>Intensity</legend>
            <div className="chips">
              {ZONES.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  className={`chip${z.id === zone.id ? ' on' : ''}`}
                  aria-pressed={z.id === zone.id}
                  aria-label={`Zone ${z.id}, ${z.name}`}
                  onClick={() => set('zone', z.id)}
                >
                  Z{z.id}
                </button>
              ))}
            </div>
            <p className="hint">
              <strong>{zone.name}</strong> · {lo}–{hi} bpm · {zone.feel.toLowerCase()}
            </p>
          </fieldset>
        )}

        <div className="row">
          <label className="field">
            <span>Duration (min)</span>
            <input
              type="number"
              inputMode="numeric"
              min={5}
              max={300}
              step={5}
              value={profile.minutes}
              onChange={(e) => set('minutes', Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Age</span>
            <input
              type="number"
              inputMode="numeric"
              min={12}
              max={90}
              value={profile.age}
              onChange={(e) => set('age', Number(e.target.value))}
            />
          </label>
        </div>

        <label className="toggle">
          <input type="checkbox" checked={profile.sensitive} onChange={(e) => set('sensitive', e.target.checked)} />
          <span>I have asthma or a heart or lung condition</span>
        </label>

        <details className="learn">
          <summary>How effort changes your breathing</summary>
          <table className="zone-table">
            <caption className="sr-only">Heart rate zones and breathing</caption>
            <thead>
              <tr>
                <th scope="col">Zone</th>
                <th scope="col">Heart rate</th>
                <th scope="col">Air / min</th>
                <th scope="col">Breathing</th>
              </tr>
            </thead>
            <tbody>
              {ZONES.map((z) => {
                const [l, h] = zoneBpm(z, max);
                return (
                  <tr key={z.id} className={profile.activity === 'run' && z.id === zone.id ? 'on' : ''}>
                    <th scope="row">
                      Z{z.id} <span className="muted">{z.name}</span>
                    </th>
                    <td>
                      {l}–{h}
                    </td>
                    <td>
                      {z.ventilation} L <span className="muted">({Math.round(z.ventilation / RESTING_VENTILATION)}×)</span>
                    </td>
                    <td>{z.breathing}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">
            At rest you breathe about {RESTING_VENTILATION} L a minute. Harder zones pull in up to 17× more. Past Zone
            2 you switch to mouth breathing, which skips your nose's filter, so more haze settles in your lungs.
            These are averages, not medical advice.
          </p>
        </details>
      </div>
    </details>
  );
}
