const TOKEN_STORAGE_KEY = 'classroom.session.token';

/** 保存目前分頁的身分憑證（sessionStorage 的生命週期即分頁工作階段）。 */
export function saveToken(token: string): void {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}

/** 讀取目前分頁的身分憑證；未登入或尚未進場時為 null。 */
export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

/** 清除目前分頁的身分憑證。 */
export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}
