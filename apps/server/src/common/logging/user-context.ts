import { AsyncLocalStorage } from 'async_hooks';

/**
 * 요청별 컨텍스트 — AsyncLocalStorage로 스레드 안전하게 유지.
 * Interceptor가 설정하고 Logger가 읽는다.
 */
export interface RequestContext {
  userId?: string;
}

export const userContextStorage = new AsyncLocalStorage<RequestContext>();
