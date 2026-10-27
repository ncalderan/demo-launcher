import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  DeploymentPlan,
  DeploymentResult,
  PreflightResult,
  ResetResult,
  RunModeId,
  SavedScenario,
  ScenarioSelection,
  SearchEngine,
  ValidationResult,
  WorkerGroupRef,
} from '../domain/types';
import { searchEngines as staticSearchEngines } from '../domain/registry';
import { buildDeploymentPlan, selectionWithDefaults } from '../services/deploymentPlanner';
import { listSearchEngines } from '../services/criblApi';
import { fetchWorkerGroups, runPreflight } from '../services/preflightService';

/**
 * Central launcher state: the in-progress wizard selection plus the artifacts
 * produced by the services (preflight, plan, deployment, validation, reset).
 */
interface LauncherState {
  selection: ScenarioSelection | null;
  preflight: PreflightResult | null;
  plan: DeploymentPlan | null;
  deployment: DeploymentResult | null;
  validation: ValidationResult | null;
  reset: ResetResult | null;
  /** Stream worker groups available to deploy into. */
  workerGroups: WorkerGroupRef[];
  /** Cribl Search engines discovered on this stack (falls back to defaults). */
  searchEngines: SearchEngine[];

  /** Start a new scenario from a use case + run mode + target group. */
  startScenario: (useCaseId: string, runMode?: RunModeId, groupId?: string) => void;
  /** Load a saved scenario definition (SE handoff). */
  loadScenario: (scenario: SavedScenario) => void;
  /** Merge partial changes into the current selection. */
  updateSelection: (patch: Partial<ScenarioSelection>) => void;
  /** Run preflight checks against the current selection. */
  runPreflightChecks: () => PreflightResult | null;
  /** Recompute the deployment plan (applies current preflight/fallback). */
  regeneratePlan: () => DeploymentPlan | null;
  setDeployment: (result: DeploymentResult | null) => void;
  setValidation: (result: ValidationResult | null) => void;
  setReset: (result: ResetResult | null) => void;
  /** Clear everything (used by reset / start over). */
  clearAll: () => void;
}

const LauncherContext = createContext<LauncherState | null>(null);

export function LauncherProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<ScenarioSelection | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [plan, setPlan] = useState<DeploymentPlan | null>(null);
  const [deployment, setDeployment] = useState<DeploymentResult | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [reset, setReset] = useState<ResetResult | null>(null);
  const [workerGroups, setWorkerGroups] = useState<WorkerGroupRef[]>([
    { id: 'default', name: 'default' },
  ]);
  const [searchEngines, setSearchEngines] = useState<SearchEngine[]>(staticSearchEngines);

  useEffect(() => {
    void fetchWorkerGroups().then(setWorkerGroups);
  }, []);

  // Discover the stack's actual Search engines so the AI-telemetry selector shows
  // real engines (portability). Keep the static defaults if none are found or the
  // endpoint isn't reachable (e.g. non-cloud stacks).
  useEffect(() => {
    void listSearchEngines()
      .then((engines) => {
        if (!engines.length) return;
        setSearchEngines(
          engines.map((e) => ({
            id: e.id,
            displayName: e.id,
            summary: e.description || `Cribl Search engine "${e.id}" on this stack.`,
          })),
        );
      })
      .catch(() => {
        /* keep static fallback */
      });
  }, []);

  const resetArtifacts = useCallback(() => {
    setPreflight(null);
    setPlan(null);
    setDeployment(null);
    setValidation(null);
    setReset(null);
  }, []);

  const startScenario = useCallback(
    (useCaseId: string, runMode: RunModeId = 'standard', groupId = 'default') => {
      setSelection(selectionWithDefaults(useCaseId, { runMode, groupId }));
      resetArtifacts();
    },
    [resetArtifacts],
  );

  const loadScenario = useCallback(
    (scenario: SavedScenario) => {
      setSelection(scenario.selection);
      resetArtifacts();
    },
    [resetArtifacts],
  );

  const updateSelection = useCallback((patch: Partial<ScenarioSelection>) => {
    setSelection((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const runPreflightChecks = useCallback(() => {
    if (!selection) return null;
    const result = runPreflight(selection);
    setPreflight(result);
    return result;
  }, [selection]);

  const regeneratePlan = useCallback(() => {
    if (!selection) return null;
    const next = buildDeploymentPlan(selection, preflight ?? undefined);
    setPlan(next);
    return next;
  }, [selection, preflight]);

  const clearAll = useCallback(() => {
    setSelection(null);
    resetArtifacts();
  }, [resetArtifacts]);

  const value = useMemo<LauncherState>(
    () => ({
      selection,
      preflight,
      plan,
      deployment,
      validation,
      reset,
      workerGroups,
      searchEngines,
      startScenario,
      loadScenario,
      updateSelection,
      runPreflightChecks,
      regeneratePlan,
      setDeployment,
      setValidation,
      setReset,
      clearAll,
    }),
    [
      selection,
      preflight,
      plan,
      deployment,
      validation,
      reset,
      workerGroups,
      searchEngines,
      startScenario,
      loadScenario,
      updateSelection,
      runPreflightChecks,
      regeneratePlan,
      clearAll,
    ],
  );

  return <LauncherContext.Provider value={value}>{children}</LauncherContext.Provider>;
}

export function useLauncher(): LauncherState {
  const ctx = useContext(LauncherContext);
  if (!ctx) {
    throw new Error('useLauncher must be used within a LauncherProvider');
  }
  return ctx;
}
