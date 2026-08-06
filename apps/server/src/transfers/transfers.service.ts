import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { SupabaseService } from '../supabase/supabase.service';
import { WSOL_MINT } from '@solwallet/config';

export interface TransferItem {
  id: string; // transaction signature
  type: 'deposit' | 'withdraw' | 'fee'; // fee = 가스비만 차감된 tx (실제 출금 아님)
  amount: number;
  tokenSymbol: string;
  status: string;
  createdAt: string; // ISO date string
  sender: string;
  receiver: string;
  preBalance: number;
  postBalance: number;
}

export interface AdminTransferItem extends TransferItem {
  userId: string;
  userName: string;
  walletAddress: string;
}

const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

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
   * 전체 유저(활성 지갑 기준) 입출금 내역 — 관리자 트랜잭션 페이지용.
   *
   * 입금은 DB에 별도 기록되지 않으므로(어떤 지갑이 언제 입금받을지 알 방법이
   * 없어 매번 온체인에서 직접 확인해야 함) 지갑마다 하나씩 온체인 스캔이
   * 필요하다. 지갑 수가 많아지면(수백~수천) 매 요청마다 이렇게 전부 스캔하는
   * 방식은 느려지므로, 그때는 입금도 백그라운드로 미리 인덱싱해 DB에 쌓아두는
   * 방식으로 바꿔야 한다. 지금은 테스트 유저 규모라 실시간 스캔으로 충분하다.
   *
   * @param perWalletLimit 지갑 하나당 조회할 최근 건수 (RPC 부하 제한용)
   * @param sinceIso 지정하면 이 시각 이후 항목만 반환 (예: 대시보드의 "오늘의 입출금").
   *   ⚠️ perWalletLimit 안에 그 시각 이후 항목이 다 안 들어올 정도로 한 지갑이
   *   짧은 시간에 활발하면 일부 누락될 수 있음 — 지금 규모에서는 충분히 여유 있음.
   */
  async getAllTransfers(perWalletLimit = 20, sinceIso?: string): Promise<AdminTransferItem[]> {
    const { data: wallets, error } = await this.client
      .from('wallets')
      .select('public_key, user_id, users(username, first_name, telegram_uid)')
      .eq('is_active', true);

    if (error || !wallets || wallets.length === 0) return [];

    const results = await Promise.all(
      wallets.map(async (w) => {
        const walletAddress = w.public_key as string;
        const userId = w.user_id as string;
        const u = w.users as { username?: string; first_name?: string; telegram_uid?: number } | null;
        const userName = u?.username || u?.first_name || String(u?.telegram_uid ?? '—');

        try {
          const items = await this.getTransferHistory(walletAddress, perWalletLimit);
          return items.map((item) => ({ ...item, userId, userName, walletAddress }));
        } catch (err) {
          this.logger.warn(
            `[getAllTransfers] wallet ${walletAddress.slice(0, 8)}... 조회 실패: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        }
      }),
    );

    const sinceMs = sinceIso ? new Date(sinceIso).getTime() : null;
    return results
      .flat()
      .filter((item) => sinceMs == null || new Date(item.createdAt).getTime() >= sinceMs)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * 지갑 주소의 입출금 내역 조회
   * 1. DB에 기록된 출금 내역 (안정적)
   * 2. 온체인 입금 내역 (RPC에서 읽음)
   */
  async getTransferHistory(walletAddress: string, limit = 20): Promise<TransferItem[]> {
    // 1. DB에서 출금 내역 조회 (walletAddress로 wallet_id 찾기)
    const dbTransfers: TransferItem[] = [];
    try {
      const { data: wallet } = await this.client
        .from('wallets')
        .select('id, user_id')
        .eq('public_key', walletAddress)
        .single();

      if (wallet) {
        const { data: transfers } = await this.client
          .from('transfers')
          .select('*')
          .eq('wallet_id', wallet.id)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (transfers && transfers.length > 0) {
          for (const t of transfers) {
            dbTransfers.push({
              id: t.tx_signature || t.id,
              type: t.type,
              amount: Number(t.amount),
              tokenSymbol: t.token_symbol,
              status: t.status,
              createdAt: t.created_at,
              sender: walletAddress,
              receiver: t.to_address,
              preBalance: 0,
              postBalance: 0,
            });
          }
        }
      }
    } catch (err) {
      this.logger.warn(`DB transfer history query failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. 온체인에서 입금 내역 조회 (RPC) — 실패해도 DB 내역은 반환
    let onchainTransfers: TransferItem[] = [];
    try {
      onchainTransfers = await this.getOnchainTransfers(walletAddress, limit);
    } catch (err) {
      this.logger.warn(`On-chain transfer history failed (returning DB-only): ${err instanceof Error ? err.message : String(err)}`);
    }

    // 3. 병합 + 중복 제거 (tx_signature 기준) + 최신순 정렬
    const allTransfers = [...dbTransfers, ...onchainTransfers];
    const seen = new Set<string>();
    const unique = allTransfers.filter((t) => {
      const key = t.id || '';
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  /**
   * mint → symbol 조회 맵. USDT/USDC는 quote 통화라 tokens 테이블에 없을 수도
   * 있어 하드코딩으로 먼저 깔고, 등록된 모든 토큰(DUDE 등)을 그 위에 얹는다.
   *
   * 예전엔 이 맵 없이 USDT/USDC만 하드코딩 체크하고 나머지는 전부 'Token'으로
   * 표시했음 — 입금 쪽(받는 사람)은 DB에 기록이 없어 이 온체인 스캔 결과가
   * 유일한 소스라, DUDE를 출금하면 보내는 사람 쪽엔 DB에 기록된 정확한
   * 심볼(DUDE)이 보이는데 받는 사람 쪽엔 'Token'으로만 보이는 비대칭이 생겼음.
   */
  private async getMintSymbolMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>([
      [USDT_MINT, 'USDT'],
      ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC'],
    ]);
    try {
      const { data: tokens } = await this.client.from('tokens').select('mint_address, symbol');
      (tokens || []).forEach((t) => map.set(t.mint_address as string, t.symbol as string));
    } catch (err) {
      this.logger.warn(`[getMintSymbolMap] tokens 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
    return map;
  }

  /**
   * 온체인 입출금 내역 조회 (RPC)
   */
  private async getOnchainTransfers(walletAddress: string, limit: number): Promise<TransferItem[]> {
    const pubkey = new PublicKey(walletAddress);

    // 1. 서명 목록 조회
    const signatures = await this.connection.getSignaturesForAddress(pubkey, { limit });
    if (signatures.length === 0) return [];

    const sigs = signatures.map((s) => s.signature);
    const mintSymbolMap = await this.getMintSymbolMap();

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
          // counterparty가 자기 자신이면 실제 SOL transfer 명령이 없는 것 —
          // 스왑/주문/취소 등으로 가스비만 차감된 tx. withdraw가 아닌 fee로 분류.
          const isFeeOnly = receiver === walletAddress;
          transfers.push({
            id: sigs[i],
            type: isFeeOnly ? 'fee' : 'withdraw',
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

          const symbol = mintSymbolMap.get(entry.mint) ?? 'Token';

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
  }

  /**
   * 지갑에 각 코인(mint)이 최초로 입금된 시점의 수량을 조회 — ROI 초기값 계산용
   *
   * SOL은 WSOL_MINT('So111...112')를 키로 사용한다.
   * 최근 200개 서명까지만 스캔한다 — 이 앱의 지갑들은 거래 이력이 적어 충분하고,
   * 결과는 wallet_deposit_baseline에 영구 저장되어 지갑당 한 번만 스캔하면 된다.
   */
  async findFirstDeposits(walletAddress: string): Promise<Map<string, { amount: number; blockTime: number }>> {
    const result = new Map<string, { amount: number; blockTime: number }>();
    const pubkey = new PublicKey(walletAddress);

    const signatures = await this.connection.getSignaturesForAddress(pubkey, { limit: 200 });
    if (signatures.length === 0) return result;

    const sigs = signatures.map((s) => s.signature);
    const txs = await this.connection.getParsedTransactions(sigs, { maxSupportedTransactionVersion: 0 });

    const considerDeposit = (mint: string, amount: number, blockTime: number) => {
      if (amount <= 0) return;
      const existing = result.get(mint);
      if (!existing || blockTime < existing.blockTime) {
        result.set(mint, { amount, blockTime });
      }
    };

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      const sigInfo = signatures[i];
      if (!tx || !tx.meta) continue;
      const blockTime = sigInfo.blockTime || 0;

      const accountIndex = tx.transaction.message.accountKeys.findIndex(
        (k) => k.pubkey.toBase58() === walletAddress,
      );
      if (accountIndex !== -1) {
        const preBal = tx.meta.preBalances[accountIndex] || 0;
        const postBal = tx.meta.postBalances[accountIndex] || 0;
        const solDiff = postBal - preBal;
        if (solDiff > 0) {
          considerDeposit(WSOL_MINT, solDiff / 1e9, blockTime);
        }
      }

      const preTokenBalances = tx.meta.preTokenBalances?.filter((b) => b.owner === walletAddress) ?? [];
      const postTokenBalances = tx.meta.postTokenBalances?.filter((b) => b.owner === walletAddress) ?? [];
      const mintMap = new Map<string, { pre: number; post: number }>();
      for (const b of preTokenBalances) {
        mintMap.set(b.mint, { pre: Number(b.uiTokenAmount?.uiAmountString ?? 0), post: 0 });
      }
      for (const b of postTokenBalances) {
        const existing = mintMap.get(b.mint);
        const post = Number(b.uiTokenAmount?.uiAmountString ?? 0);
        if (existing) existing.post = post;
        else mintMap.set(b.mint, { pre: 0, post });
      }
      for (const [mint, entry] of mintMap) {
        const diff = entry.post - entry.pre;
        if (diff > 0) considerDeposit(mint, diff, blockTime);
      }
    }

    return result;
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
