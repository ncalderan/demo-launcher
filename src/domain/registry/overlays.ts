import type { PolicyOverlay } from '../types';

/**
 * Policy overlays layer onto a core template. They add pipeline/route behavior
 * (and sometimes a destination) rather than being standalone demos, so the
 * strongest operational stories can carry Public Sector policy narratives.
 */
export const policyOverlays: PolicyOverlay[] = [
  {
    id: 'overlay-sovereignty',
    displayName: 'Sovereignty / residency',
    summary: 'Restrict routing and keep an in-region copy; forward only required subsets.',
    themes: ['controlled-routing', 'operational-resilience'],
    pipelineAdditions: [
      'Classify events by region and data class',
      'Stamp events with routing/classification labels',
    ],
    routeAdditions: ['Keep an in-region copy; forward only required subsets downstream'],
    addsDestinationRole: 'compliance-archive',
    visualAdditions: ['Routing by data class', 'In-region copy confirmation'],
  },
  {
    id: 'overlay-pii',
    displayName: 'PII / sensitive-data',
    summary: 'Detect and mask sensitive fields; restrict forwarding of protected data.',
    themes: ['pii-aware-handling'],
    pipelineAdditions: [
      'Detect sensitive fields / patterns',
      'Mask or hash selected values',
      'Drop fields that must not leave the control boundary',
    ],
    routeAdditions: ['Route flagged/protected data to a controlled review path'],
    visualAdditions: ['Sensitive fields detected', 'Masked field counts'],
  },
  {
    id: 'overlay-compliance-archive',
    displayName: 'Compliance archive',
    summary: 'Add long-retention or separate archive routing behavior.',
    themes: ['operational-resilience', 'cost-control'],
    pipelineAdditions: ['Tag events for long-retention archive'],
    routeAdditions: ['Fork a durable archive copy to long-retention storage'],
    addsDestinationRole: 'compliance-archive',
    visualAdditions: ['Archive copy confirmation'],
  },
];

export const policyOverlayById = new Map(policyOverlays.map((o) => [o.id, o]));
