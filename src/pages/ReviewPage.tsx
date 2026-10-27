import { Navigate, useNavigate } from 'react-router-dom';
import { TalkTrackPanel } from '../components/TalkTrackPanel';
import { useLauncher } from '../state/LauncherContext';
import { downloadScenario, toSavedScenario } from '../services/scenarioIo';

/**
 * Deploy summary. Renders the visible source presentation, route, destinations,
 * processing, overlays, and outcomes. The internal generation layer of the plan
 * is intentionally NOT rendered — only the realistic source path is shown.
 */
export function ReviewPage() {
  const navigate = useNavigate();
  const { plan, preflight, selection } = useLauncher();

  if (!plan) return <Navigate to="/" replace />;

  const canDeploy = !preflight || preflight.canDeploy;

  const onExport = () => {
    if (selection) downloadScenario(toSavedScenario(selection));
  };

  return (
    <div className="page review">
      <div className="wizard-head">
        <p className="eyebrow">
          {plan.useCase.title} · {plan.runMode.displayName}
        </p>
        <h1>Review deployment</h1>
        <p className="muted">
          Confirm the story before you deploy. {plan.estimatedActionCount} deployment
          actions will run.
        </p>
        <div className="target-row">
          <span className="target-pill">Worker group: {plan.groupId}</span>
          <span className="target-pill">Routing: QuickConnect</span>
          {plan.streamtags.map((t) => (
            <span key={t} className="target-pill tag-pill">
              #{t}
            </span>
          ))}
        </div>
      </div>

      {plan.readiness === 'fallback' && plan.fallbackNote && (
        <div className="banner banner-warn">
          <strong>Fallback mode:</strong> {plan.fallbackNote}
        </div>
      )}

      <div className="review-grid">
        <TalkTrackPanel talkTrack={plan.useCase.talkTrack} />

        {preflight && plan.runMode.showPreflightDetail && (
          <section className="panel">
            <h2>Preflight</h2>
            <ul className="check-list">
              {preflight.checks.map((c) => (
                <li key={c.id} className={`check is-${c.status}`}>
                  <span className="check-dot" />
                  <div>
                    <span className="check-label">{c.label}</span>
                    <span className="check-detail">{c.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel">
          <h2>Source presentation</h2>
          <p className="panel-lead">{plan.sourcePresentation.displayName}</p>
          <dl className="kv">
            <div>
              <dt>Appears as</dt>
              <dd>{plan.dataPath.visibleSource.protocol}</dd>
            </div>
            <div>
              <dt>Ingestion mode</dt>
              <dd>{plan.presentation.displayName}</dd>
            </div>
            <div>
              <dt>Listener</dt>
              <dd>{plan.sourcePresentation.endpoint}</dd>
            </div>
          </dl>
          <div className="schema">
            <span className="schema-title">Sample fields</span>
            <div className="schema-fields">
              {plan.source.sampleSchema.map((f) => (
                <span key={f.name} className={`field${f.sensitive ? ' is-sensitive' : ''}`}>
                  {f.name}
                  <em>{f.type}</em>
                  {f.sensitive && <span className="field-flag">PII</span>}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>Route plan</h2>
          <ul className="route-list">
            {plan.route.map((r, i) => (
              <li key={i} className="route-item">
                <span className="route-from">{r.from}</span>
                <span className="route-arrow">→</span>
                <span className="route-to">{r.to}</span>
                {r.condition && <span className="route-cond">{r.condition}</span>}
              </li>
            ))}
          </ul>
          <h3>Destinations</h3>
          <div className="chip-row">
            {plan.destinations.map((d) => (
              <span key={d.id} className="chip">
                {d.displayName} · {d.costTier}-cost
              </span>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Processing mode</h2>
          <p className="panel-lead">
            {plan.processing.displayName}{' '}
            <span className="tag">
              {plan.processing.kind === 'pack-backed' ? 'Pack-backed' : 'Custom pipeline'}
            </span>
          </p>
          <ol className="steps">
            {plan.processing.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {plan.overlays.length > 0 && (
            <>
              <h3>Policy overlays</h3>
              {plan.overlays.map((o) => (
                <div key={o.id} className="overlay-block">
                  <span className="tag tag-overlay">{o.displayName}</span>
                  <ul className="steps steps-soft">
                    {o.pipelineAdditions.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </section>

        <section className="panel">
          <h2>Visual outcomes</h2>
          {plan.visualOutcomes.map((v) => (
            <div key={v.id} className="outcome">
              <p className="panel-lead">{v.displayName}</p>
              <p className="muted">{v.summary}</p>
              <div className="chip-row">
                {v.assets.map((a) => (
                  <span key={a} className="chip chip-soft">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="panel panel-wide">
          <h2>Cribl objects (QuickConnect)</h2>
          <p className="muted">
            Under the hood, sample events are generated and looped into a genuine{' '}
            {plan.source.loopListenerKind.toUpperCase()} listener, so the source presents as
            real. Internal plumbing is marked below and is left untagged so it
            stays out of your QuickConnect view. The visible source and
            destinations are tagged{' '}
            {plan.streamtags.map((t, i) => (
              <span key={t}>
                {i > 0 && ', '}
                <code>{t}</code>
              </span>
            ))}{' '}
            — filter QuickConnect by these tags to see only the demo assets.
          </p>
          <ul className="object-list">
            {plan.criblObjects.map((o) => (
              <li key={o.id} className={`object-item${o.hidden ? ' is-hidden-obj' : ''}`}>
                <span className={`object-role role-${o.role}`}>{o.role}</span>
                <div>
                  <span className="object-label">
                    {o.label}
                    {o.hidden && <span className="object-flag">internal</span>}
                  </span>
                  <span className="object-id">
                    {o.kind} ·{' '}
                    {o.kind === 'pipeline'
                      ? 'processing'
                      : o.kind === 'pack'
                        ? 'Cribl Pack'
                        : o.kind === 'lake-dataset'
                          ? 'Cribl Lake (federated search)'
                          : o.kind === 'saved-search' || o.kind === 'dashboard'
                            ? 'default_search'
                            : String(o.config.type)}{' '}
                    · id: {o.id}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel panel-wide">
          <h2>Estimated deployment actions</h2>
          <ol className="action-list">
            {plan.actions.map((a) => (
              <li key={a.id} className="action-item">
                <span className={`action-kind kind-${a.kind}`}>
                  {a.kind.replace(/-/g, ' ')}
                </span>
                <div>
                  <span className="action-label">{a.label}</span>
                  <span className="action-detail">{a.detail}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="wizard-footer">
        <button className="btn btn-ghost" onClick={() => navigate('/wizard')}>
          Back to wizard
        </button>
        <div className="footer-right">
          <button className="btn btn-ghost" onClick={onExport}>
            Save scenario
          </button>
          <button
            className="btn btn-primary"
            disabled={!canDeploy}
            onClick={() => navigate('/validate')}
          >
            Deploy demo
          </button>
        </div>
      </div>
    </div>
  );
}
