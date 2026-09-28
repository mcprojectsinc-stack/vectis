import UsageChart from './MetricChart';
import type { Asset } from './AssetTable';

export default function AssetDetail({ asset }: { asset: Asset | null }) {
  if (!asset) return <div className="detail empty muted">Select an asset to see its live metrics.</div>;

  return (
    <div className="detail">
      <div className="detail-head">
        <h3>{asset.name}</h3>
        <div className="muted small">{asset.address} · {asset.type}</div>
      </div>
      <div className="chips">
        {Object.entries(asset.labels ?? {}).map(([k, v]) => (
          <span className="chip" key={k}>
            {k}: {String(v)}
          </span>
        ))}
      </div>
      <UsageChart assetId={asset.id} />
      {asset.metrics['latency.ms'] != null && (
        <div className="muted small latency">
          Latency {asset.metrics['latency.ms']} ms · reachable: {asset.metrics['reachable'] === 1 ? 'yes' : 'no'}
        </div>
      )}
    </div>
  );
}
