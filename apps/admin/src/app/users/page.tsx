export default function UsersPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">👥 회원 관리</h1>

      {/* Referrer 7-day Stats */}
      <div className="bg-white rounded-xl shadow p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">🥇 방장 7일 실적</h2>
        <p className="text-gray-500 text-sm">지난 7일 동안 각 방장이 가입시킨 신규 하위 유저 수</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3">방장</th>
                <th className="text-left py-2 px-3">Telegram UID</th>
                <th className="text-right py-2 px-3">7일 신규</th>
                <th className="text-right py-2 px-3">총 하위 유저</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="text-center py-8 text-gray-400">
                  데이터가 없습니다
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* User Balance List */}
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-bold mb-4">💰 유저 잔고 조회</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3">유저</th>
                <th className="text-left py-2 px-3">지갑 주소</th>
                <th className="text-right py-2 px-3">SOL</th>
                <th className="text-right py-2 px-3">USDT</th>
                <th className="text-right py-2 px-3">총 자산</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} className="text-center py-8 text-gray-400">
                  데이터가 없습니다
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
