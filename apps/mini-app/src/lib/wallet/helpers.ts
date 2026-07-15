import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';

/**
 * 32바이트 시드에서 Solana Keypair 도출
 * Ed25519 (NaCl)을 사용하여 키 페어 생성
 */
export function deriveKeypairFromSeed(seed: Uint8Array): Keypair {
  const keypair = nacl.sign.keyPair.fromSeed(seed);

  return Keypair.fromSecretKey(
    new Uint8Array([...keypair.secretKey, ...keypair.publicKey]),
  );
}
