import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';

export interface TransferItem {
  id: string; // transaction signature
  type: 'deposit' | 'withdraw';
  amount: number;
  tokenSymbol: string;
  status: string;
  createdAt: string; // ISO date string
}

const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);
  private readonly connection: Connection;

  constructor(private readonly configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * 지갑 주소의 on-chain 입출금 내역 조회
   * SOL + SPL 토큰 변동을 모두 감지
   */
  async getTransferHistory(walletAddress: string, limit = 20): Promise<TransferItem[]> {
    try {
      const pubkey = new PublicKey(walletAddress);

      // 1. 서명 목록 조회
      const signatures = await this.connection.getSignaturesForAddress(pubkey, { limit });
      if (signatures.length === 0) return [];

      const sigs = signatures.map((s) => s.signature);

      // 2. 파싱된 트랜잭션 상세 조회
      const txs = await this.connection.getParsedTransactions(sigs, { maxSupportedTransactionVersion: 0 });

      const transfers: TransferItem[] = [];

      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i];
        const sigInfo = signatures[i];
        if (!tx || !tx.meta) continue;

        const accountIndex = tx.transaction.message.accountKeys.findIndex(
          (k) => k.pubkey.toBase58() === walletAddress,
        );
        if (accountIndex === -1) continue;

        // ── SOL 잔액 변동 체크 (항상 수행) ──
        const preBal = tx.meta.preBalances[accountIndex] || 0;
        const postBal = tx.meta.postBalances[accountIndex] || 0;
        const solDiff = postBal - preBal;

        // SOL 변동이 입/출금에 해당하면 기록
        if (solDiff > 0) {
          transfers.push({
            id: sigs[i],
            type: 'deposit',
            amount: solDiff / 1e9,
            tokenSymbol: 'SOL',
            status: tx.meta.err ? 'failed' : 'completed',
            createdAt: new Date((sigInfo.blockTime || 0) * 1000).toISOString(),
          });
        } else if (solDiff < -10000) {
          // -10000 lamports 초과 = 수수료 이상의 출금
          transfers.push({
            id: sigs[i],
            type: 'withdraw',
            amount: Math.abs(solDiff) / 1e9,
            tokenSymbol: 'SOL',
            status: tx.meta.err ? 'failed' : 'completed',
            createdAt: new Date((sigInfo.blockTime || 0) * 1000).toISOString(),
          });
        }

        // ── SPL 토큰 잔액 변동 체크 ──
        const preTokenBalances = tx.meta.preTokenBalances?.filter(
          (b) => b.owner === walletAddress,
        ) ?? [];
        const postTokenBalances = tx.meta.postTokenBalances?.filter(
          (b) => b.owner === walletAddress,
        ) ?? [];

        // mint별로 pre/post 매칭
        const mintMap = new Map<string, { pre: number; post: number; mint: string }>();
        for (const b of preTokenBalances) {
          const amt = Number(b.uiTokenAmount?.uiAmountString ?? 0);
          mintMap.set(b.mint, { pre: amt, post: 0, mint: b.mint });
        }
        for (const b of postTokenBalances) {
          const existing = mintMap.get(b.mint);
          if (existing) {
            existing.post = Number(b.uiTokenAmount?.uiAmountString ?? 0);
          } else {
            mintMap.set(b.mint, { pre: 0, post: Number(b.uiTokenAmount?.uiAmountString ?? 0), mint: b.mint });
          }
        }

        for (const [, entry] of mintMap) {
          const diff = entry.post - entry.pre;
          if (Math.abs(diff) === 0) continue;

          let symbol = 'Token';
          if (entry.mint === USDT_MINT) symbol = 'USDT';
          else if (entry.mint === USDC_MINT) symbol = 'USDC';

          transfers.push({
            id: sigs[i],
            type: diff > 0 ? 'deposit' : 'withdraw',
            amount: Math.abs(diff),
            tokenSymbol: symbol,
            status: tx.meta.err ? 'failed' : 'completed',
            createdAt: new Date((sigInfo.blockTime || 0) * 1000).toISOString(),
          });
        }
      }

      // 시간 내림차순 정렬
      transfers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return transfers;
    } catch (error) {
      this.logger.error(`Failed to fetch transfer history: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}
