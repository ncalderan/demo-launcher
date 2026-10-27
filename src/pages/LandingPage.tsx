import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { runModes, sourceProfileById, useCaseTemplates } from '../domain/registry';
import type { RunModeId } from '../domain/types';
import { useLauncher } from '../state/LauncherContext';
import { parseScenario } from '../services/scenarioIo';
import {
  detectDeployedDemo,
  resetDeployedAssets,
  type DemoFootprint,
} from '../services/resetService';

/** Landing launchpad: run-mode picker + opinionated Public Sector demo tiles. */
export function LandingPage() {
  const navigate = useNavigate();
  const { startScenario, loadScenario, workerGroups } = useLauncher();
  const [runMode, setRunMode] = useState<RunModeId>('standard');
  const [groupId, setGroupId] = useState('default');
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Detect an already-deployed demo in the selected group so it can be torn down
  // even without an in-memory plan (e.g. after navigating away or reloading).
  const [footprint, setFootprint] = useState<DemoFootprint | null>(null);
  const [tearingDown, setTearingDown] = useState(false);
  const [teardownMsg, setTeardownMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFootprint(null);
    setTeardownMsg(null);
    void detectDeployedDemo(groupId).then((f) => {
      if (!cancelled) setFootprint(f);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const tearDown = async () => {
    setTearingDown(true);
    setTeardownMsg(null);
    const result = await resetDeployedAssets(groupId);
    setTeardownMsg(result.message ?? 'Teardown complete.');
    setTearingDown(false);
    setFootprint(await detectDeployedDemo(groupId));
  };

  const launch = (useCaseId: string) => {
    startScenario(useCaseId, runMode, groupId);
    navigate('/wizard');
  };

  const onImportFile = async (file: File) => {
    try {
      const scenario = parseScenario(await file.text());
      loadScenario(scenario);
      setImportError(null);
      navigate('/review');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not read scenario file.');
    }
  };

  return (
    <div className="page landing">
      <div className="page-intro">
        <h1>Launch a Public Sector demo in minutes</h1>
        <p>
          Pick a scenario, present a realistic source, route it through Cribl, and
          land on a proof point that tells the story. Opinionated defaults get you
          demo-ready fast.
        </p>
      </div>

      <div className="runmode-bar">
        <div className="runmode-options">
          {runModes
            .filter((m) => m.id === 'standard')
            .map((m) => (
            <button
              key={m.id}
              type="button"
              className={`runmode-chip${runMode === m.id ? ' is-active' : ''}`}
              onClick={() => setRunMode(m.id)}
              title={m.summary}
            >
              <span className="runmode-name">{m.displayName}</span>
              <span className="runmode-best">{m.bestFor}</span>
            </button>
          ))}
        </div>
        <div className="runmode-import">
          <label className="group-select">
            <span>Worker group</span>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {workerGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
            Load saved scenario
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImportFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      {importError && <p className="inline-error">{importError}</p>}

      {footprint?.deployed && (
        <div className="deployed-banner">
          <div className="banner-text">
            <strong>A demo is deployed in "{groupId}"</strong>
            <span className="muted">
              {' '}
              — {footprint.assetCount} asset(s) found. Tear it down before running a
              new one.
            </span>
          </div>
          <button
            className="btn btn-danger btn-sm"
            disabled={tearingDown}
            onClick={() => void tearDown()}
          >
            {tearingDown ? 'Tearing down…' : 'Tear down demo'}
          </button>
        </div>
      )}
      {teardownMsg && <p className="inline-note">{teardownMsg}</p>}

      <div className="tile-grid">
        {useCaseTemplates.map((uc) => {
          const sourceNames = uc.primarySourceProfileIds
            .map((id) => sourceProfileById.get(id)?.displayName)
            .filter(Boolean)
            .join(', ');
          return (
            <article key={uc.id} className="tile">
              <div className="tile-body">
                <div className="tile-themes">
                  {uc.themes.map((t) => (
                    <span key={t} className="chip">
                      {t.replace(/-/g, ' ')}
                    </span>
                  ))}
                </div>
                <h2 className="tile-title">{uc.title}</h2>
                <p className="tile-value">{uc.valueStatement}</p>
                <dl className="tile-facts">
                  <div>
                    <dt>Primary source</dt>
                    <dd>{sourceNames}</dd>
                  </div>
                  <div>
                    <dt>Destination pattern</dt>
                    <dd>{uc.destinationPattern}</dd>
                  </div>
                  <div>
                    <dt>Outcome</dt>
                    <dd>{uc.expectedOutcome}</dd>
                  </div>
                </dl>
              </div>
              <div className="tile-actions">
                <button className="btn btn-primary" onClick={() => launch(uc.id)}>
                  Launch demo
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
