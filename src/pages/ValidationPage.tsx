import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import type { DeploymentActionResult, PostDeployBlock } from '../domain/types';
import { executeDeploymentPlan } from '../services/deploymentExecutor';
import { validateDeployment } from '../services/validationService';
import { criblUiOrigin } from '../services/criblApi';
import { useLauncher } from '../state/LauncherContext';

/** A labeled, monospaced text block with a copy-to-clipboard button. */
function CopyBlock({ block }: { block: PostDeployBlock }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(block.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the text is still selectable */
    }
  }, [block.text]);
  return (
    <div className="copyblock">
      <div className="copyblock-head">
        <span className="copyblock-label">{block.label}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={`copyblock-pre lang-${block.language ?? 'text'}`}>
        <code>{block.text}</code>
      </pre>
    </div>
  );
}

/**
 * Post-deploy validation. Runs the (mocked) deployment, streams per-action
 * progress, then shows operational checks. Redeploy is idempotent — safe to
 * rerun repeatedly against the same environment.
 */
export function ValidationPage() {
  const navigate = useNavigate();
  const { plan, deployment, validation, setDeployment, setValidation } = useLauncher();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DeploymentActionResult[]>([]);
  const startedRef = useRef(false);

  const deploy = useCallback(async () => {
    if (!plan) return;
    setRunning(true);
    setProgress([]);
    setValidation(null);
    const result = await executeDeploymentPlan(plan, {
      onActionComplete: (r) => setProgress((prev) => [...prev, r]),
    });
    setDeployment(result);
    if (result.status === 'succeeded') {
      setValidation(validateDeployment(plan, result));
    }
    setRunning(false);
  }, [plan, setDeployment, setValidation]);

  // Auto-run once on first arrival.
  useEffect(() => {
    if (plan && !startedRef.current && !deployment) {
      startedRef.current = true;
      void deploy();
    }
  }, [plan, deployment, deploy]);

  if (!plan) return <Navigate to="/" replace />;

  // Deep links to the deployed assets in the Cribl UI (shown after a run).
  const uiOrigin = criblUiOrigin();
  const datasets = plan.criblObjects.filter((o) => o.kind === 'lake-dataset');
  const dashboards = plan.criblObjects.filter((o) => o.kind === 'dashboard');
  const showLinks = Boolean(uiOrigin && deployment && !running);
  const guide = plan.useCase.postDeploy;
  const showGuide = Boolean(guide && deployment && !running);

  return (
    <div className="page validation">
      <div className="wizard-head">
        <p className="eyebrow">
          {plan.useCase.title} · {plan.runMode.displayName}
        </p>
        <h1>Deploy & validate</h1>
        <p className="muted">
          {running
            ? 'Deploying demo assets…'
            : deployment
              ? deployment.message
              : 'Preparing deployment…'}
        </p>
      </div>

      <div className="validation-grid">
        <section className="panel">
          <div className="panel-head-row">
            <h2>Deployment</h2>
            {deployment && <StatusBadge status={deployment.status} />}
          </div>
          <ol className="action-progress">
            {plan.actions.map((a) => {
              const done = progress.find((p) => p.actionId === a.id);
              const status = done ? done.status : running ? 'running' : 'pending';
              return (
                <li key={a.id} className={`progress-item is-${status}`}>
                  <span className="progress-icon" aria-hidden>
                    {status === 'succeeded' ? '✓' : status === 'running' ? '•' : ''}
                  </span>
                  <span className="progress-label">{a.label}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="panel">
          <div className="panel-head-row">
            <h2>Validation</h2>
            {validation && <StatusBadge status={validation.overall} />}
          </div>
          {validation ? (
            <ul className="check-list">
              {validation.checks.map((c) => (
                <li key={c.id} className={`check is-${c.status === 'pass' ? 'ok' : 'warn'}`}>
                  <span className="check-dot" />
                  <div>
                    <span className="check-label">{c.label}</span>
                    {c.detail && <span className="check-detail">{c.detail}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Validation runs after a successful deployment.</p>
          )}
        </section>

        {showLinks && (
          <section className="panel panel-wide">
            <h2>Open in Cribl</h2>
            <p className="muted">Jump to where this demo landed (opens a new tab).</p>
            <div className="link-list">
              <a
                className="cribl-link"
                href={`${uiOrigin}/stream/m/${encodeURIComponent(plan.groupId)}/quick-connect`}
                target="_blank"
                rel="noreferrer"
              >
                Data routes (QuickConnect) — {plan.groupId}
              </a>
              {dashboards.map((d) => (
                <a
                  key={d.id}
                  className="cribl-link"
                  href={`${uiOrigin}/search/dashboards/${encodeURIComponent(d.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Dashboard — {d.label}
                </a>
              ))}
              {datasets.length > 0 && (
                <a
                  className="cribl-link"
                  href={`${uiOrigin}/search/datasets`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Datasets — {datasets.map((d) => d.id).join(', ')}
                </a>
              )}
            </div>
          </section>
        )}

        {showGuide && guide && (
          <section className="panel panel-wide">
            <h2>{guide.title}</h2>
            {guide.intro?.map((p, i) => (
              <p key={i} className="panel-lead">
                {p}
              </p>
            ))}
            <div className="copyblock-list">
              {guide.blocks.map((b) => (
                <CopyBlock key={b.label} block={b} />
              ))}
            </div>
            {guide.footnotes && guide.footnotes.length > 0 && (
              <ul className="guide-footnotes">
                {guide.footnotes.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {plan.runMode.showHandoffDetail && (
          <section className="panel panel-wide">
            <h2>Handoff — proof point to show</h2>
            <p className="panel-lead">{plan.useCase.talkTrack.proofPoint}</p>
            <div className="chip-row">
              {plan.visualOutcomes.flatMap((v) =>
                v.assets.map((a) => (
                  <span key={`${v.id}-${a}`} className="chip chip-soft">
                    {a}
                  </span>
                )),
              )}
            </div>
          </section>
        )}
      </div>

      <div className="wizard-footer">
        <button className="btn btn-ghost" onClick={() => navigate('/review')}>
          Back to review
        </button>
        <div className="footer-right">
          <button className="btn btn-ghost" disabled={running} onClick={() => void deploy()}>
            Redeploy
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/reset')}>
            Reset / cleanup
          </button>
        </div>
      </div>
    </div>
  );
}
