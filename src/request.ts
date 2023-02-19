import axios, { AxiosRequestConfig, AxiosResponse, Method } from 'axios'
import {Dict} from "@zhinjs/shared";

export interface Request {
    <T = any>(method: Method, url: string, config?: AxiosRequestConfig): Promise<T>
    axios<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>
    extend(config: Request.Config): Request
    config: Request.Config
    head(url: string, config?: AxiosRequestConfig): Promise<AxiosRequestConfig['headers']>
    get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>
    delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>
    post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>
    put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>
    patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>
}
export namespace Request {
    export interface Config {
        headers?: Dict
        endpoint?: string
        timeout?: number
    }

    export function create(config: Request.Config = {}) {
        const {endpoint = ''} = config

        const options: AxiosRequestConfig = {
            timeout: config.timeout,
            headers: config.headers,
        }

        const request = async (url: string, config: AxiosRequestConfig = {}) => axios.request({
            ...options,
            ...config,
            url: endpoint + url,
            headers: {
                ...options.headers,
                ...config.headers,
            } as AxiosRequestConfig['headers'],
        })

        const http = (async (method, url, config) => {
            const response = await request(url, {...config, method})
            return response.data
        }) as Request

        http.config = config
        http.axios = request as any
        http.extend = (newConfig) => create({...config, ...newConfig})

        http.get = (url, config) => http('GET', url, config)
        http.delete = (url, config) => http('DELETE', url, config)
        http.post = (url, data, config) => http('POST', url, {...config, data})
        http.put = (url, data, config) => http('PUT', url, {...config, data})
        http.patch = (url, data, config) => http('PATCH', url, {...config, data})
        http.head = async (url, config) => {
            const response = await request(url, {...config, method: 'HEAD'})
            return response.headers
        }

        return http
    }
}