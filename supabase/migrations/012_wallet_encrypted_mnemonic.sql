-- Store wallet recovery phrases encrypted by the server-side vault key.
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS encrypted_mnemonic JSONB;
