import type { RunMode } from '../types';

/**
 * Run modes control how much the wizard asks. Lightning auto-accepts template
 * defaults for speed on live calls; POV exposes everything for a thorough,
 * hand-off-ready setup.
 */
export const runModes: RunMode[] = [
  {
    id: 'lightning',
    displayName: 'Lightning Demo',
    summary: 'Fastest path. Accept the opinionated defaults and go.',
    bestFor: 'Live calls',
    exposedSteps: ['visual'],
    showPreflightDetail: false,
    showHandoffDetail: false,
  },
  {
    id: 'standard',
    displayName: 'Standard Demo',
    summary: 'Balanced setup for a full technical demo.',
    bestFor: 'Scheduled technical demo',
    exposedSteps: ['source', 'destination', 'processing', 'visual'],
    showPreflightDetail: true,
    showHandoffDetail: false,
  },
  {
    id: 'pov',
    displayName: 'POV Mode',
    summary: 'Explicit configuration, validation, and handoff detail.',
    bestFor: 'POV / evaluation & handoff',
    exposedSteps: ['source', 'presentation', 'destination', 'processing', 'overlays', 'visual'],
    showPreflightDetail: true,
    showHandoffDetail: true,
  },
];

export const runModeById = new Map(runModes.map((m) => [m.id, m]));
