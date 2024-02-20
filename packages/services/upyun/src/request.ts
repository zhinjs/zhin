import { UpYun } from '@/upYun';
import * as http from 'http';

import { Dict } from 'zhin';
import { createHash, createHmac } from 'crypto';
export function md5(data: string | Buffer) {
  const encoding = Buffer.isBuffer(data) ? 'hex' : 'utf8';
  if (Buffer.isBuffer(data)) data = data.toString('hex');
  return createHash('md5').update(data, encoding).digest('hex');
}
export function HmacSHA1(secret: string, value: string) {
  return createHmac('sha1', secret).update(value).digest();
}
export function sign(password: string, method: string, uri: string, date: string, contentMd5: string = '') {
  return HmacSHA1(password, [method, uri, date, contentMd5].filter(Boolean).join('&')).toString('base64');
}
export class Request {
  constructor(private upYun: UpYun) {}
  get baseURL() {
    return this.upYun.baseURL;
  }
  private createHeader(method: string, uri: string, data?: string | Buffer, extend: Dict = {}) {
    const path = `/${this.upYun.bucket}/${uri}`;
    const date = new Date().toUTCString();
    const contentMd5 = data && md5(data);
    const result: Dict = {
      'Date': date,
      'Content-MD5': contentMd5,
      'Authorization': `UPYUN ${this.upYun.operator}:${sign(md5(this.upYun.password), method, path, date, contentMd5)}`,
      ...extend,
    };
    Object.keys(result).forEach(key => {
      if (!result[key]) delete result[key];
    });
    return result;
  }
  request<T = any>(options: Dict, data?: any) {
    return new Promise<Request.Result<T>>((resolve, reject) => {
      let resData = '';
      const req = http.request(options, res => {
        res.setEncoding('utf8');
        res.on('data', chunk => {
          resData += chunk;
        });
        res.on('end', () => {
          let data;
          try {
            data = JSON.parse(resData);
          } catch {
            data = resData;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data,
          });
        });
        res.on('error', e => {
          reject(e);
        });
      });
      data && req.write(data);
      req.end();
    });
  }
  put<T = any>(url: string, data: string | Buffer, headers: Dict = {}) {
    return this.request<T>(
      {
        hostname: this.baseURL,
        method: 'PUT',
        path: `/${this.upYun.bucket}/${url}`,
        headers: this.createHeader('PUT', url, data, headers),
      },
      data,
    );
  }
  post<T = any>(url: string, data: Dict = {}, headers: Dict = {}) {
    return this.request<T>({
      hostname: this.baseURL,
      method: 'POST',
      path: `/${this.upYun.bucket}/${url}`,
      headers: this.createHeader('POST', url, Buffer.from(JSON.stringify(data)), headers),
    });
  }
  get<T = any>(url: string, data: Dict = {}, headers: Dict = {}) {
    const query = Object.entries(data)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    let path = `/${this.upYun.bucket}/${url}`;
    if (query) {
      if (path.indexOf('?') !== -1) path += `&${query}`;
      else path += `?${query}`;
    }
    return this.request<T>({
      hostname: this.baseURL,
      method: 'GET',
      path,
      headers: this.createHeader('GET', url, undefined, headers),
    });
  }
  del<T = any>(url: string) {
    return this.request<T>({
      hostname: this.baseURL,
      method: 'DELETE',
      path: `/${this.upYun.bucket}/${url}`,
      headers: this.createHeader('DELETE', url),
    });
  }
}
export namespace Request {
  export interface Result<T> {
    statusCode?: number;
    headers: Dict;
    data: T;
  }
}
