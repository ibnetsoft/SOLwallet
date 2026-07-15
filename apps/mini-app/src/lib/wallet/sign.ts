import { Keypair, Transaction } from '@solana/web3.js';
import nacl from 'tweetnacl';

/**
 * 트랜잭션에 서명 (온디바이스)
 *
 * ⚠️ 서명 완료 후 메모리에서 키를 즉시 해제합니다.
 * Private key는 서버로 전송되지 않습니다.
 *
 * @param serializedTransaction — base64 인코딩된 직렬화된 트랜잭션
 * @param secretKey — Uint8Array (64 bytes)
 * @returns 서명된 트랜잭션의 base64 직렬화 문자열
 */
export function signTransaction(
  serializedTransaction: string,
  secretKey: Uint8Array,
): string {
  // 메모리에 키 로드
  const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));

  // 트랜잭션 역직렬화
  let transaction: Transaction;
  try {
    transaction = Transaction.from(
      Buffer.from(serializedTransaction, 'base64'),
    );
  } catch {
    throw new Error('유효하지 않은 트랜잭션입니다.');
  }

  // 서명
  transaction.sign(keypair);

  // 메모리에서 키 즉시 해제 (zeroize)
  keypair.secretKey.fill(0);

  // 서명된 트랜잭션 직렬화
  const signedSerialized = transaction.serialize().toString('base64');
  return signedSerialized;
}

/**
 * 메시지 서명 (거래 외 용도)
 */
export function signMessage(
  message: Uint8Array,
  secretKey: Uint8Array,
): Uint8Array {
  const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
  const signature = nacl.sign.detached(message, keypair.secretKey);

  // 메모리 해제
  keypair.secretKey.fill(0);

  return signature;
}
