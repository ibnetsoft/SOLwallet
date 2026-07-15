/**
 * 로딩 스켈레톤 컴포넌트들
 */

export function SkeletonBox({ className }: { className?: string }) {
  return (
    <div className={`bg-gray-700/50 rounded-lg animate-pulse ${className || ''}`} />
  );
}

export function SkeletonText({ lines = 1, className }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className || ''}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBox
          key={i}
          className={`h-4 ${i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
      <SkeletonBox className="h-4 w-1/3" />
      <SkeletonBox className="h-8 w-2/3" />
    </div>
  );
}

export function SkeletonStatCard() {
  return (
    <div className="bg-gray-800/50 rounded-xl p-4">
      <SkeletonBox className="h-3 w-20 mb-2" />
      <SkeletonBox className="h-7 w-16" />
    </div>
  );
}

export function SkeletonTableRow({ cols = 5 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-4 py-3 px-4">
      {Array.from({ length: cols }).map((_, i) => (
        <SkeletonBox
          key={i}
          className={`h-4 flex-1 ${i === 0 ? 'w-1/4' : ''}`}
        />
      ))}
    </div>
  );
}
