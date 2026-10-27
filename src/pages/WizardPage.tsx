import { useEffect, useMemo, useState } from 'react';
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
import type { ProcessingProfile, SourceProfile, WizardStepKey } from '../domain/types';
import { useLauncher } from '../state/LauncherContext';

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

export function WizardPage() {
  const navigate = useNavigate();
  const { selection, updateSelection, runPreflightChecks, regeneratePlan, searchEngines } =
    useLauncher();
  const [stepIndex, setStepIndex] = useState(0);

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
    ? sourceProfileById.get(selection.sourceProfileId)
    : undefined;

  const options = useMemo(() => {
    if (!useCase) return null;

    // Processing: the pack follows the DATA. Show the Cribl Pack that matches the
    // selected source first, then the use case's custom-pipeline alternatives.
    const customPipelines = useCase.compatibleProcessingIds
      .map((id) => processingProfileById.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p) && p!.kind === 'custom-pipeline');
    const matchingPack = selectedSource ? packProfileForSource(selectedSource) : undefined;
    const processing = [...(matchingPack ? [matchingPack] : []), ...customPipelines].filter(
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

  // Steps shown depend on run mode AND whether there's a real choice to make.
  // Collapse any step that offers a single option (its template default is
  // already applied), so opinionated use cases (AI Telemetry, AI Investigator)
  // become a 1-2 click flow instead of clicking Next through fixed screens.
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
      // Nothing to decide (0 or 1 option) — keep the default and skip the step.
      if (optionCount(key) <= 1) return false;
      return true;
    }).map((key) => ({ key, label: STEP_LABELS[key] }));
  }, [useCase, runMode, options, selectedSource, searchEngines]);

  if (!selection || !useCase || !runMode || !options) {
    return <Navigate to="/" replace />;
  }

  const isLast = stepIndex >= activeSteps.length - 1;
  const finish = () => {
    runPreflightChecks();
    regeneratePlan();
    navigate('/review');
  };

  // Selecting a source also aligns the pack to that source's data, unless the SE
  // has deliberately chosen a custom pipeline.
  const selectSource = (sourceId: string) => {
    const src = sourceProfileById.get(sourceId);
    const current = processingProfileById.get(selection!.processingId);
    const patch: { sourceProfileId: string; processingId?: string } = {
      sourceProfileId: sourceId,
    };
    if (src && current?.kind !== 'custom-pipeline') {
      const match = packProfileForSource(src);
      if (match) patch.processingId = match.id;
    }
    updateSelection(patch);
  };

  const next = () => {
    if (isLast) finish();
    else setStepIndex((i) => i + 1);
  };
  const back = () => {
    if (stepIndex === 0) navigate('/');
    else setStepIndex((i) => i - 1);
  };

  // Lightning mode may expose zero/one step; guard the index.
  const currentKey = activeSteps[stepIndex]?.key;

  // The AI-telemetry path accelerates its Lake dataset onto a Search engine, so
  // it exposes an engine selector alongside the destination step.
  const showEngineSelector = selectedSource?.family === 'ai-telemetry';
  const selectedEngineId = selection.engineId ?? DEFAULT_SEARCH_ENGINE_ID;

  // Resolved selections, for the collapsed "nothing to configure" summary.
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
            : 'Defaults are pre-selected for a fast, credible run. Adjust only what you want to change.'}
        </p>
      </div>

      {activeSteps.length > 1 && (
        <Stepper steps={activeSteps} activeIndex={stepIndex} onStepClick={setStepIndex} />
      )}

      <div className="wizard-body">
        {!currentKey && (
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

        {currentKey === 'source' && (
          <div className="option-list">
            {options.sources.map((s) => (
              <OptionCard
                key={s.id}
                title={s.displayName}
                description={s.summary}
                badge={s.protocol}
                selected={selection.sourceProfileId === s.id}
                onClick={() => selectSource(s.id)}
                meta={`Default listener port ${s.defaultPort}`}
              />
            ))}
          </div>
        )}

        {currentKey === 'presentation' && (
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
        )}

        {currentKey === 'destination' &&
          (showEngineSelector ? (
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
          ))}

        {currentKey === 'processing' && (
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
        )}

        {currentKey === 'overlays' && (
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
        )}

        {currentKey === 'visual' && (
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
        )}
      </div>

      <div className="wizard-footer">
        <button className="btn btn-ghost" onClick={back}>
          {stepIndex === 0 ? 'Cancel' : 'Back'}
        </button>
        <button className="btn btn-primary" onClick={next}>
          {isLast ? 'Review deployment' : 'Next'}
        </button>
      </div>
    </div>
  );
}
