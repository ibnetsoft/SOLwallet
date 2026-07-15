import { Keypair, Transaction } from '@solana/web3.js';

/**
 * 트랜잭션에 서명 (온디바이스)
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

  // 트랜잭션 역직렬화
  let transaction: Transaction;
  try {
    transaction = Transaction.from(
      Buffer.from(serializedTransaction, 'base64'),
    );
  } catch {
    // 실패 시에도 작업용 키 제로화
    keypair.secretKey.fill(0);
    throw new Error('유효하지 않은 트랜잭션입니다.');
  }

  // 서명
  transaction.sign(keypair);

  // 작업용 복사본 키 제로화
  keypair.secretKey.fill(0);

  // 서명된 트랜잭션 직렬화
  const signedSerialized = transaction.serialize().toString('base64');
  return signedSerialized;
}
