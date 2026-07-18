'use client';

/**
 * 미니멀 SVG Sparkline (라이브러리 없이)
 * ROI 시계열 데이터를 부드러운 곡선으로 시각화
 */

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
}

export function Sparkline({
  data,
  width = 240,
  height = 50,
  stroke = '#10b981',
  fill = 'rgba(16, 185, 129, 0.12)',
  strokeWidth = 1.5,
}: SparklineProps) {
  if (!data || data.length < 2) {
    // 데이터 부족 시 평평한 baseline
    return (
      <svg width={width} height={height} className="block">
        <line
          x1={0}
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
  const w = width - padding * 2;
  const h = height - padding * 2;

  // 포인트 좌표 계산
  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * w;
    // 값이 클수록 위로 (y 작을수록 위)
    const y = padding + h - ((v - min) / range) * h;
    return [x, y] as const;
  });

  // 부드러운 곡선을 위한 path 생성 (Catmull-Rom → Bezier 근사)
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const cx = (x0 + x1) / 2;
    path += ` Q ${cx} ${y0} ${cx} ${(y0 + y1) / 2} T ${x1} ${y1}`;
  }

  // 영역 채우기 (path 닫기)
  const areaPath =
    `${path} L ${points[points.length - 1][0]} ${height} ` +
    `L ${points[0][0]} ${height} Z`;

  // 마지막 포인트 강조
  const lastPoint = points[points.length - 1];
  const isUp = data[data.length - 1] >= data[0];

  return (
    <svg width={width} height={height} className="block">
      <path d={areaPath} fill={fill} stroke="none" />
      <path
        d={path}
        fill="none"
        stroke={isUp ? stroke : '#ef4444'}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={lastPoint[0]}
        cy={lastPoint[1]}
        r={2.5}
        fill={isUp ? stroke : '#ef4444'}
      />
    </svg>
  );
}
