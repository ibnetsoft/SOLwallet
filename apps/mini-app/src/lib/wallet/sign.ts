import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { getMsg } from '@/lib/i18n';
import { reportClientError } from '@/lib/reportError';

/**
 * 트랜잭션 서명 포맷
 * - 'versioned': Manifest 주문 (VersionedTransaction v0)
 * - 'legacy': SOL 전송 등 (legacy Transaction)
 */
export type TxFormat = 'versioned' | 'legacy';

/**
 * 트랜잭션에 서명 (온디바이스)
 *
 * ⚠️ 중요: 포맷 자동 감지는 신뢰할 수 없습니다.
 * - Manifest SDK 직렬화는 표준 web3.js(0x80 prefix)와 다름 (0x02)
 * - 첫 바이트 검사, deserialize 시도, version 체크 모두
 *   브라우저 번들 버전에 따라 다르게 동작
 * → 따라서 호출부가 포맷을 명시적으로 전달해야 함
 *
 * ⚠️ 서명 완료 후 작업용 복사본을 제로화합니다.
 * 호출자는 서명 후 반드시 useWalletStore.lockWallets()를 호출하여
 * 원본 secretKey도 메모리에서 제거해야 합니다.
 *
 * @param serializedTransaction — base64 인코딩된 직렬화된 트랜잭션
 * @param secretKey — Uint8Array (64 bytes)
 * @param format — 'versioned' (Manifest) | 'legacy' (SOL 전송)
 * @returns 서명된 트랜잭션의 base64 직렬화 문자열
 */
export function signTransaction(
  serializedTransaction: string,
  secretKey: Uint8Array,
  format: TxFormat = 'versioned',
): string {
  // 메모리에 키 로드 (복사본 생성)
  const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));

  try {
    const txBytes = Buffer.from(serializedTransaction, 'base64');

    if (format === 'versioned') {
      // Manifest 경로 — VersionedTransaction(v0)
      const vt = VersionedTransaction.deserialize(txBytes);
      vt.sign([keypair]);
      return Buffer.from(vt.serialize()).toString('base64');
    }

    // Legacy 경로 — SOL 전송 등
    const transaction = Transaction.from(txBytes);
    transaction.sign(keypair);
    return transaction.serialize().toString('base64');
  } catch (err) {
    // ⚠️ 실제 원인을 콘솔에 기록 — 디버깅 가능하도록 제네릭 메시지만 던지지 않음
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[signTransaction] 서명 실패:', detail, {
      format,
      txLength: serializedTransaction.length,
      secretKeyLength: secretKey.length,
    });

    // 실패 시에도 작업용 키 제로화
    keypair.secretKey.fill(0);

    // 사용자에게 더 구체적인 에러 메시지 노출
    if (/already been processed|blockhash|BlockhashNotFound/i.test(detail)) {
      throw new Error('트랜잭션이 만료되었습니다. 다시 시도해주세요.');
    }

    // 브라우저 콘솔에만 남고 서버 로그엔 안 보이던 서명 실패 — 원격 진단 가능하도록 보고
    reportClientError(`[signTransaction] ${detail}`, {
      format,
      txLength: serializedTransaction.length,
      secretKeyLength: secretKey.length,
    });

    throw new Error(getMsg('error.invalidTx'));
  } finally {
    // 작업용 복사본 키 제로화
    keypair.secretKey.fill(0);
  }
}
