import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { getMsg } from '@/lib/i18n';

/**
 * 트랜잭션에 서명 (온디바이스)
 *
 * Manifest는 VersionedTransaction을 반환하고, SOL 전송은 legacy Transaction을
 * 사용하므로 두 포맷을 모두 처리합니다. 직렬화 바이트의 첫 바이트로 자동 감지합니다.
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

    // 첫 바이트의 최상위 비트가 1이면 VersionedTransaction
    // (VersionedTransaction 직렬화는 0x80 | version 으로 시작)
    const isVersioned = (txBytes[0] & 0x80) !== 0;

    if (isVersioned) {
      // Manifest 경로 — VersionedTransaction
      const messageV0 = VersionedTransaction.deserialize(txBytes);
      messageV0.sign([keypair]);
      const signedSerialized = Buffer.from(messageV0.serialize()).toString('base64');
      return signedSerialized;
    }

    // Legacy 경로 — SOL 전송 등
    const transaction = Transaction.from(txBytes);
    transaction.sign(keypair);
    const signedSerialized = transaction.serialize().toString('base64');
    return signedSerialized;
  } catch {
    // 실패 시에도 작업용 키 제로화
    keypair.secretKey.fill(0);
    throw new Error(getMsg('error.invalidTx'));
  } finally {
    // 작업용 복사본 키 제로화
    keypair.secretKey.fill(0);
  }
}
