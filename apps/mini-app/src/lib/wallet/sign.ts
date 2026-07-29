import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { getMsg } from '@/lib/i18n';

/**
 * 트랜잭션에 서명 (온디바이스)
 *
 * Manifest는 VersionedTransaction(v0)을 반환하고, SOL 전송은 legacy Transaction을
 * 사용하므로 두 포맷을 모두 처리합니다.
 *
 * ⚠️ 포맷 감지 (중요):
 * - Manifest SDK 직렬화는 표준 web3.js(0x80 prefix)와 다름 — 첫 바이트 0x02
 * - Legacy 트랜잭션 첫 바이트는 numRequiredSignatures (보통 0x01)
 * - 첫 바이트만으로는 구분 불가 → deserialize 후 `.version === 0` 으로 판별
 * - Legacy를 versioned로 deserialize하면 version이 'legacy'가 되어 자동 걸러짐
 *
 * ⚠️ catch 범위 주의:
 * - detection(판별)만 try-catch로 감싸고, sign()은 밖에서 호출
 * - sign() 에러(잘못된 키, 잔액 부족 등)가 detection catch에 삼켜지지 않도록 분리
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

    // ── 1단계: 포맷 판별 (detection만 try-catch) ──
    // Manifest 직렬화는 표준 0x80 prefix가 없어 첫 바이트로 판단 불가.
    // VersionedTransaction.deserialize 후 version === 0 인지 확인.
    // Legacy tx를 versioned로 deserialize하면 version이 'legacy'가 되어
    // 여기서 걸러지고 아래 legacy 경로로 진행됨.
    let versionedTx: VersionedTransaction | null = null;
    try {
      const vt = VersionedTransaction.deserialize(txBytes);
      if (vt.version === 0) {
        versionedTx = vt;
      }
    } catch {
      // versioned가 아니면 null 유지 → legacy fallback
    }

    // ── 2단계: 서명 (에러는 외부 catch로 전파) ──
    if (versionedTx) {
      // Manifest 경로 — VersionedTransaction(v0)
      versionedTx.sign([keypair]);
      return Buffer.from(versionedTx.serialize()).toString('base64');
    }

    // Legacy 경로 — SOL 전송 등
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
