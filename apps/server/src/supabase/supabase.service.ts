import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Node.js 20에서 Supabase Realtime이 필요로 하는 WebSocket polyfill
// Node.js 22+에서는 불필요 (native WebSocket 지원)
if (typeof globalThis.WebSocket === 'undefined') {
  try {
    const ws = require('ws');
    (globalThis as Record<string, unknown>).WebSocket = ws.WebSocket || ws;
  } catch {
    // ws 패키지가 없어도 계속 진행 (Realtime 미사용 시)
  }
}

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_SERVICE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
    }

    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  getClient(): SupabaseClient {
    return this.client;
  }
}
