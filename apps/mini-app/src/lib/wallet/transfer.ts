import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  Connection,
} from '@solana/web3.js';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

/**
 * SOL 전송 트랜잭션 빌드 (unsigned)
 *
 * 수신 주소가 새 계정(0 lamports)인 경우, Solana runtime은
 * transfer 금액이 rent 예치금(890880 lamports ≈ 0.00089 SOL) 이상이면
 * 자동으로 계정을 생성합니다. 미만이면 'insufficient funds for rent' 에러.
 */
export async function buildSolTransferTx(
  from: string,
  to: string,
  amountSol: number,
): Promise<string> {
  const connection = new Connection(RPC_URL, 'confirmed');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const transaction = new Transaction({
    feePayer: new PublicKey(from),
    blockhash,
    lastValidBlockHeight,
  }).add(
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
