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
 * 수신 주소가 새 계정이면 자동으로 계정 생성 포함
 */
export async function buildSolTransferTx(
  from: string,
  to: string,
  amountSol: number,
): Promise<string> {
  const connection = new Connection(RPC_URL, 'confirmed');
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const fromPubkey = new PublicKey(from);
  const toPubkey = new PublicKey(to);
  const transferLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  const ixs = [];

  // 수신 주소가 존재하는지 확인
  const recipientInfo = await connection.getAccountInfo(toPubkey);

  if (!recipientInfo) {
    // 새 계정 — transfer만 하면 실패하므로 계정 생성 필요
    // SystemProgram.transfer는 기존 계정에만 lamports 추가 가능
    // 새 계정은 rent 예치금(890880 lamports) 이상과 함께 생성되어야 함
    const RENT_EXEMPT_LAMPORTS = 890880;
    const totalLamports = transferLamports + RENT_EXEMPT_LAMPORTS;

    // createAccount: 수신자가 소유자인 새 계정을 transfer 금액 + rent로 생성
    ixs.push(
      SystemProgram.createAccount({
        fromPubkey,
        newAccountPubkey: toPubkey,
        lamports: totalLamports,
        space: 0,
        programId: SystemProgram.programId,
      }),
    );
  } else {
    // 기존 계정 — 일반 transfer
    ixs.push(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports: transferLamports,
      }),
    );
  }

  const transaction = new Transaction({
    feePayer: fromPubkey,
    blockhash,
    lastValidBlockHeight,
  }).add(...ixs);

  // 직렬화 (base64) — 서명 전 상태
  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return serialized.toString('base64');
}
