'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useWalletStore } from '@/stores/useWalletStore';
import { useToast } from '@/components/Toast';
import PinModal from '@/components/PinModal';
import SeedInput from '@/components/SeedInput';
import MnemonicDisplay from '@/components/MnemonicDisplay';
import { MAX_WALLETS } from '@solwallet/config';
import { getUserProfile } from '@/lib/api/user';
import type { UserProfile } from '@/lib/api/user';
import { isLoggedIn } from '@/lib/api/auth';

export default function SettingsPage() {
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
      setPinError(err instanceof Error ? err.message : '오류가 발생했습니다.');
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
      showToast('✅ 지갑을 성공적으로 가져왔습니다!');
    } catch (err) {
      setPinError(err instanceof Error ? err.message : '오류가 발생했습니다.');
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
      showToast('✅ 활성 지갑이 변경되었습니다.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '지갑 전환 실패');
    } finally {
      setActionLoading('');
    }
  };

  // 지갑 삭제
  const handleDelete = async (walletId: string) => {
    if (!confirm('이 지갑을 삭제하시겠습니까?\n암호화된 데이터가 로컬에서 제거됩니다.')) return;
    setActionLoading(`delete-${walletId}`);
    try {
      await deleteWallet(walletId);
      showToast('🗑️ 지갑이 삭제되었습니다.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '지갑 삭제 실패');
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
        <h1 className="text-xl font-bold">⚙️ 설정</h1>
      </header>

      {/* Wallet Management */}
      <section className="mb-6">
        <h2 className="text-sm text-gray-400 mb-2">지갑 관리</h2>
        <div className="space-y-2">
          <button
            onClick={() => {
              if (wallets.length >= MAX_WALLETS) {
                showToast(`⚠️ 최대 ${MAX_WALLETS}개까지 가능합니다.`);
                return;
              }
              setShowCreatePin(true);
            }}
            disabled={!!actionLoading}
            className="w-full bg-gray-800/50 rounded-xl p-4 text-left flex items-center justify-between active:bg-gray-700/50 transition-colors"
          >
            <div>
              <p className="font-medium">🆕 새 지갑 생성</p>
              <p className="text-xs text-gray-400">새 솔라나 지갑을 만듭니다</p>
            </div>
            <span className="text-gray-500">→</span>
          </button>
          <button
            onClick={() => {
              if (wallets.length >= MAX_WALLETS) {
                showToast(`⚠️ 최대 ${MAX_WALLETS}개까지 가능합니다.`);
                return;
              }
              setShowImportSeed(true);
            }}
            disabled={!!actionLoading}
            className="w-full bg-gray-800/50 rounded-xl p-4 text-left flex items-center justify-between active:bg-gray-700/50 transition-colors"
          >
            <div>
              <p className="font-medium">📥 시드구문 Import</p>
              <p className="text-xs text-gray-400">기존 지갑을 가져옵니다</p>
            </div>
            <span className="text-gray-500">→</span>
          </button>
        </div>
      </section>

      {/* Wallet List */}
      <section className="mb-6">
        <h2 className="text-sm text-gray-400 mb-2">
          내 지갑 목록 ({wallets.length}/{MAX_WALLETS})
        </h2>
        <div className="space-y-2">
          {wallets.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">👛</p>
              <p className="text-sm">생성된 지갑이 없습니다</p>
              <p className="text-xs">새 지갑을 생성하거나 시드구문을 가져오세요</p>
            </div>
          ) : (
            wallets.map((wallet) => (
              <div
                key={wallet.id}
                className={`bg-gray-800/50 rounded-xl p-4 ${
                  wallet.id === activeWalletId ? 'border border-primary-500/30' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{wallet.label}</p>
                      {wallet.id === activeWalletId && (
                        <span className="text-xs bg-primary-600 px-2 py-0.5 rounded">
                          활성
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 font-mono truncate">
                      {wallet.publicKey ? truncateKey(wallet.publicKey) : '—'}
                    </p>
                  </div>
                </div>
                {wallets.length > 1 && (
                  <div className="flex gap-2 mt-3">
                    {wallet.id !== activeWalletId && (
                      <button
                        onClick={() => handleActivate(wallet.id)}
                        disabled={!!actionLoading}
                        className="text-xs px-3 py-1.5 rounded-lg bg-primary-600/20 text-primary-400 disabled:opacity-50"
                      >
                        활성으로 전환
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(wallet.id)}
                      disabled={!!actionLoading}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-600/20 text-red-400 disabled:opacity-50"
                    >
                      삭제
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Referral Section */}
      {profile && (
        <section className="mb-6">
          <h2 className="text-sm text-gray-400 mb-2">🎁 추천인</h2>
          <div className="bg-gray-800/50 rounded-xl p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">내 추천 코드</span>
              <button
                onClick={() => {
                  if (profile.referralCode) {
                    navigator.clipboard.writeText(profile.referralCode).then(
                      () => showToast('📋 추천 코드가 복사되었습니다.'),
                      () => {},
                    );
                  }
                }}
                className="text-xs bg-primary-600/20 text-primary-400 px-3 py-1 rounded-lg hover:bg-primary-600/30 transition"
              >
                {profile.referralCode.slice(0, 8)}... 복사
              </button>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">초대한 친구</span>
              <span className="font-medium">{profile.referralCount}명</span>
            </div>
            {profile.referrer && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">내 추천인</span>
                <span>{profile.referrer.username || profile.referrer.first_name}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* App Info */}
      <section className="mb-6">
        <h2 className="text-sm text-gray-400 mb-2">앱 정보</h2>
        <div className="bg-gray-800/50 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">버전</span>
            <span>v0.2.0</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">네트워크</span>
            <span>Mainnet</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">DEX</span>
            <span>Manifest.trade</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">최대 지갑</span>
            <span>{MAX_WALLETS}개</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">수수료</span>
            <span>1%</span>
          </div>
        </div>
      </section>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-800">
        <div className="flex justify-around py-2">
          <Link href="/" className="flex flex-col items-center text-gray-500 py-1">
            <span className="text-lg">🏠</span>
            <span className="text-xs">홈</span>
          </Link>
          <Link href="/trade" className="flex flex-col items-center text-gray-500 py-1">
            <span className="text-lg">📊</span>
            <span className="text-xs">거래</span>
          </Link>
          <Link href="/settings" className="flex flex-col items-center text-primary-500 py-1">
            <span className="text-lg">⚙️</span>
            <span className="text-xs">설정</span>
          </Link>
        </div>
      </nav>

      {/* ─── Modals ─── */}

      {/* 새 지갑 PIN 설정 */}
      <PinModal
        isOpen={showCreatePin}
        title="🔒 PIN 설정"
        subtitle="새 지갑의 암호 PIN을 설정합니다"
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
        title="🔒 PIN 설정"
        subtitle="가져온 지갑의 암호 PIN을 설정합니다"
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
