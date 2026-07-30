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
 * 클라이언트에서 빌드 → signTransaction()으로 서명 → 서버에 전송
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
