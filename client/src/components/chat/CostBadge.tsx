import type { SDKResult } from '../../hooks/useSDKMessages.ts';

interface CostBadgeProps {
  result: SDKResult;
}

export default function CostBadge({ result }: CostBadgeProps) {
  const duration = result.durationMs < 1000
    ? `${result.durationMs}ms`
    : `${(result.durationMs / 1000).toFixed(1)}s`;

  const tokens = result.inputTokens + result.outputTokens;
  const tokenStr = tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);

  return (
    <div className="flex items-center justify-center gap-3 py-1.5 text-[10px] text-text-dim">
      {result.costUSD > 0 && (
        <span>${result.costUSD.toFixed(4)}</span>
      )}
      <span>{tokenStr} tokens</span>
      <span>{duration}</span>
    </div>
  );
}
