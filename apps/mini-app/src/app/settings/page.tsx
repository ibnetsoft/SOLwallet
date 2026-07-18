'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
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
        <h1 className="text-xl font-bold">설정</h1>
      </header>

      {/* Wallet Management */}
      <section className="mb-6">
        <div className="space-y-2">
          <button
            onClick={() => {
              if (wallets.length >= MAX_WALLETS) {
                showToast(`최대 ${MAX_WALLETS}개까지 가능합니다.`);
                return;
              }
              setShowCreatePin(true);
            }}
            disabled={!!actionLoading}
            className="w-full bg-gray-800/50 rounded-xl p-4 text-left flex items-center justify-between active:bg-gray-700/50 transition-colors"
          >
            <p className="font-medium">새 지갑 생성</p>
            <span className="text-gray-500">→</span>
          </button>
          <button
            onClick={() => {
              if (wallets.length >= MAX_WALLETS) {
                showToast(`최대 ${MAX_WALLETS}개까지 가능합니다.`);
                return;
              }
              setShowImportSeed(true);
            }}
            disabled={!!actionLoading}
            className="w-full bg-gray-800/50 rounded-xl p-4 text-left flex items-center justify-between active:bg-gray-700/50 transition-colors"
          >
            <p className="font-medium">시드구문 Import</p>
            <span className="text-gray-500">→</span>
          </button>
        </div>
      </section>

      {/* Wallet List */}
      <section className="mb-6">
        <div className="space-y-2">
          {wallets.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-sm">생성된 지갑이 없습니다</p>
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
                        활성
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
                          활성화
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(wallet.id)}
                        disabled={!!actionLoading}
                        className="text-[10px] px-2 py-1 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition disabled:opacity-50"
                      >
                        삭제
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
              <span className="text-sm text-gray-400">내 추천 코드</span>
              <button
                onClick={() => {
                  if (profile.referralCode) {
                    // 코드 + 링크 함께 복사
                    const shareText = buildShareText(profile.referralCode);
                    navigator.clipboard.writeText(shareText).then(
                      () => showToast('추천코드와 링크가 복사되었습니다.'),
                      () => showToast('복사에 실패했습니다.'),
                    );
                  }
                }}
                className="text-xs bg-primary-600/20 text-primary-400 px-3 py-1.5 rounded-lg hover:bg-primary-600/30 transition"
              >
                {profile.referralCode} 복사
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

      {/* App Info — 헤더 없이 본문만 */}
      <section className="mb-6">
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
        </div>
      </section>

      {/* Bottom Nav */}
      <BottomNav />

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
