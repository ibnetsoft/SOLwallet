import { Keypair } from '@solana/web3.js';
import * as bip39 from 'bip39';
import { deriveKeypairFromSeed } from './helpers';

export interface CreateWalletResult {
  publicKey: string;
  secretKey: Uint8Array;
  mnemonic: string;
}

/**
 * 새 Solana 지갑 생성
 * @returns publicKey, secretKey, mnemonic
 */
export function createWallet(): CreateWalletResult {
  // 12단어 시드 구문 생성
  const mnemonic = bip39.generateMnemonic();

  // 시드 구문 → 시드 → Keypair
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const keypair = deriveKeypairFromSeed(seed.slice(0, 32));

  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey,
    mnemonic,
  };
}

/**
 * 랜덤 Keypair 생성 (시드 없이)
 * — 주로 테스트용
 */
export function createRandomKeypair() {
  const keypair = Keypair.generate();
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey,
  };
}
