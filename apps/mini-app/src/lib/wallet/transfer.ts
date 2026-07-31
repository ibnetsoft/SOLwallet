import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  Connection,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

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

  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return serialized.toString('base64');
}

/**
 * SPL 토큰 전송 트랜잭션 빌드 (unsigned)
 *
 * 수신자에게 ATA가 없으면 자동 생성 (idempotent).
 * 송신자에게는 충분한 토큰 잔액이 필요하고,
 * 네트워크 수수료(tx fee)는 송신자의 SOL에서 차감됨.
 */
export async function buildSplTokenTransferTx(
  from: string,
  to: string,
  mint: string,
  amount: number,
  decimals: number,
): Promise<string> {
  const connection = new Connection(RPC_URL, 'confirmed');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const ownerPubkey = new PublicKey(from);
  const recipientPubkey = new PublicKey(to);
  const mintPubkey = new PublicKey(mint);

  // 송신자 ATA
  const sourceAta = getAssociatedTokenAddressSync(mintPubkey, ownerPubkey);
  // 수신자 ATA
  const destAta = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey);

  const transaction = new Transaction({
    feePayer: ownerPubkey,
    blockhash,
    lastValidBlockHeight,
  });

  // 수신자 ATA가 없으면 생성 instruction 추가 (idempotent — 이미 있으면 no-op)
  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(
      ownerPubkey,  // payer (수수료 부담)
      destAta,       // ata
      recipientPubkey, // owner
      mintPubkey,
    ),
  );

  // 토큰 전송 instruction
  const rawAmount = BigInt(Math.floor(amount * Math.pow(10, decimals)));
  transaction.add(
    createTransferInstruction(
      sourceAta,
      destAta,
      ownerPubkey,
      rawAmount,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return serialized.toString('base64');
}
