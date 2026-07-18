import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

/**
 * SOL 전송 트랜잭션 빌드 (unsigned)
 * 클라이언트에서 빌드 → signTransaction()으로 서명 → 서버에 전송
 */
export function buildSolTransferTx(
  from: string,
  to: string,
  amountSol: number,
): string {
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(from),
      toPubkey: new PublicKey(to),
      lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
    }),
  );

  // 직렬화 (base64) — 서명 전 상태
  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return serialized.toString('base64');
}
