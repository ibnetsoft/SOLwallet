export default function TokensPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">🪙 토큰 관리</h1>

      {/* Add Token Form */}
      <div className="bg-white rounded-xl shadow p-6 mb-6">
        <h2 className="text-lg font-bold mb-4">새 토큰 등록</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              스마트 컨트랙트 (CA)
            </label>
            <input
              type="text"
              placeholder="Mint Address"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              심볼
            </label>
            <input
              type="text"
              placeholder="예: SOL, USDT, FACT"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              소수점 (Decimals)
            </label>
            <input
              type="number"
              placeholder="9"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
        </div>
        <button className="mt-4 bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition">
          토큰 등록
        </button>
      </div>

      {/* Token List */}
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-bold mb-4">등록된 토큰</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3">심볼</th>
                <th className="text-left py-2 px-3">Mint Address</th>
                <th className="text-center py-2 px-3">Decimals</th>
                <th className="text-center py-2 px-3">상태</th>
                <th className="text-right py-2 px-3">관리</th>
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
