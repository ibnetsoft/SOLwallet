import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { getMsg } from '@/lib/i18n';

/**
 * 트랜잭션에 서명 (온디바이스)
 *
 * Manifest는 VersionedTransaction을 반환하고, SOL 전송은 legacy Transaction을
 * 사용하므로 두 포맷을 모두 처리합니다.
 *
 * ⚠️ 주의: Manifest 직렬화 포맷은 표준 web3.js(0x80 prefix)와 다름.
 * 첫 바이트 검사만으로는 버전을 신뢰할 수 없어 try-catch fallback 사용.
 *
 * ⚠️ 서명 완료 후 작업용 복사본을 제로화합니다.
 * 호출자는 서명 후 반드시 useWalletStore.lockWallets()를 호출하여
 * 원본 secretKey도 메모리에서 제거해야 합니다.
 *
 * @param serializedTransaction — base64 인코딩된 직렬화된 트랜잭션
 * @param secretKey — Uint8Array (64 bytes)
 * @returns 서명된 트랜잭션의 base64 직렬화 문자열
 */
export function signTransaction(
  serializedTransaction: string,
  secretKey: Uint8Array,
): string {
  // 메모리에 키 로드 (복사본 생성)
  const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));

  try {
    const txBytes = Buffer.from(serializedTransaction, 'base64');

    // ── 1차 시도: VersionedTransaction (Manifest 경로) ──
    // Manifest 직렬화는 표준 0x80 prefix가 없으므로 첫 바이트 검사에 의존하지 않고
    // deserialize를 직접 시도. 실패하면 legacy로 fallback.
    try {
      const vt = VersionedTransaction.deserialize(txBytes);
      vt.sign([keypair]);
      return Buffer.from(vt.serialize()).toString('base64');
    } catch {
      // versioned가 아니면 legacy 시도
    }

    // ── 2차 시도: Legacy Transaction (SOL 전송 등) ──
    const transaction = Transaction.from(txBytes);
    transaction.sign(keypair);
    return transaction.serialize().toString('base64');
  } catch (err) {
    // ⚠️ 실제 원인을 콘솔에 기록 — 디버깅 가능하도록 제네릭 메시지만 던지지 않음
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[signTransaction] 서명 실패:', detail, {
      txLength: serializedTransaction.length,
      secretKeyLength: secretKey.length,
    });

    // 실패 시에도 작업용 키 제로화
    keypair.secretKey.fill(0);

    // 사용자에게 더 구체적인 에러 메시지 노출
    if (/already been processed|blockhash|BlockhashNotFound/i.test(detail)) {
      throw new Error('트랜잭션이 만료되었습니다. 다시 시도해주세요.');
    }
    throw new Error(getMsg('error.invalidTx'));
  } finally {
    // 작업용 복사본 키 제로화
    keypair.secretKey.fill(0);
  }
}
