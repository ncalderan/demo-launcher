import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { resetDeployment } from '../services/resetService';
import { useLauncher } from '../state/LauncherContext';

/** Reset / cleanup: one-click teardown, then redeploy or run a new scenario. */
export function ResetPage() {
  const navigate = useNavigate();
  const { plan, reset, setReset, clearAll } = useLauncher();
  const [running, setRunning] = useState(false);

  if (!plan) return <Navigate to="/" replace />;

  const doReset = async () => {
    setRunning(true);
    const result = await resetDeployment(plan);
    setReset(result);
    setRunning(false);
  };

  const startOver = () => {
    clearAll();
    navigate('/');
  };

  return (
    <div className="page reset">
      <div className="wizard-head">
        <p className="eyebrow">{plan.useCase.title}</p>
        <h1>Reset & cleanup</h1>
        <p className="muted">
          Tear down this demo's assets. Teardown is idempotent — safe to rerun.
        </p>
      </div>

      <section className="panel panel-centered">
        {reset ? (
          <>
            <div className="panel-head-row">
              <h2>Teardown complete</h2>
              <StatusBadge status={reset.status} />
            </div>
            <p className="muted">{reset.message}</p>
            <p className="reset-count">
              {reset.removedActionIds.length} asset(s) removed.
            </p>
            <div className="reset-actions">
              <button className="btn btn-ghost" onClick={() => navigate('/validate')}>
                Redeploy same scenario
              </button>
              <button className="btn btn-primary" onClick={startOver}>
                Run a different demo
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Ready to tear down</h2>
            <p className="muted">
              This removes the source listener, routes, destinations, and demo
              assets provisioned for <strong>{plan.useCase.title}</strong>.
            </p>
            <div className="reset-actions">
              <button className="btn btn-ghost" onClick={() => navigate('/validate')}>
                Back
              </button>
              <button className="btn btn-danger" disabled={running} onClick={() => void doReset()}>
                {running ? 'Tearing down…' : 'Reset demo'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
