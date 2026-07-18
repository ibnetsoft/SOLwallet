'use client';

/**
 * 미니멀 SVG Sparkline (라이브러리 없이)
 * - 그라데이션 영역 채우기 (위→아래로 투명하게)
 * - 상향=초록, 하향=빨강
 * - startOffset: 차트의 시작 x 위치 (픽셀). 기본 0 (왼쪽 끝).
 *   수익률 텍스트 오른쪽에서 시작하도록 할 때 사용.
 */

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  /** 차트 영역 시작 x 오프셋 (픽셀) */
  startOffset?: number;
}

let gradIdCounter = 0;

export function Sparkline({
  data,
  width = 280,
  height = 48,
  strokeWidth = 1.8,
  startOffset = 0,
}: SparklineProps) {
  // 고유 gradient id (인스턴스별)
  const gradId = `spark-grad-${++gradIdCounter}`;

  // 데이터 부족 시 평평한 baseline
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className="block">
        <line
          x1={startOffset}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#374151"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const padding = strokeWidth;
  // 차트 영역: startOffset ~ width
  const chartLeft = startOffset + padding;
  const chartRight = width - padding;
  const chartWidth = chartRight - chartLeft;
  const h = height - padding * 2;

  // 포인트 좌표 계산
  const points = data.map((v, i) => {
    const x = chartLeft + (i / (data.length - 1)) * chartWidth;
    const y = padding + h - ((v - min) / range) * h;
    return [x, y] as const;
  });

  // 부드러운 곡선 path (Quadratic 근사)
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const cx = (x0 + x1) / 2;
    path += ` Q ${cx} ${y0} ${cx} ${(y0 + y1) / 2} T ${x1} ${y1}`;
  }

  // 영역 채우기 path (아래쪽으로 닫기)
  const lastX = points[points.length - 1][0];
  const firstX = points[0][0];
  const areaPath = `${path} L ${lastX} ${height} L ${firstX} ${height} Z`;

  // 상향/하향 판별 — 마지막 vs 첫 번째
  const isUp = data[data.length - 1] >= data[0];
  const lineColor = isUp ? '#10b981' : '#ef4444';
  const fillColorTop = isUp ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)';
  const fillColorBottom = isUp ? 'rgba(16, 185, 129, 0)' : 'rgba(239, 68, 68, 0)';

  const lastPoint = points[points.length - 1];

  return (
    <svg width={width} height={height} className="block">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillColorTop} />
          <stop offset="100%" stopColor={fillColorBottom} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
      <path
        d={path}
        fill="none"
        stroke={lineColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r={2.8} fill={lineColor} />
    </svg>
  );
}
