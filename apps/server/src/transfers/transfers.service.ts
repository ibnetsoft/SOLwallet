import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { SupabaseService } from '../supabase/supabase.service';

export interface TransferItem {
  id: string; // transaction signature
  type: 'deposit' | 'withdraw';
  amount: number;
  tokenSymbol: string;
  status: string;
  createdAt: string; // ISO date string
  sender: string;
  receiver: string;
  preBalance: number;
  postBalance: number;
}

const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);
  private readonly connection: Connection;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {
    const rpcUrl = this.configService.get<string>('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  private get client() {
    return this.supabaseService.getClient();
  }

  /**
   * 지갑 주소 → userId 역조회
   */
  async getUserIdByWallet(walletAddress: string): Promise<string | null> {
    const { data } = await this.client
      .from('wallets')
      .select('user_id')
      .eq('public_key', walletAddress)
      .limit(1)
      .single();
    return data?.user_id ?? null;
  }

  /**
   * userId → username(또는 first_name) 조회
   */
  async getUserName(userId: string): Promise<string> {
    const { data } = await this.client
      .from('users')
      .select('username, first_name, telegram_uid')
      .eq('id', userId)
      .single();
    if (!data) return '—';
    return data.username || data.first_name || String(data.telegram_uid);
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

        // SOL 입출금 시 sender/receiver 추출
        const solSender = walletAddress;
        const solReceiver = walletAddress;

        // SOL 변동이 입/출금에 해당하면 기록
        if (solDiff > 0) {
          // SOL 입금 — counterparty 찾기: 다른 계정들 중 SOL을 보낸 계정 탐색
          const { sender, receiver } = this.findSolCounterparties(
            tx, walletAddress, accountIndex, 'deposit',
          );
          transfers.push({
            id: sigs[i],
            type: 'deposit',
            amount: solDiff / 1e9,
            tokenSymbol: 'SOL',
            status: tx.meta.err ? 'failed' : 'completed',
            createdAt: new Date((sigInfo.blockTime || 0) * 1000).toISOString(),
            sender,
            receiver,
            preBalance: preBal / 1e9,
            postBalance: postBal / 1e9,
          });
        } else if (solDiff < -10000) {
          // -10000 lamports 초과 = 수수료 이상의 출금
          const { sender, receiver } = this.findSolCounterparties(
            tx, walletAddress, accountIndex, 'withdraw',
          );
          transfers.push({
            id: sigs[i],
            type: 'withdraw',
            amount: Math.abs(solDiff) / 1e9,
            tokenSymbol: 'SOL',
            status: tx.meta.err ? 'failed' : 'completed',
            createdAt: new Date((sigInfo.blockTime || 0) * 1000).toISOString(),
            sender,
            receiver,
            preBalance: preBal / 1e9,
            postBalance: postBal / 1e9,
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

          // SPL 토큰의 sender/receiver — pre/post token balances에서 owner가 다른 쪽을 찾기
          const { sender, receiver } = this.findSplCounterparties(
            tx, walletAddress, entry.mint,
          );

          transfers.push({
            id: sigs[i],
            type: diff > 0 ? 'deposit' : 'withdraw',
            amount: Math.abs(diff),
            tokenSymbol: symbol,
            status: tx.meta.err ? 'failed' : 'completed',
            createdAt: new Date((sigInfo.blockTime || 0) * 1000).toISOString(),
            sender,
            receiver,
            preBalance: entry.pre,
            postBalance: entry.post,
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

  /**
   * SOL 전송의 counterparty(sender/receiver)를 트랜잭션에서 추출
   * SystemProgram.transfer 명령어에서 상대방 주소를 찾음
   */
  private findSolCounterparties(
    tx: any,
    walletAddress: string,
    accountIndex: number,
    direction: 'deposit' | 'withdraw',
  ): { sender: string; receiver: string } {
    const me = walletAddress;
    let counterparty = me;

    // 파싱된 instructions에서 SystemProgram.transfer 찾기
    try {
      const instructions = tx.transaction.message.instructions;
      for (const ix of instructions) {
        if (ix.parsed?.type === 'transfer' && ix.programId.toBase58() === '11111111111111111111111111111111') {
          const source = ix.parsed.info.source;
          const dest = ix.parsed.info.destination;
          if (direction === 'deposit' && dest === me) {
            counterparty = source;
          } else if (direction === 'withdraw' && source === me) {
            counterparty = dest;
          }
          break;
        }
      }
    } catch {
      // 파싱 실패 시 기본값 유지
    }

    if (direction === 'deposit') {
      return { sender: counterparty, receiver: me };
    } else {
      return { sender: me, receiver: counterparty };
    }
  }

  /**
   * SPL 토큰 전송의 counterparty를 token balances에서 추출
   */
  private findSplCounterparties(
    tx: any,
    walletAddress: string,
    mint: string,
  ): { sender: string; receiver: string } {
    const me = walletAddress;
    let sender = me;
    let receiver = me;

    // pre/post token balances에서 같은 mint를 가진 다른 owner를 찾기
    const allPre = tx.meta.preTokenBalances ?? [];
    const allPost = tx.meta.postTokenBalances ?? [];

    // pre에서 owner가 wallet이 아닌 것을 보내는 쪽으로, post에서 owner가 wallet이 아닌 것을 받는 쪽으로
    for (const b of allPre) {
      if (b.mint === mint && b.owner !== me) {
        // 이 사람이 보낸 것일 수 있음 — post에서 이 사람의 잔액이 줄었는지 확인
        const preAmt = Number(b.uiTokenAmount?.uiAmountString ?? 0);
        const postEntry = allPost.find(
          (p: any) => p.owner === b.owner && p.mint === mint,
        );
        const postAmt = postEntry ? Number(postEntry.uiTokenAmount?.uiAmountString ?? 0) : 0;
        if (postAmt < preAmt) {
          sender = b.owner;
        }
      }
    }
    for (const b of allPost) {
      if (b.mint === mint && b.owner !== me) {
        const postAmt = Number(b.uiTokenAmount?.uiAmountString ?? 0);
        const preEntry = allPre.find(
          (p: any) => p.owner === b.owner && p.mint === mint,
        );
        const preAmt = preEntry ? Number(preEntry.uiTokenAmount?.uiAmountString ?? 0) : 0;
        if (postAmt > preAmt) {
          receiver = b.owner;
        }
      }
    }

    return { sender, receiver };
  }
}
