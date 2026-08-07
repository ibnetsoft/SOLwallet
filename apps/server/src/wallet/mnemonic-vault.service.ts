import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

interface EncryptedMnemonicPayload {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
}

@Injectable()
export class MnemonicVaultService {
  constructor(private readonly configService: ConfigService) {}

  encrypt(mnemonic: string): EncryptedMnemonicPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(mnemonic, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  decrypt(payload: unknown): string | null {
    if (!this.isPayload(payload)) return null;

    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.getKey(),
        Buffer.from(payload.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext, 'base64')),
        decipher.final(),
      ]);

      return plaintext.toString('utf8');
    } catch {
      return null;
    }
  }

  private getKey(): Buffer {
    const secret = this.configService.get<string>('MNEMONIC_ENCRYPTION_KEY');
    if (!secret || secret.length < 32) {
      throw new Error('MNEMONIC_ENCRYPTION_KEY must be set to at least 32 characters');
    }
    return createHash('sha256').update(secret).digest();
  }

  private isPayload(value: unknown): value is EncryptedMnemonicPayload {
    if (!value || typeof value !== 'object') return false;
    const payload = value as Record<string, unknown>;
    return (
      payload.version === 1 &&
      payload.algorithm === 'aes-256-gcm' &&
      typeof payload.iv === 'string' &&
      typeof payload.tag === 'string' &&
      typeof payload.ciphertext === 'string'
    );
  }
}
