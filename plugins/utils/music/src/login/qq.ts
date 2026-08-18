import type { QrLoginProvider, QrCreateResult, QrPollResult } from './types.js';
import { extractSetCookies } from './types.js';

function hashPtqrtoken(qrsig: string): number {
  let hash = 0;
  for (let i = 0; i < qrsig.length; i++) {
    hash += (hash << 5) + qrsig.charCodeAt(i);
  }
  return hash & 0x7fffffff;
}

const APPID = '716027609';
const DAID = '383';
const PT_3RD_AID = '100497308';
const REFERER = 'https://xui.ptlogin2.qq.com/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function commonHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'User-Agent': USER_AGENT, Referer: REFERER, ...extra };
}

export class QQLoginProvider implements QrLoginProvider {
  async createQr(): Promise<QrCreateResult> {
    // Step 1: 访问 xlogin 页面获取 pt_login_sig
    const xloginUrl = new URL('https://xui.ptlogin2.qq.com/cgi-bin/xlogin');
    xloginUrl.searchParams.set('appid', APPID);
    xloginUrl.searchParams.set('daid', DAID);
    xloginUrl.searchParams.set('pt_3rd_aid', PT_3RD_AID);
    xloginUrl.searchParams.set('s_url', 'https://y.qq.com/');
    xloginUrl.searchParams.set('style', '33');
    xloginUrl.searchParams.set('low_login', '0');
    xloginUrl.searchParams.set('qlogin_auto_login', '1');

    const xloginResp = await fetch(xloginUrl.toString(), {
      headers: commonHeaders(),
      redirect: 'manual',
    });
    const xloginCookies = extractSetCookies(xloginResp.headers);
    const loginSigMatch = xloginCookies.match(/pt_login_sig=([^;]+)/);
    const loginSig = loginSigMatch?.[1] ?? '';

    // Step 2: 获取二维码图片 + qrsig cookie
    const qrUrl = new URL('https://ssl.ptlogin2.qq.com/ptqrshow');
    qrUrl.searchParams.set('appid', APPID);
    qrUrl.searchParams.set('e', '2');
    qrUrl.searchParams.set('l', 'M');
    qrUrl.searchParams.set('s', '3');
    qrUrl.searchParams.set('d', '72');
    qrUrl.searchParams.set('v', '4');
    qrUrl.searchParams.set('t', String(Math.random()));
    qrUrl.searchParams.set('daid', DAID);
    qrUrl.searchParams.set('pt_3rd_aid', PT_3RD_AID);

    const qrResp = await fetch(qrUrl.toString(), {
      headers: commonHeaders({
        Cookie: loginSig ? `pt_login_sig=${loginSig}` : '',
      }),
      redirect: 'manual',
    });
    const qrCookies = extractSetCookies(qrResp.headers);
    const qrsigMatch = qrCookies.match(/qrsig=([^;]+)/);
    const qrsig = qrsigMatch?.[1] ?? '';

    const buffer = Buffer.from(await qrResp.arrayBuffer());
    const imageBase64 = buffer.toString('base64');
    const ptqrtoken = String(hashPtqrtoken(qrsig));

    return {
      imageSegment: {
        type: 'image',
        data: { base64: imageBase64, mime_type: 'image/png' },
      },
      pollData: { ptqrtoken, qrsig, loginSig },
    };
  }

  async pollQr(pollData: Record<string, string>): Promise<QrPollResult> {
    const { ptqrtoken, qrsig, loginSig } = pollData;
    const url = new URL('https://ssl.ptlogin2.qq.com/ptqrlogin');
    url.searchParams.set('u1', 'https://y.qq.com/');
    url.searchParams.set('ptqrtoken', ptqrtoken!);
    url.searchParams.set('ptredirect', '0');
    url.searchParams.set('h', '1');
    url.searchParams.set('t', '1');
    url.searchParams.set('g', '1');
    url.searchParams.set('from_ui', '1');
    url.searchParams.set('ptlang', '2052');
    url.searchParams.set('action', `0-0-${Date.now()}`);
    url.searchParams.set('js_ver', '24112817');
    url.searchParams.set('js_type', '1');
    url.searchParams.set('login_sig', loginSig ?? '');
    url.searchParams.set('pt_uistyle', '40');
    url.searchParams.set('aid', APPID);
    url.searchParams.set('daid', DAID);
    url.searchParams.set('pt_3rd_aid', PT_3RD_AID);
    url.searchParams.set('has_signing', '1');

    try {
      const cookieParts = [`qrsig=${qrsig}`];
      if (loginSig) cookieParts.push(`pt_login_sig=${loginSig}`);

      const response = await fetch(url.toString(), {
        headers: commonHeaders({ Cookie: cookieParts.join('; ') }),
        redirect: 'manual',
      });
      const text = await response.text();

      if (text.includes('二维码未失效')) {
        return { status: 'waiting', message: '等待扫码...' };
      }
      if (text.includes('二维码认证中') || text.includes('已扫码')) {
        return { status: 'scanned', message: '已扫码，请在手机上确认登录' };
      }
      if (text.includes('二维码已失效')) {
        return { status: 'expired', message: '二维码已过期，请重新发起登录' };
      }
      if (text.includes('登录成功') || text.includes('ptsigx')) {
        return this.handleLoginSuccess(text, response.headers);
      }

      if (!text) {
        return { status: 'error', message: `服务端返回空响应 (HTTP ${response.status})` };
      }

      return { status: 'waiting', message: '等待扫码...' };
    } catch (err) {
      return {
        status: 'error',
        message: `轮询失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async handleLoginSuccess(text: string, headers: Headers): Promise<QrPollResult> {
    const redirectMatch = text.match(/'(https?:\/\/[^']+)'/);
    if (redirectMatch) {
      const redirectResp = await fetch(redirectMatch[1]!, {
        headers: commonHeaders(),
        redirect: 'manual',
      });
      const cookie = extractSetCookies(redirectResp.headers);
      if (cookie) {
        return { status: 'confirmed', message: '登录成功', cookie };
      }
    }
    const cookie = extractSetCookies(headers);
    return {
      status: cookie ? 'confirmed' : 'error',
      message: cookie ? '登录成功' : '登录成功但获取 cookie 失败',
      cookie: cookie || undefined,
    };
  }
}
