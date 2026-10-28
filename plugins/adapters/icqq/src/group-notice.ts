/**
 * 发群公告。icqq 的 `sendGroupNotice` / `Group.announce` 走 OIDB 0x89a_0 的旧「群公告」字段：QQ 回成功，
 * 但现行客户端不再展示，等于静默丢失。这里改走群公告网页接口（与 go-cqhttp `_send_group_notice` 同口径），
 * 用登录会话的 qun.qq.com cookie 与 bkn；接口不回 `ec: 0` 一律当失败抛出，不报假成功。
 */
export interface QunNoticeClient {
  readonly bkn: number;
  getCookies(domain: 'qun.qq.com'): string | undefined;
}

export const QUN_NOTICE_ENDPOINT = 'https://web.qun.qq.com/cgi-bin/announce/add_qun_notice';

export async function publishQunNotice(
  client: QunNoticeClient,
  groupId: number,
  content: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const cookie = client.getCookies('qun.qq.com');
  if (!cookie) throw new Error('missing qun.qq.com session cookie');
  const body = new URLSearchParams({
    qid: String(groupId),
    bkn: String(client.bkn),
    text: content,
    pinned: '0',
    type: '1',
    settings: JSON.stringify({ is_show_edit_card: 0, tip_window_type: 1, confirm_required: 1 }),
  });
  const response = await fetchImpl(`${QUN_NOTICE_ENDPOINT}?bkn=${client.bkn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body,
  });
  if (!response.ok) throw new Error(`group notice HTTP ${response.status}`);
  const result = await response.json().catch(() => undefined) as { ec?: number; em?: string } | undefined;
  if (result?.ec !== 0) throw new Error(`QQ rejected the group notice: ${result?.em ?? `ec=${String(result?.ec)}`}`);
}
