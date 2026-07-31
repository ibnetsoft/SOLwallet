'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, Activity } from 'lucide-react';
import { getOrderHistory } from '@/lib/api/orders';
import { getTransferHistory } from '@/lib/api/transfers';
import { useWalletStore } from '@/stores/useWalletStore';
import { BottomNav } from '@/components/BottomNav';
import { isLoggedIn } from '@/lib/api/auth';
import { useT } from '@/lib/i18n';

type TransactionType = 'buy' | 'sell' | 'deposit' | 'withdraw';

interface UnifiedTx {
  id: string;
  type: TransactionType;
  status: string;
  createdAt: string;
  tokenSymbol: string;
  // Order specific
  price?: number;
  quantity?: number;
  // Transfer specific
  amount?: number;
}

interface UnifiedTx {
  id: string;
  type: TransactionType;
  status: string;
  createdAt: string;
  tokenSymbol: string;
  // Order specific
  price?: number;
  quantity?: number;
  // Transfer specific
  amount?: number;
  // Tx signature for Solscan link
  txSignature?: string;
}

export default function TransactionsPage() {
  const { t, locale } = useT();
  const router = useRouter();
  const { activeWalletId, wallets } = useWalletStore();
  const activeWallet = wallets.find((w) => w.id === activeWalletId);
  
  const [transactions, setTransactions] = useState<UnifiedTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell' | 'deposit' | 'withdraw'>('all');

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }
    loadData();
  }, [router, activeWallet]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const allTx: UnifiedTx[] = [];

      // 1. Fetch Orders from Backend
      try {
        const data = await getOrderHistory();
        const rawItems = data.items ?? data;
        const normalizedOrders: UnifiedTx[] = (rawItems as Record<string, unknown>[] || []).map((r) => ({
          id: String(r.id ?? ''),
          type: (r.side as 'buy' | 'sell') ?? 'buy',
          price: Number(r.price ?? 0),
          quantity: Number(r.quantity ?? 0),
          status: String(r.status ?? 'unknown'),
          createdAt: r.created_at ? String(r.created_at) : r.createdAt ? String(r.createdAt) : new Date().toISOString(),
          tokenSymbol: r.token_symbol ? String(r.token_symbol) : r.symbol ? String(r.symbol) : 'TOKEN',
          txSignature: r.tx_signature ? String(r.tx_signature) : undefined,
        }));
        allTx.push(...normalizedOrders);
      } catch (err) {
        console.error('Failed to load orders', err);
      }

      // 2. Fetch Transfers from On-Chain (if wallet exists)
      if (activeWallet?.publicKey) {
        try {
          const transfers = await getTransferHistory(activeWallet.publicKey, 20);
          const normalizedTransfers: UnifiedTx[] = transfers.map((tr) => ({
            id: tr.id,
            type: tr.type,
            amount: tr.amount,
            status: tr.status,
            createdAt: tr.createdAt,
            tokenSymbol: tr.tokenSymbol,
            txSignature: tr.id, // transfer의 id는 tx_signature
          }));
          allTx.push(...normalizedTransfers);
        } catch (err) {
          console.error('Failed to load transfers', err);
        }
      }

      // 3. Sort by date descending
      allTx.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      setTransactions(allTx);
    } finally {
      setLoading(false);
    }
  }, [activeWallet]);

  const filtered = filter === 'all' ? transactions : transactions.filter((o) => o.type === filter);

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

      {/* Filter - Scrollable horizontally to fit new tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide">
        {(['all', 'buy', 'sell', 'deposit', 'withdraw'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
              filter === f
                ? 'bg-primary-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {f === 'all' ? t('tx.all') :
             f === 'buy' ? t('tx.buy') :
             f === 'sell' ? t('tx.sell') :
             f === 'deposit' ? t('home.deposit') : t('home.withdraw')}
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
            const isBuy = o.type === 'buy';
            const isSell = o.type === 'sell';
            const isDeposit = o.type === 'deposit';
            const isWithdraw = o.type === 'withdraw';
            
            const isPositive = isBuy || isDeposit;
            
            const total = (o.price || 0) * (o.quantity || 0);
            const solscanUrl = o.txSignature ? `https://solscan.io/tx/${o.txSignature}` : null;

            return (
              <div
                key={o.id}
                className={`bg-gray-800/50 rounded-xl p-3.5 flex items-center justify-between ${solscanUrl ? 'cursor-pointer hover:bg-gray-800 transition' : ''}`}
                onClick={() => solscanUrl && window.open(solscanUrl, '_blank')}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      isPositive ? 'bg-green-500/15' : 'bg-red-500/15'
                    }`}
                  >
                    {isPositive ? (
                      <ArrowDownToLine className="w-4 h-4 text-green-400" strokeWidth={2} />
                    ) : (
                      <ArrowUpFromLine className="w-4 h-4 text-red-400" strokeWidth={2} />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium capitalize">
                      {o.type === 'buy' ? t('tx.buy') : o.type === 'sell' ? t('tx.sell') : o.type === 'deposit' ? t('home.deposit') : o.type === 'withdraw' ? t('home.withdraw') : o.type} · {o.tokenSymbol}
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
                    {o.txSignature && (
                      <a
                        href={`https://solscan.io/tx/${o.txSignature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[9px] text-gray-600 hover:text-primary-400 transition mt-0.5 block font-mono truncate max-w-[120px]"
                        title={o.txSignature}
                      >
                        {o.txSignature.slice(0, 8)}...{o.txSignature.slice(-4)} ↗
                      </a>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-medium tabular-nums ${isPositive ? 'text-green-400' : ''}`}>
                    {isPositive ? '+' : '-'}
                    {isDeposit || isWithdraw ? o.amount?.toFixed(5) : o.quantity?.toFixed(5)}
                  </p>
                  {(isBuy || isSell) && (
                    <p className="text-[10px] text-gray-500 tabular-nums mt-0.5">
                      ${total.toFixed(2)}
                    </p>
                  )}
                  {(isDeposit || isWithdraw) && (
                    <p className="text-[10px] text-gray-500 mt-0.5 capitalize">
                      {o.status === 'completed' ? (isDeposit ? t('home.deposit') : t('home.withdraw')) : o.status}
                    </p>
                  )}
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