'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Copy } from 'lucide-react';
import { useWalletStore } from '@/stores/useWalletStore';
import { loadWallets } from '@/lib/storage';
import { useToast } from '@/components/Toast';
import PinModal from '@/components/PinModal';
import { BottomNav } from '@/components/BottomNav';
import SeedInput from '@/components/SeedInput';
import MnemonicDisplay from '@/components/MnemonicDisplay';
import { MAX_WALLETS } from '@solwallet/config';
import { getUserProfile } from '@/lib/api/user';
import type { UserProfile } from '@/lib/api/user';
import { getShareLink } from '@/lib/referral';
import { isLoggedIn, logout } from '@/lib/api/auth';
import { useT } from '@/lib/i18n';

export default function SettingsPage() {
  const { t, locale, setLocale } = useT();

  const {
    wallets,
    activeWalletId,
    isInitialized,
    walletsSynced,
    initialize,
    createWallet,
    importWallet,
    activateWallet,
    deleteWallet,
    decryptWalletSecret,
  } = useWalletStore();

  const { showToast } = useToast();

  // 모달 상태
  const [showCreatePin, setShowCreatePin] = useState(false);
  const [showImportSeed, setShowImportSeed] = useState(false);
  const [showImportPin, setShowImportPin] = useState(false);
  const [pendingMnemonic, setPendingMnemonic] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [showDeletePin, setShowDeletePin] = useState(false);
  const [pendingDeleteWalletId, setPendingDeleteWalletId] = useState<string | null>(null);
  const [deletePinError, setDeletePinError] = useState('');
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

  // 신규 유저 자동 지갑 생성 유도 — 서버 동기화 완료 후 실제로 지갑이 0개일 때만 실행.
  // ⚠️ 동기화 전 로컬 상태만 보고 판단하면, 다른 기기에서 이미 만든 지갑을 놓치고
  // 여기서 또 새 지갑을 만들어버리는 문제가 있었음 (모바일 가입 후 PC 접속 시 재현)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('create') !== 'true') return;
    if (!walletsSynced) return;

    window.history.replaceState(null, '', '/settings');
    if (wallets.length === 0) {
      setShowCreatePin(true);
    }
  }, [walletsSynced, wallets.length]);

  const getNextWalletLabel = () => {
    const numbers = wallets.map(w => {
      const match = w.label?.match(/^Wallet\s+(\d+)$/i);
      return match ? parseInt(match[1], 10) : 0;
    });
    const maxNum = numbers.length > 0 ? Math.max(...numbers) : 0;
    return `Wallet ${maxNum + 1}`;
  };

  // 새 지갑 생성 → PIN 설정
  const handleCreateWallet = async (pin: string) => {
    setPinError('');
    setActionLoading('create');
    try {
      const result = await createWallet(getNextWalletLabel(), pin);
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
      await importWallet(pendingMnemonic, getNextWalletLabel(), pin);
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

  // 지갑 삭제 — PIN 확인 필요 (되돌릴 수 없는 파괴적 작업이라 실수 방지).
  // 단, 다른 기기에서 만든 지갑이라 이 기기에 암호화된 키 자체가 없으면
  // 검증할 PIN이 없으므로(이 기기 기준 로컬 키가 없음) 바로 삭제 진행.
  const handleDelete = async (walletId: string) => {
    const hasLocalKey = !!loadWallets().find((w) => w.id === walletId)?.encrypted;
    if (!hasLocalKey) {
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
      return;
    }
    setPendingDeleteWalletId(walletId);
    setDeletePinError('');
    setShowDeletePin(true);
  };

  const handleDeleteExecute = async (pin: string) => {
    if (!pendingDeleteWalletId) return;
    const walletId = pendingDeleteWalletId;
    setDeletePinError('');
    setActionLoading(`delete-${walletId}`);
    let secretKey: Uint8Array | undefined;
    try {
      // PIN이 이 지갑의 것이 맞는지 먼저 검증 (틀리면 여기서 throw)
      secretKey = await decryptWalletSecret(walletId, pin);
      await deleteWallet(walletId);
      setShowDeletePin(false);
      setPendingDeleteWalletId(null);
      showToast(t('settings.walletDeleted'));
    } catch (err) {
      setDeletePinError(err instanceof Error ? err.message : t('settings.deleteFailed'));
    } finally {
      secretKey?.fill(0);
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
                    // 웹 URL 우선 (PC/모바일 모두 작동), 없으면 딥링크 폴백
                    const shareText = getShareLink(profile.referralCode);
                    navigator.clipboard.writeText(shareText).then(
                      () => showToast(t('settings.copySuccess')),
                      () => showToast(t('settings.copyFailed'))
                    );
                  }
                }}
                className="text-xs bg-primary-600/20 text-primary-400 px-3 py-1.5 rounded-lg hover:bg-primary-600/30 transition"
              >
                {profile.referralCode} <Copy className="inline w-3.5 h-3.5 ml-1" />
              </button>
            </div>
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

      {/* 로그아웃 — 계정 전환 (지갑 데이터 유지) */}
      <section className="mb-6">
        <button
          onClick={() => {
            logout();
            showToast(t('settings.logoutDone'));
            // 로그인 페이지로 이동 — Telegram 미니앱에서는 현재 계정으로 재로그인
            setTimeout(() => {
              window.location.href = '/login';
            }, 500);
          }}
          className="w-full py-3 rounded-xl bg-gray-800 text-gray-300 font-medium text-sm hover:bg-gray-700 transition border border-gray-700"
        >
          {t('settings.logout')}
        </button>
        <p className="text-[11px] text-gray-500 mt-2 text-center leading-relaxed">
          {t('settings.logoutDesc')}
        </p>
      </section>

      {/* Bottom Nav */}
      <BottomNav />

      {/* ─── Modals ─── */}

      {/* 새 지갑 PIN 설정 */}
      <PinModal
        isOpen={showCreatePin}
        mode="setup"
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
        mode="setup"
        title={t('settings.pinTitle')}
        subtitle={t('settings.pinSubtitleImport')}
        onConfirm={handleImportWallet}
        onCancel={() => {
          setShowImportPin(false);
          setPendingMnemonic('');
        }}
        error={pinError}
      />

      {/* 지갑 삭제 — PIN 확인 */}
      <PinModal
        isOpen={showDeletePin}
        title={t('settings.deletePinTitle')}
        subtitle={t('settings.deleteConfirm')}
        onConfirm={handleDeleteExecute}
        onCancel={() => {
          setShowDeletePin(false);
          setPendingDeleteWalletId(null);
          setDeletePinError('');
        }}
        error={deletePinError}
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
