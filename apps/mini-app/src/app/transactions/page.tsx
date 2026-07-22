'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, Activity } from 'lucide-react';
import { getOrderHistory } from '@/lib/api/orders';
import { BottomNav } from '@/components/BottomNav';
import { isLoggedIn } from '@/lib/api/auth';
import { useT } from '@/lib/i18n';

interface OrderItem {
  id: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  fee?: number;
  status: string;
  createdAt?: string;
  tokenSymbol?: string;
}

export default function TransactionsPage() {
  const { t, locale } = useT();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all');

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }
    loadOrders();
  }, [router]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getOrderHistory();
      // 응답 형태 정규화 (OrderHistoryPage.items)
      const rawItems = data.items ?? data;
      const normalized: OrderItem[] = (rawItems as Record<string, unknown>[] || []).map((raw) => {
        const r = raw as Record<string, unknown>;
        return {
          id: String(r.id ?? ''),
          side: (r.side as 'buy' | 'sell') ?? 'buy',
          price: Number(r.price ?? 0),
          quantity: Number(r.quantity ?? 0),
          fee: r.fee !== undefined ? Number(r.fee) : undefined,
          status: String(r.status ?? 'unknown'),
          createdAt: r.created_at ? String(r.created_at) : r.createdAt ? String(r.createdAt) : undefined,
          tokenSymbol: r.token_symbol ? String(r.token_symbol) : r.symbol ? String(r.symbol) : undefined,
        };
      });
      setOrders(normalized);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const filtered = filter === 'all' ? orders : orders.filter((o) => o.side === filter);

  const dateLocale = locale === 'ko' ? 'ko-KR' : 'en-US';

  return (
    <main className="min-h-screen p-4 pb-24">
      {/* Header */}
      <header className="flex items-center gap-3 mb-5">
        <Link
          href="/"
          className="p-1.5 rounded-lg hover:bg-gray-800 transition text-gray-400"
          aria-label={t('tx.back')}
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-lg font-bold">{t('tx.title')}</h1>
          <p className="text-[10px] text-gray-500">{t('tx.subtitle')}</p>
        </div>
      </header>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {(['all', 'buy', 'sell'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filter === f
                ? 'bg-primary-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {f === 'all' ? t('tx.all') : f === 'buy' ? t('tx.buy') : t('tx.sell')}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-10 text-gray-500 text-sm">{t('tx.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Activity className="w-10 h-10 text-gray-700 mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm text-gray-500">{t('tx.noHistory')}</p>
          <Link
            href="/trade"
            className="inline-block mt-4 text-xs text-primary-400 hover:underline"
          >
            {t('tx.startFirst')}
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => {
            const isBuy = o.side === 'buy';
            const total = o.price * o.quantity;
            return (
              <div
                key={o.id}
                className="bg-gray-800/50 rounded-xl p-3.5 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      isBuy ? 'bg-green-500/15' : 'bg-red-500/15'
                    }`}
                  >
                    {isBuy ? (
                      <ArrowDownToLine className="w-4 h-4 text-green-400" strokeWidth={2} />
                    ) : (
                      <ArrowUpFromLine className="w-4 h-4 text-red-400" strokeWidth={2} />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {isBuy ? t('tx.buy') : t('tx.sell')} · {o.tokenSymbol || 'TOKEN'}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {o.createdAt
                        ? new Date(o.createdAt).toLocaleString(dateLocale, {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '-'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums">
                    {o.quantity.toFixed(4)}
                  </p>
                  <p className="text-[10px] text-gray-500 tabular-nums mt-0.5">
                    ${total.toFixed(2)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom Nav */}
      <BottomNav />
    </main>
  );
}