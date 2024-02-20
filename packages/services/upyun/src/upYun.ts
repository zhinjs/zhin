import { Request } from '@/request';
import * as fs from 'fs';
import { Dict } from 'zhin';

export class UpYun {
  baseURL: string;
  request: Request = new Request(this);
  private readonly domain: string;
  readonly bucket: string;
  readonly operator: string;
  readonly password: string;
  constructor(config: UpYun.Config) {
    this.bucket = config.bucket;
    this.operator = config.operator;
    this.password = config.password;
    this.domain = config.domain || `${config.bucket}.test.upcdn.net`;
    this.baseURL = UpYun.domain;
  }

  /**
   * 上传流文件
   * @param folder {string} 存到哪儿，需包含文件名
   * @param data {Buffer|string} 文件数据
   */
  async uploadStreamFile(folder: string, data: Buffer | string) {
    const result = await this.request.put(folder, data);
    if (result.statusCode === 200) return `${this.domain}/${folder.startsWith('/') ? folder.slice(1) : folder}`;
    return result.data;
  }

  /**
   * 上传本地文件
   * @param url {string} 存到哪儿，需包含文件名
   * @param file {string} 本地文件地址
   * @returns {string} 公网可访问地址
   */
  uploadLocalFile(url: string, file: string) {
    return this.uploadStreamFile(url, fs.readFileSync(file));
  }

  /**
   * 查看服务用量
   */
  async usage() {
    return this.request.get('?usage');
  }

  /**
   * 获取目录文件列表
   * @param url
   */
  async listDir(url: string) {
    const getDataList = async (prevIter?: string): Promise<any[]> => {
      const {
        data: { files = [], iter },
      } = await this.request.get<Dict>(url, undefined, {
        'x-list-iter': prevIter,
        'Accept': 'application/json',
      });
      if (!files.length) return [];
      if (!iter) return files;
      return files.concat(await getDataList(iter));
    };
    return getDataList();
  }

  /**
   * 删除文件
   * @param url
   */
  async deleteFile(url: string) {
    const result = await this.request.del(url);
    return result.statusCode === 200;
  }

  /**
   * 新建目录
   * @param folder
   */
  async createDir(folder: string) {
    const result = await this.request.post(folder);
    return result.statusCode === 200;
  }

  /**
   * 删除目录
   * @param folder
   */
  async deleteDir(folder: string) {
    const result = await this.request.del(folder);
    return result.statusCode === 200;
  }
}
export namespace UpYun {
  export interface Config {
    domain?: string;
    bucket: string;
    operator: string;
    password: string;
  }
  export const domain = 'v0.api.upyun.com';
  export const domain_CTCC = 'v1.api.upyun.com';
  export const domain_CUCC = 'v2.api.upyun.com';
  export const domain_CMCC = 'v3.api.upyun.com';
}
