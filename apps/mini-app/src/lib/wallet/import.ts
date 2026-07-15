import * as bip39 from 'bip39';
import { deriveKeypairFromSeed } from './helpers';

export interface ImportWalletResult {
  publicKey: string;
  secretKey: Uint8Array;
}

/**
 * 시드 구문(mnemonic)으로 지갑 복원
 * @param mnemonic — 공백으로 구분된 12단어 또는 24단어 시드 구문
 * @returns publicKey, secretKey
 * @throws 유효하지 않은 시드 구문인 경우 에러
 */
export function importSeedPhrase(mnemonic: string): ImportWalletResult {
  const trimmed = mnemonic.trim().toLowerCase();

  if (!bip39.validateMnemonic(trimmed)) {
    throw new Error('유효하지 않은 시드 구문입니다.');
  }

  const seed = bip39.mnemonicToSeedSync(trimmed);
  const keypair = deriveKeypairFromSeed(seed.slice(0, 32));

  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: keypair.secretKey,
  };
}

/**
 * 시드 구문 유효성 검증 (복원 없이)
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic.trim().toLowerCase());
}
