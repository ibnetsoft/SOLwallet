export default function TransactionsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">📋 트랜잭션 모니터링</h1>

      <div className="bg-white rounded-xl shadow p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3">시간</th>
                <th className="text-left py-2 px-3">유저</th>
                <th className="text-left py-2 px-3">종류</th>
                <th className="text-left py-2 px-3">토큰</th>
                <th className="text-right py-2 px-3">수량</th>
                <th className="text-right py-2 px-3">수수료</th>
                <th className="text-left py-2 px-3">Tx Hash</th>
                <th className="text-center py-2 px-3">상태</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={8} className="text-center py-8 text-gray-400">
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
