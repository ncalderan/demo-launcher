import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { OptionCard } from '../components/OptionCard';
import { SourceIcon } from '../components/SourceIcon';
import { Stepper, type Step } from '../components/Stepper';
import {
  destinationProfileById,
  packForDatagenSample,
  policyOverlayById,
  presentationModeById,
  processingProfileById,
  processingProfiles,
  runModeById,
  sourceProfileById,
  useCaseTemplateById,
  visualOutcomeProfileById,
} from '../domain/registry';
import type { ProcessingProfile, SourceProfile, StreamInputKind, WizardStepKey } from '../domain/types';
import { useLauncher } from '../state/LauncherContext';
import { buildUploadedSourceProfile, UploadValidationError } from '../domain/samples/customUpload';
import { detectAiObservabilityOtlpHost } from '../services/criblApi';

const CUSTOM_SOURCE_PREFIX = 'src-custom-';
const CUSTOM_PROCESSING_ID = 'proc-custom-generic';

/**
 * The AI Observability use case has no destination tiles to pick from — it
 * sends directly to the real app's own OTLP listener. We can't ask the
 * platform directly whether the app is installed (cross-app-blocked), but we
 * can best-effort auto-detect its listener (see `detectAiObservabilityOtlpHost`
 * in `criblApi.ts`) and autofill this field; it stays a plain text field so
 * the SE can always override or paste it manually when detection comes up
 * empty. That use case special-cases the "destination" step to collect this
 * value instead of rendering destination tiles.
 */
const AI_OBSERVABILITY_USE_CASE_ID = 'uc-ai-observability';

/** Loose `host:port` shape check — good enough to catch an empty/garbled paste. */
function isValidHostPort(value: string | undefined): boolean {
  return Boolean(value && /^[a-zA-Z0-9.-]+:\d{2,5}$/.test(value.trim()));
}

/** The pack-backed processing profile whose Pack matches a source's data. */
function packProfileForSource(source: SourceProfile): ProcessingProfile | undefined {
  const pack = packForDatagenSample(source.datagenSample);
  if (!pack) return undefined;
  return processingProfiles.find((p) => p.pack?.id === pack.id);
}

const STEP_LABELS: Record<WizardStepKey, string> = {
  source: 'Source profile',
  presentation: 'Ingestion mode',
  destination: 'Route & destination',
  processing: 'Processing mode',
  overlays: 'Policy overlays',
  visual: 'Visual outcome',
};

// 'visual' is intentionally excluded here: its only options are a generic,
// per-use-case description of the outcome (not something the SE meaningfully
// chooses), so that step is never shown — the default from `useCase.defaults`
// is used as-is. See `visualSummary` for the one-line recap shown instead.
const STEP_ORDER: WizardStepKey[] = [
  'source',
  'presentation',
  'destination',
  'processing',
  'overlays',
];

function toggle<T extends string>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/**
 * Single-page configuration surface: every applicable section (source,
 * presentation, destination, processing, overlays, visual) renders at once,
 * stacked, instead of behind per-step Next/Back navigation. The step-eligibility
 * rules are unchanged from the old wizard — a run mode can still hide a step,
 * and a step with only one real option still stays collapsed into the template
 * default — this page only changes HOW the applicable sections are laid out.
 */
