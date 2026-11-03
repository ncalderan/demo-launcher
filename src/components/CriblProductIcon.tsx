import criblStream from '../assets/icons/cribl-stream.png';
import criblLake from '../assets/icons/cribl-lake.png';
import criblSearch from '../assets/icons/cribl-search.png';
import criblLakehouse from '../assets/icons/cribl-lakehouse.png';

const PRODUCT_ICONS = {
  stream: { src: criblStream, label: 'Cribl Stream' },
  lake: { src: criblLake, label: 'Cribl Lake' },
  search: { src: criblSearch, label: 'Cribl Search' },
  lakehouse: { src: criblLakehouse, label: 'Cribl Lakehouse' },
} as const;

/**
 * Real Cribl product icons (Stream / Lake / Search / Lakehouse) for the
 * landing tiles — which Cribl product a demo scenario primarily showcases.
 * Sourced from the architecture-builder project's asset set, not redrawn.
 */
export function CriblProductIcon({
  product,
  size = 22,
}: {
  product: 'stream' | 'lake' | 'search' | 'lakehouse';
  size?: number;
}) {
  const { src, label } = PRODUCT_ICONS[product];
  return (
    <span className="cribl-product-icon" style={{ width: size, height: size }}>
      <img src={src} alt={label} width={size} height={size} />
    </span>
  );
}
