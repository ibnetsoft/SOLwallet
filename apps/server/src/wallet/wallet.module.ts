import { Module } from '@nestjs/common';
import { MnemonicVaultService } from './mnemonic-vault.service';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';

@Module({
  controllers: [WalletController],
  providers: [WalletService, MnemonicVaultService],
  exports: [WalletService, MnemonicVaultService],
})
export class WalletModule {}