export function WizardPage() {
  const navigate = useNavigate();
  const { selection, updateSelection, runPreflightChecks, regeneratePlan, searchEngines } =
    useLauncher();

  // AI Observability's OTLP-host auto-detect (destination-step section only).
  // 'idle' until the use case is active; then 'checking' → 'found' | 'not-found'.
  const [otlpDetectState, setOtlpDetectState] = useState<'idle' | 'checking' | 'found' | 'not-found'>(
    'idle',
  );

  // "Upload your own sample" inline form state (source section only).
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadProtocol, setUploadProtocol] = useState('');
  const [uploadKind, setUploadKind] = useState<StreamInputKind>('tcp');
  const [uploadText, setUploadText] = useState('');
  const [uploadAck, setUploadAck] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadFileRef = useRef<HTMLInputElement>(null);

  // Scroll-spy: which section is currently in view, for the jump-nav highlight.
  const sectionRefs = useRef<Partial<Record<WizardStepKey, HTMLElement | null>>>({});
  const [activeSectionKey, setActiveSectionKey] = useState<WizardStepKey | undefined>();

  const useCase = selection ? useCaseTemplateById.get(selection.useCaseId) : undefined;
  const runMode = selection ? runModeById.get(selection.runMode) : undefined;
  const selectedSource = selection
    ? selection.customSource ?? sourceProfileById.get(selection.sourceProfileId)
    : undefined;

  // Kept current every render so the async detection below can check the
  // LATEST selection (not a stale closure) before deciding whether to
  // autofill — never clobber a value the SE already typed while it ran.
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  // Auto-detect the AI Observability app's OTLP listener once, the first time
  // this use case is active. Best-effort (see detectAiObservabilityOtlpHost's
  // own doc comment on how/why it can miss) — autofills only when exactly one
  // candidate is found AND the field is still empty.
  //
  // `detectionStartedRef` (a ref, not state) gates the one-time start. It must
  // NOT be `otlpDetectState` in the dependency array below: setting that state
  // to 'checking' would itself re-run this effect, which runs the PREVIOUS
  // invocation's cleanup (marking that invocation's `cancelled` true) before
  // the in-flight request can ever report back — permanently stuck on
  // "checking" regardless of what the scan finds. Learned this the hard way.
  const detectionStartedRef = useRef(false);
  useEffect(() => {
    if (useCase?.id !== AI_OBSERVABILITY_USE_CASE_ID) {
      detectionStartedRef.current = false;
      return;
    }
    if (detectionStartedRef.current) return;
    detectionStartedRef.current = true;
    setOtlpDetectState('checking');
    let cancelled = false;
    void detectAiObservabilityOtlpHost()
      .then((host) => {
        if (cancelled) return;
        if (host && !selectionRef.current?.otelIngestHost?.trim()) {
          updateSelection({ otelIngestHost: host });
        }
        setOtlpDetectState(host ? 'found' : 'not-found');
      })
      .catch(() => {
        if (!cancelled) setOtlpDetectState('not-found');
      });
    return () => {
      cancelled = true;
    };
  }, [useCase?.id, updateSelection]);

  const options = useMemo(() => {
    if (!useCase) return null;

    // An SE-uploaded sample has no matching Cribl Pack and isn't part of the use
    // case's curated compatible-processing list — force the single generic
    // custom-pipeline profile so the section collapses instead of offering
    // unrelated options (mask/reduce, policy routing, …).
    const isCustomSource = selectedSource?.id.startsWith(CUSTOM_SOURCE_PREFIX) ?? false;

    // Processing: the pack follows the DATA. Show the Cribl Pack that matches the
    // selected source first, then the use case's custom-pipeline alternatives.
    const customPipelines = useCase.compatibleProcessingIds
      .map((id) => processingProfileById.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p) && p!.kind === 'custom-pipeline');
    const matchingPack = selectedSource ? packProfileForSource(selectedSource) : undefined;
    const processing = isCustomSource
      ? [processingProfileById.get(CUSTOM_PROCESSING_ID)].filter(
          (p): p is NonNullable<typeof p> => Boolean(p),
        )
      : [...(matchingPack ? [matchingPack] : []), ...customPipelines].filter(
          (p, i, arr) => arr.findIndex((x) => x.id === p.id) === i,
        );

    return {
      sources: useCase.compatibleSourceProfileIds
        .map((id) => sourceProfileById.get(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
      presentations: useCase.compatiblePresentationModeIds
        .map((id) => presentationModeById.get(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
      destinations: useCase.compatibleDestinationIds
        .map((id) => destinationProfileById.get(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
      processing,
      overlays: useCase.compatibleOverlayIds
        .map((id) => policyOverlayById.get(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
    };
  }, [useCase, selectedSource]);

  // Sections shown depend on run mode AND whether there's a real choice to make.
  // Collapse any section that offers a single option (its template default is
  // already applied), so opinionated use cases (AI Telemetry, AI Investigator)
  // land on a near-empty page instead of a wall of fixed-answer sections.
  const activeSteps = useMemo<Step[]>(() => {
    if (!useCase || !runMode || !options) return [];
    const optionCount = (key: WizardStepKey): number => {
      switch (key) {
        case 'source':
          return options.sources.length;
        case 'presentation':
          return options.presentations.length;
        case 'destination':
          return options.destinations.length;
        case 'processing':
          return options.processing.length;
        case 'overlays':
          return options.overlays.length;
        default:
          return 0;
      }
    };
    return STEP_ORDER.filter((key) => {
      if (!runMode.exposedSteps.includes(key)) return false;
      if (key === 'overlays' && useCase.compatibleOverlayIds.length === 0) return false;
      // AI Observability always needs its OTLP-host field, regardless of the
      // (empty) destination tile count.
      if (key === 'destination' && useCase.id === AI_OBSERVABILITY_USE_CASE_ID) return true;
      // Lakehouse Engine Routing always needs its engine picker, for the same
      // reason — `compatibleDestinationIds` is deliberately empty since the
      // "destination" is the SE-picked engine, not a destination tile.
      if (key === 'destination' && useCase.requiresSearchEngine) return true;
      // Nothing to decide (0 or 1 option) — keep the default and skip the section.
      if (optionCount(key) <= 1) return false;
      return true;
    }).map((key) => ({ key, label: STEP_LABELS[key] }));
  }, [useCase, runMode, options]);

  // Scroll-spy: observe each active section and highlight whichever one is
  // nearest the top of the viewport, for the jump-nav's active state.
  useEffect(() => {
    if (activeSteps.length === 0) return;
    setActiveSectionKey((prev) => prev ?? (activeSteps[0].key as WizardStepKey));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        const key = topMost.target.getAttribute('data-step-key') as WizardStepKey | null;
        if (key) setActiveSectionKey(key);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    );
    for (const { key } of activeSteps) {
      const el = sectionRefs.current[key as WizardStepKey];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [activeSteps]);

  if (!selection || !useCase || !runMode || !options) {
    return <Navigate to="/" replace />;
  }

  const reviewAndDeploy = () => {
    runPreflightChecks();
    regeneratePlan();
    navigate('/review');
  };

  // Selecting a source also aligns the pack to that source's data, unless the SE
  // has deliberately chosen a custom pipeline.
  const selectSource = (sourceId: string) => {
    const src = sourceProfileById.get(sourceId);
    const current = processingProfileById.get(selection!.processingId);
    // Picking a curated tile always supersedes a previous upload.
    const patch: { sourceProfileId: string; processingId?: string; customSource?: undefined } = {
      sourceProfileId: sourceId,
      customSource: undefined,
    };
    if (src && current?.kind !== 'custom-pipeline') {
      const match = packProfileForSource(src);
      if (match) patch.processingId = match.id;
    }
    updateSelection(patch);
  };

  const closeUploadForm = () => {
    setUploadOpen(false);
    setUploadError(null);
  };

  const submitUpload = async () => {
    setUploadError(null);
    try {
      const file = uploadFileRef.current?.files?.[0];
      const raw = file ? await file.text() : uploadText;
      if (!uploadAck) {
        setUploadError('Confirm the sample contains no real customer data before continuing.');
        return;
      }
      if (!raw.trim()) {
        setUploadError('Paste some sample lines or choose a file first.');
        return;
      }
      const profile = buildUploadedSourceProfile({
        displayName: uploadName.trim() || 'SE-uploaded sample',
        protocolLabel: uploadProtocol.trim() || 'Custom (SE-uploaded)',
        streamInputKind: uploadKind,
        raw,
      });
      updateSelection({
        sourceProfileId: profile.id,
        customSource: profile,
        processingId: CUSTOM_PROCESSING_ID,
      });
      closeUploadForm();
    } catch (err) {
      setUploadError(
        err instanceof UploadValidationError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not read that sample.',
      );
    }
  };

  const scrollToSection = (index: number) => {
    const key = activeSteps[index]?.key as WizardStepKey | undefined;
    const el = key ? sectionRefs.current[key] : undefined;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Resolved selections, shown both in the "nothing to configure" summary and
  // in the sticky footer's live recap.
  const destinationSummary =
    useCase.id === AI_OBSERVABILITY_USE_CASE_ID
      ? selection.otelIngestHost?.trim() || 'OTLP host not set'
      : useCase.requiresSearchEngine
        ? searchEngines.find((e) => e.id === selection.engineId)?.displayName ||
          'Lakehouse engine not set'
        : selection.destinationIds
            .map((id) => destinationProfileById.get(id)?.displayName)
            .filter(Boolean)
            .join(', ') || '—';
  const processingSummary =
    processingProfileById.get(selection.processingId)?.displayName ?? '—';
  const visualSummary =
    selection.visualOutcomeIds
      .map((id) => visualOutcomeProfileById.get(id)?.displayName)
      .filter(Boolean)
      .join(', ') || '—';

  const activeIndex = activeSteps.findIndex((s) => s.key === activeSectionKey);

  const renderSectionBody = (key: WizardStepKey) => {
    switch (key) {
      case 'source':
        return (
          <>
            <div className="option-list">
              {options.sources.map((s) => (
                <OptionCard
                  key={s.id}
                  icon={<SourceIcon icon={s.icon} />}
                  title={s.displayName}
                  description={s.summary}
                  badge={s.protocol}
                  selected={selection.sourceProfileId === s.id && !selection.customSource}
                  onClick={() => selectSource(s.id)}
                  meta={`Default listener port ${s.defaultPort}`}
                />
              ))}
              <OptionCard
                title={
                  selection.customSource
                    ? `Uploaded: ${selection.customSource.displayName}`
                    : 'Upload your own sample'
                }
                description="Paste or upload your own sample data instead of a curated source — processed with a generic pipeline (no pack can match an unknown format)."
                badge="Custom"
                selected={Boolean(selection.customSource)}
                onClick={() => {
                  setUploadError(null);
                  setUploadOpen(true);
                }}
              />
            </div>

            {uploadOpen && (
              <div className="panel upload-form">
                <h3>Upload your own sample</h3>
                <label className="field">
                  <span>Display name</span>
                  <input
                    type="text"
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    placeholder="e.g. Acme Load Balancer (syslog)"
                  />
                </label>
                <label className="field">
                  <span>Protocol label (shown to the audience)</span>
                  <input
                    type="text"
                    value={uploadProtocol}
                    onChange={(e) => setUploadProtocol(e.target.value)}
                    placeholder="e.g. Syslog (RFC5424)"
                  />
                </label>
                <label className="field">
                  <span>Listener type</span>
                  <select
                    value={uploadKind}
                    onChange={(e) => setUploadKind(e.target.value as StreamInputKind)}
                  >
                    <option value="syslog">Syslog</option>
                    <option value="tcp">Raw TCP / JSON</option>
                    <option value="otel">OpenTelemetry</option>
                  </select>
                </label>
                <label className="field">
                  <span>Sample file (one event per line)</span>
                  <input ref={uploadFileRef} type="file" accept=".txt,.log,.json,.ndjson" />
                </label>
                <label className="field">
                  <span>…or paste sample lines directly</span>
                  <textarea
                    rows={6}
                    value={uploadText}
                    onChange={(e) => setUploadText(e.target.value)}
                    placeholder="One event per line — raw text or JSON lines. Up to 200 lines."
                  />
                </label>
                <label className="field field-checkbox">
                  <input
                    type="checkbox"
                    checked={uploadAck}
                    onChange={(e) => setUploadAck(e.target.checked)}
                  />
                  <span>This sample is synthetic or fully sanitized — no real customer data.</span>
                </label>
                {uploadError && <p className="inline-error">{uploadError}</p>}
                <div className="upload-form-actions">
                  <button className="btn btn-ghost btn-sm" onClick={closeUploadForm}>
                    Cancel
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => void submitUpload()}>
                    Use this sample
                  </button>
                </div>
              </div>
            )}
          </>
        );

      case 'presentation':
        return (
          <div className="option-list">
            {options.presentations.map((p) => (
              <OptionCard
                key={p.id}
                title={p.displayName}
                description={p.summary}
                badge={p.listenerType}
                selected={selection.presentationModeId === p.id}
                onClick={() => updateSelection({ presentationModeId: p.id })}
              />
            ))}
          </div>
        );

      case 'destination':
        if (useCase.id === AI_OBSERVABILITY_USE_CASE_ID) {
          const host = selection.otelIngestHost ?? '';
          const showError = host.length > 0 && !isValidHostPort(host);
          return (
            <>
              <p className="step-hint">
                Install the official "AI Observability" app from the Cribl
                marketplace catalog and run its Setup Wizard once (manual —
                app-management endpoints are cross-app-blocked from any Cribl
                App, including this one). Paste the OTLP/HTTP ingest host:port
                it assigns you below.
              </p>
              <label className="field">
                <span>OTLP/HTTP ingest host:port</span>
                <input
                  type="text"
                  placeholder="e.g. otel-ingest.main.your-org.cribl.cloud:20003"
                  value={host}
                  onChange={(e) => updateSelection({ otelIngestHost: e.target.value })}
                />
              </label>
              <p className="step-hint">
                {otlpDetectState === 'checking'
                  ? 'Checking this org for an already-installed AI Observability app…'
                  : otlpDetectState === 'found'
                    ? 'Detected automatically from an installed AI Observability app in this org.'
                    : 'Not auto-detected — paste the host:port from the app\'s Setup Wizard.'}
              </p>
              {showError && (
                <p className="step-hint" style={{ color: 'var(--danger)' }}>
                  Expected a plain host:port, e.g. host.example.cribl.cloud:20003.
                </p>
              )}
            </>
          );
        }
        if (useCase.requiresSearchEngine) {
          return (
            <>
              <p className="step-hint">
                Pick an existing Cribl Search Lakehouse engine already
                provisioned in this org. This use case routes natively into
                the engine you choose — it does not provision one.
              </p>
              <div className="option-list">
                {searchEngines.map((e) => (
                  <OptionCard
                    key={e.id}
                    title={e.displayName}
                    description={e.summary}
                    selected={selection.engineId === e.id}
                    onClick={() => updateSelection({ engineId: e.id })}
                  />
                ))}
              </div>
              {searchEngines.length === 0 && (
                <p className="step-hint" style={{ color: 'var(--danger)' }}>
                  No Lakehouse engines found in this org — create one first
                  (Cribl Search → Engines), then come back to this step.
                </p>
              )}
            </>
          );
        }
        return (
          <>
            <p className="step-hint">
              Choose one or more destinations — the "right data to the right
              destination" story lands best with two.
            </p>
            <div className="option-list">
              {options.destinations.map((d) => (
                <OptionCard
                  key={d.id}
                  icon={<SourceIcon icon={d.icon} />}
                  title={d.displayName}
                  description={d.summary}
                  badge={`${d.costTier}-cost`}
                  selected={selection.destinationIds.includes(d.id)}
                  onClick={() =>
                    updateSelection({
                      destinationIds: toggle(selection.destinationIds, d.id),
                    })
                  }
                />
              ))}
            </div>
          </>
        );

      case 'processing':
        return (
          <div className="option-list">
            {options.processing.map((p) => (
              <OptionCard
                key={p.id}
                title={p.displayName}
                description={p.summary}
                badge={p.kind === 'pack-backed' ? 'Pack-backed' : 'Custom pipeline'}
                selected={selection.processingId === p.id}
                onClick={() => updateSelection({ processingId: p.id })}
                meta={p.steps.join(' • ')}
              />
            ))}
          </div>
        );

      case 'overlays':
        return (
          <>
            <p className="step-hint">
              Optional policy overlays layer onto this demo — add only what the
              conversation needs.
            </p>
            <div className="option-list">
              {options.overlays.map((o) => (
                <OptionCard
                  key={o.id}
                  title={o.displayName}
                  description={o.summary}
                  badge="Overlay"
                  selected={selection.overlayIds.includes(o.id)}
                  onClick={() =>
                    updateSelection({ overlayIds: toggle(selection.overlayIds, o.id) })
                  }
                  meta={o.pipelineAdditions.join(' • ')}
                />
              ))}
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className="page wizard">
      <div className="wizard-head">
        <p className="eyebrow">
          {useCase.title} · {runMode.displayName}
        </p>
        <h1>{activeSteps.length === 0 ? 'Ready to deploy' : 'Configure your demo'}</h1>
        <p className="muted">
          {activeSteps.length === 0
            ? 'This demo is fully preconfigured — review the setup below, then deploy.'
            : 'Defaults are pre-selected for a fast, credible run. Scan down and adjust only what you want to change.'}
        </p>
      </div>

      {activeSteps.length > 1 && (
        <Stepper steps={activeSteps} activeIndex={activeIndex} onStepClick={scrollToSection} />
      )}

      <div className="wizard-body">
        {activeSteps.length === 0 && (
          <div className="deploy-summary">
            <dl className="summary-facts">
              <div>
                <dt>Source</dt>
                <dd>{selectedSource?.displayName ?? '—'}</dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd>{destinationSummary}</dd>
              </div>
              <div>
                <dt>Processing</dt>
                <dd>{processingSummary}</dd>
              </div>
              <div>
                <dt>Proof point</dt>
                <dd>{visualSummary}</dd>
              </div>
            </dl>
          </div>
        )}

        {activeSteps.map(({ key, label }) => (
          <section
            key={key}
            data-step-key={key}
            ref={(el) => {
              sectionRefs.current[key as WizardStepKey] = el;
            }}
            className="wizard-section"
          >
            <h2 className="wizard-section-title">{label}</h2>
            {renderSectionBody(key as WizardStepKey)}
          </section>
        ))}
      </div>

      <div className="wizard-footer wizard-footer-sticky">
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          Back to demos
        </button>
        <div className="footer-right">
          <span className="wizard-footer-summary">
            {selectedSource?.displayName ?? '—'} · {destinationSummary} · {processingSummary}
          </span>
          <button
            className="btn btn-primary"
            disabled={
              useCase.id === AI_OBSERVABILITY_USE_CASE_ID &&
              !isValidHostPort(selection.otelIngestHost)
            }
            onClick={reviewAndDeploy}
          >
            Review &amp; deploy
          </button>
        </div>
      </div>
    </div>
  );
}
