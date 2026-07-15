import Link from 'next/link';

export default function AdminDashboard() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">📊 대시보드</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow p-6">
          <p className="text-gray-500 text-sm">총 가입 유저</p>
          <p className="text-3xl font-bold mt-1">0</p>
        </div>
        <div className="bg-white rounded-xl shadow p-6">
          <p className="text-gray-500 text-sm">오늘 신규 가입</p>
          <p className="text-3xl font-bold mt-1">0</p>
        </div>
        <div className="bg-white rounded-xl shadow p-6">
          <p className="text-gray-500 text-sm">수수료 수익 (USDT)</p>
          <p className="text-3xl font-bold mt-1">$0.00</p>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/users"
          className="bg-white rounded-xl shadow p-6 hover:shadow-lg transition"
        >
          <h2 className="text-lg font-bold mb-2">👥 회원 관리</h2>
          <p className="text-gray-500 text-sm">유저 목록, 잔고 조회, 방장 7일 실적</p>
        </Link>
        <Link
          href="/tokens"
          className="bg-white rounded-xl shadow p-6 hover:shadow-lg transition"
        >
          <h2 className="text-lg font-bold mb-2">🪙 토큰 관리</h2>
          <p className="text-gray-500 text-sm">미니앱 노출 토큰 등록/삭제</p>
        </Link>
        <Link
          href="/transactions"
          className="bg-white rounded-xl shadow p-6 hover:shadow-lg transition"
        >
          <h2 className="text-lg font-bold mb-2">📋 트랜잭션</h2>
          <p className="text-gray-500 text-sm">거래 내역 및 Tx Hash 모니터링</p>
        </Link>
      </div>
    </div>
  );
}
