'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Copy } from 'lucide-react';
import { useWalletStore } from '@/stores/useWalletStore';
import { useToast } from '@/components/Toast';
import PinModal from '@/components/PinModal';
import { BottomNav } from '@/components/BottomNav';
import SeedInput from '@/components/SeedInput';
import MnemonicDisplay from '@/components/MnemonicDisplay';
import { MAX_WALLETS } from '@solwallet/config';
import { getUserProfile } from '@/lib/api/user';
import type { UserProfile } from '@/lib/api/user';
import { buildShareText } from '@/lib/referral';
import { isLoggedIn } from '@/lib/api/auth';
import { useT } from '@/lib/i18n';

export default function SettingsPage() {
  const { t, locale, setLocale } = useT();

  const {
    wallets,
    activeWalletId,
    isInitialized,
    initialize,
    createWallet,
    importWallet,
    activateWallet,
    deleteWallet,
  } = useWalletStore();

  const { showToast } = useToast();

  // 모달 상태
  const [showCreatePin, setShowCreatePin] = useState(false);
  const [showImportSeed, setShowImportSeed] = useState(false);
  const [showImportPin, setShowImportPin] = useState(false);
  const [pendingMnemonic, setPendingMnemonic] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [createdMnemonic, setCreatedMnemonic] = useState('');
  const [pinError, setPinError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | false>(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // 초기화
  useEffect(() => {
    if (!isLoggedIn()) {
      window.location.href = '/login';
      return;
    }
    if (!isInitialized) {
      initialize();
    }
    // 프로필 조회
    getUserProfile().then(setProfile).catch(() => {});
  }, [isInitialized, initialize]);

  // 새 지갑 생성 → PIN 설정
  const handleCreateWallet = async (pin: string) => {
    setPinError('');
    setActionLoading('create');
    try {
      const nextIndex = wallets.length;
      const result = await createWallet(`Wallet ${nextIndex + 1}`, pin);
      setCreatedMnemonic(result.mnemonic);
      setShowCreatePin(false);
      setShowMnemonic(true);
    } catch (err) {
      setPinError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setActionLoading('');
    }
  };

  // 시드 임포트 → 시드 입력 완료 → PIN 설정
  const handleSeedConfirm = (mnemonic: string) => {
    setPendingMnemonic(mnemonic);
    setShowImportSeed(false);
    setShowImportPin(true);
  };

  const handleImportWallet = async (pin: string) => {
    setPinError('');
    setActionLoading('import');
    try {
      const nextIndex = wallets.length;
      await importWallet(pendingMnemonic, `Wallet ${nextIndex + 1}`, pin);
      setShowImportPin(false);
      setPendingMnemonic('');
      showToast(t('settings.walletImported'));
    } catch (err) {
      setPinError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setActionLoading('');
    }
  };

  // 지갑 활성 전환
  const handleActivate = async (walletId: string) => {
    if (walletId === activeWalletId) return;
    setActionLoading(`activate-${walletId}`);
    try {
      await activateWallet(walletId);
      showToast(t('settings.walletActivated'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.activateFailed'));
    } finally {
      setActionLoading('');
    }
  };

  // 지갑 삭제
  const handleDelete = async (walletId: string) => {
    if (!confirm(t('settings.deleteConfirm'))) return;
    setActionLoading(`delete-${walletId}`);
    try {
      await deleteWallet(walletId);
      showToast(t('settings.walletDeleted'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.deleteFailed'));
    } finally {
      setActionLoading('');
    }
  };

  // 공개키 축약 표시
  const truncateKey = (key: string) =>
    `${key.slice(0, 4)}...${key.slice(-4)}`;

  return (
    <main className="min-h-screen p-4 pb-24">
      {/* Header */}
      <header className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-xl">←</Link>
        <h1 className="text-xl font-bold">{t('settings.title')}</h1>
      </header>

      {/* Language Selector */}
      <section className="mb-4">
        <div className="bg-gray-800/50 rounded-xl p-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">{t('settings.language')}</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => setLocale('en')}
                aria-label="English"
                title="English"
                className={`flex items-center justify-center w-6 h-6 rounded-md overflow-hidden transition ${
                  locale === 'en' ? 'ring-2 ring-primary-400' : 'opacity-60 hover:opacity-100'
                }`}
              >
                <img src="https://flagcdn.com/gb.svg" alt="" className="w-full h-full object-cover" />
              </button>
              <button
                onClick={() => setLocale('ko')}
                aria-label="한국어"
                title="한국어"
                className={`flex items-center justify-center w-6 h-6 rounded-md overflow-hidden transition ${
                  locale === 'ko' ? 'ring-2 ring-primary-400' : 'opacity-60 hover:opacity-100'
                }`}
              >
                <img src="https://flagcdn.com/kr.svg" alt="" className="w-full h-full object-cover" />
              </button>
              <button
                onClick={() => setLocale('zh')}
                aria-label="中文"
                title="中文"
                className={`flex items-center justify-center w-6 h-6 rounded-md overflow-hidden transition ${
                  locale === 'zh' ? 'ring-2 ring-primary-400' : 'opacity-60 hover:opacity-100'
                }`}
              >
                <img src="https://flagcdn.com/cn.svg" alt="" className="w-full h-full object-cover" />
              </button>
              <button
                onClick={() => setLocale('ja')}
                aria-label="日本語"
                title="日本語"
                className={`flex items-center justify-center w-6 h-6 rounded-md overflow-hidden transition ${
                  locale === 'ja' ? 'ring-2 ring-primary-400' : 'opacity-60 hover:opacity-100'
                }`}
              >
                <img src="https://flagcdn.com/jp.svg" alt="" className="w-full h-full object-cover" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Wallet Management */}
      <section className="mb-6">
        <div className="space-y-2">
          <button
            onClick={() => {
              if (wallets.length >= MAX_WALLETS) {
                showToast(t('settings.maxWallets', { max: MAX_WALLETS }));
                return;
              }
              setShowCreatePin(true);
            }}
            disabled={!!actionLoading}
            className="w-full bg-gray-800/50 rounded-xl p-4 text-left flex items-center justify-between active:bg-gray-700/50 transition-colors"
          >
            <p className="font-medium">{t('settings.createWallet')}</p>
            <span className="text-gray-500">→</span>
          </button>
          <button
            onClick={() => {
              if (wallets.length >= MAX_WALLETS) {
                showToast(t('settings.maxWallets', { max: MAX_WALLETS }));
                return;
              }
              setShowImportSeed(true);
            }}
            disabled={!!actionLoading}
            className="w-full bg-gray-800/50 rounded-xl p-4 text-left flex items-center justify-between active:bg-gray-700/50 transition-colors"
          >
            <p className="font-medium">{t('settings.importSeed')}</p>
            <span className="text-gray-500">→</span>
          </button>
        </div>
      </section>

      {/* Wallet List */}
      <section className="mb-6">
        <div className="space-y-2">
          {wallets.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-sm">{t('settings.noWallets')}</p>
            </div>
          ) : (
            wallets.map((wallet) => (
              <div
                key={wallet.id}
                className={`bg-gray-800/50 rounded-xl p-3.5 ${
                  wallet.id === activeWalletId ? 'border border-primary-500/30' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  {/* 라벨 */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-medium text-sm">{wallet.label}</span>
                    {wallet.id === activeWalletId && (
                      <span className="text-[9px] bg-primary-600 px-1.5 py-0.5 rounded text-white">
                        {t('settings.active')}
                      </span>
                    )}
                  </div>
                  {/* 주소 */}
                  <p className="text-xs text-gray-400 font-mono truncate flex-1 min-w-0">
                    {wallet.publicKey ? truncateKey(wallet.publicKey) : '—'}
                  </p>
                  {/* 액션 버튼 */}
                  {wallets.length > 1 && (
                    <div className="flex gap-1.5 shrink-0">
                      {wallet.id !== activeWalletId && (
                        <button
                          onClick={() => handleActivate(wallet.id)}
                          disabled={!!actionLoading}
                          className="text-[10px] px-2 py-1 rounded-lg bg-primary-600/20 text-primary-400 hover:bg-primary-600/30 transition disabled:opacity-50"
                        >
                          {t('settings.activate')}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(wallet.id)}
                        disabled={!!actionLoading}
                        className="text-[10px] px-2 py-1 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition disabled:opacity-50"
                      >
                        {t('settings.delete')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Referral Section — 헤더 없이 본문만 */}
      {profile && (
        <section className="mb-6">
          <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
            {/* 내 추천 코드 + 링크 함께 복사 */}
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">{t('settings.myReferralCode')}</span>
              <button
                onClick={() => {
                  if (profile.referralCode) {
                    // 코드 + 링크 함께 복사
                    const shareText = buildShareText(profile.referralCode);
                    navigator.clipboard.writeText(shareText).then(
                      () => showToast(t('settings.copied')),
                      () => showToast(t('settings.copyFailed')),
                    );
                  }
                }}
                className="text-xs bg-primary-600/20 text-primary-400 px-3 py-1.5 rounded-lg hover:bg-primary-600/30 transition"
              >
                {profile.referralCode} <Copy className="inline w-3.5 h-3.5 ml-1" />
              </button>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">{t('settings.friendsInvited')}</span>
              <span className="font-medium">{t('settings.friendsCount', { count: profile.referralCount })}</span>
            </div>
            {profile.referrer && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{t('settings.myReferrer')}</span>
                <span>{profile.referrer.username || profile.referrer.first_name}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* App Info — 헤더 없이 본문만 */}
      <section className="mb-6">
        <div className="bg-gray-800/50 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">{t('settings.version')}</span>
            <span>v0.2.0</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">{t('settings.network')}</span>
            <span>Mainnet</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">DEX</span>
            <span>Manifest.trade</span>
          </div>
        </div>
      </section>

      {/* Bottom Nav */}
      <BottomNav />

      {/* ─── Modals ─── */}

      {/* 새 지갑 PIN 설정 */}
      <PinModal
        isOpen={showCreatePin}
        title={t('settings.pinTitle')}
        subtitle={t('settings.pinSubtitleCreate')}
        onConfirm={handleCreateWallet}
        onCancel={() => setShowCreatePin(false)}
        error={pinError}
      />

      {/* 시드 임포트 — 시드 입력 */}
      <SeedInput
        isOpen={showImportSeed}
        onConfirm={handleSeedConfirm}
        onCancel={() => setShowImportSeed(false)}
      />

      {/* 시드 임포트 — PIN 설정 */}
      <PinModal
        isOpen={showImportPin}
        title={t('settings.pinTitle')}
        subtitle={t('settings.pinSubtitleImport')}
        onConfirm={handleImportWallet}
        onCancel={() => {
          setShowImportPin(false);
          setPendingMnemonic('');
        }}
        error={pinError}
      />

      {/* 시드 구문 표시 (최초 생성 시만) */}
      <MnemonicDisplay
        isOpen={showMnemonic}
        mnemonic={createdMnemonic}
        onClose={() => {
          setShowMnemonic(false);
          setCreatedMnemonic('');
        }}
      />
    </main>
  );
}