/**
 * 숫자를 소수점 8자리까지 잘라서(반올림 아님) 문자열로 반환.
 *
 * 오더북에서 가져온 가격을 그대로 String(price)/price.toString()으로 넣으면
 * 부동소수점 연산 결과인 76.26493955000001 같은 값이 그대로 입력창에 노출돼
 * 사용자가 읽기 불편했다. toFixed(8)은 반올림을 하므로, 문자열을 직접 잘라
 * 8번째 자리 밑을 그냥 버린다.
 */
export function truncateDecimals(value: number, digits = 8): string {
  if (!Number.isFinite(value)) return '0';
  // 지수 표기(예: 1e-9)를 방지하기 위해 충분히 넓은 고정소수점 문자열로 변환 후 자른다.
  const str = value.toFixed(20);
  const dotIdx = str.indexOf('.');
  if (dotIdx === -1) return str;
  return str.slice(0, dotIdx + 1 + digits);
}
