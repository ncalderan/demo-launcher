import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { OptionCard } from '../components/OptionCard';
import { Stepper, type Step } from '../components/Stepper';
import {
  DEFAULT_SEARCH_ENGINE_ID,
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

const CUSTOM_SOURCE_PREFIX = 'src-custom-';
const CUSTOM_PROCESSING_ID = 'proc-custom-generic';

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

const STEP_ORDER: WizardStepKey[] = [
  'source',
  'presentation',
  'destination',
  'processing',
  'overlays',
  'visual',
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

  // When the AI-telemetry engine selector applies, make sure the selected engine
  // actually exists on this stack. If the current choice isn't among the
  // discovered engines, snap to the first available one (portability).
  useEffect(() => {
    if (!selection) return;
    const src = sourceProfileById.get(selection.sourceProfileId);
    if (src?.family !== 'ai-telemetry' || !searchEngines.length) return;
    if (!searchEngines.some((e) => e.id === selection.engineId)) {
      updateSelection({ engineId: searchEngines[0].id });
    }
  }, [selection, searchEngines, updateSelection]);

  const useCase = selection ? useCaseTemplateById.get(selection.useCaseId) : undefined;
  const runMode = selection ? runModeById.get(selection.runMode) : undefined;
  const selectedSource = selection
    ? selection.customSource ?? sourceProfileById.get(selection.sourceProfileId)
    : undefined;

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
      visuals: useCase.compatibleVisualOutcomeIds
        .map((id) => visualOutcomeProfileById.get(id))
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
          return selectedSource?.family === 'ai-telemetry'
            ? searchEngines.length
            : options.destinations.length;
        case 'processing':
          return options.processing.length;
        case 'overlays':
          return options.overlays.length;
        case 'visual':
          return options.visuals.length;
        default:
          return 0;
      }
    };
    return STEP_ORDER.filter((key) => {
      if (!runMode.exposedSteps.includes(key)) return false;
      if (key === 'overlays' && useCase.compatibleOverlayIds.length === 0) return false;
      // Nothing to decide (0 or 1 option) — keep the default and skip the section.
      if (optionCount(key) <= 1) return false;
      return true;
    }).map((key) => ({ key, label: STEP_LABELS[key] }));
  }, [useCase, runMode, options, selectedSource, searchEngines]);

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

  // The AI-telemetry path accelerates its Lake dataset onto a Search engine, so
  // it exposes an engine selector alongside the destination section.
  const showEngineSelector = selectedSource?.family === 'ai-telemetry';
  const selectedEngineId = selection.engineId ?? DEFAULT_SEARCH_ENGINE_ID;

  // Resolved selections, shown both in the "nothing to configure" summary and
  // in the sticky footer's live recap.
  const destinationSummary = showEngineSelector
    ? searchEngines.find((e) => e.id === selectedEngineId)?.displayName ?? selectedEngineId
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
        return showEngineSelector ? (
          <>
            <p className="step-hint">
              This demo lands in Cribl Search. Choose the Search engine to attach
              the dataset to.
            </p>
            <div className="option-list">
              {searchEngines.map((e) => (
                <OptionCard
                  key={e.id}
                  title={e.displayName}
                  description={e.summary}
                  badge="Search engine"
                  selected={selectedEngineId === e.id}
                  onClick={() => updateSelection({ engineId: e.id })}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="step-hint">
              Choose one or more destinations — the "right data to the right
              destination" story lands best with two.
            </p>
            <div className="option-list">
              {options.destinations.map((d) => (
                <OptionCard
                  key={d.id}
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

      case 'visual':
        return (
          <>
            <p className="step-hint">Pick the proof point(s) you'll show at the end.</p>
            <div className="option-list">
              {options.visuals.map((v) => (
                <OptionCard
                  key={v.id}
                  title={v.displayName}
                  description={v.summary}
                  badge={v.kind.replace(/-/g, ' ')}
                  selected={selection.visualOutcomeIds.includes(v.id)}
                  onClick={() =>
                    updateSelection({
                      visualOutcomeIds: toggle(selection.visualOutcomeIds, v.id),
                    })
                  }
                  meta={v.assets.join(' • ')}
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
                <dt>{showEngineSelector ? 'Search engine' : 'Destination'}</dt>
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
          <button className="btn btn-primary" onClick={reviewAndDeploy}>
            Review &amp; deploy
          </button>
        </div>
      </div>
    </div>
  );
}
