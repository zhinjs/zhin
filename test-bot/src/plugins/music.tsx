import { addCommand, MessageCommand, SendContent, usePrompt } from "zhin.js";
const sourceMap = {
    qq: {
        appid: 100497308,
        package: 'com.tencent.qqmusic',
        icon: 'https://p.qpic.cn/qqconnect/0/app_100497308_1626060999/100?max-age=2592000&t=0',
        sign: 'cbd27cd7c861227d013a25b2d10f0799',
        version: '13.11.0.8',
    },
    netease: {
        appid: 100495085,
        package: 'com.netease.cloudmusic',
        icon: 'https://i.gtimg.cn/open/app_icon/00/49/50/85/100495085_100_m.png',
        sign: 'da6b069da1e2982db3e386233f68d76d',
        version: '9.1.92',
    },
}
export interface ShareContent {
    id: string
    source: keyof typeof sourceMap;
    /** 跳转链接, 没有则发不出 */
    url: string;
    /** 链接标题 */
    title: string;
    /** 从消息列表中看到的文字，默认为 `"[分享]"+title` */
    content?: string;
    /** 预览图网址, 默认为QQ浏览器图标，似乎对域名有限制 */
    image?: string;
    summary?: string;
    audio?: string;
}
export interface MusicQQ {
    id: string
    mid: string
    name: string
    docid: string
    singer: string
}
export interface Music163 {
    id: string
    name: string
    album: {
        id: string
        name: string
        picUrl: string | null;
        img1v1Url: string;
    }
}
async function musicQQ(keyword: string): Promise<ShareContent[]> {
    const url = new URL('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg');
    url.searchParams.set('key', keyword);
    url.searchParams.set('format', 'json');
    const { data: { song: { itemlist } } } = await fetch(url, {
        method: 'GET',
    }).then(res => res.json() as Promise<{ data: { song: { itemlist: MusicQQ[] } } }>)
        .catch(err => ({ data: { song: { itemlist: [] } } }))
    return itemlist.map(music => ({
        id: music.id,
        source: 'qq',
        title: [music.singer, music.name].join(' - '),
        url: `https://y.qq.com/n/yqq/song/${music.id}.html`,
    }));
}
async function getMusic163Image(id: string): Promise<string> {
    const url = new URL(`https://music.163.com/api/song/detail/?ids=[${id}]`);
    const { songs } = await fetch(url, {
        method: 'GET',
    }).then(res => res.json() as Promise<{ songs: Music163[] }>)
    return songs[0]!.album.picUrl!;
}
async function getMusicQQImage(id: string): Promise<string> {
    const url = new URL(`https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&data={"comm":{"ct":24,"cv":0},"songinfo":{"method":"get_song_detail_yqq","param":{"song_type":0,"song_mid":"","song_id":${id}},"module":"music.pf_song_detail_svr"}}`);
    const result = await fetch(url, {
        method: 'GET',
        headers: {
            responseType: 'json',
        }
    }).then(res => res.json())
    return `http://y.gtimg.cn/music/photo_new/T002R180x180M000${result?.songinfo?.data?.track_info?.album?.mid ?? ''}.jpg`;
}
async function music163(keyword: string): Promise<ShareContent[]> {
    const url = new URL('https://music.163.com/api/search/get/');
    const { result: { songs } } = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ s: keyword, type: '1', limit: '3', offset: '0' }),
    }).then(res => res.json() as Promise<{ result: { songs: Music163[] } }>)
        .catch(err => ({ result: { songs: [] } }))
    return songs.map(music => {
        return {
            id: music.id,
            source: 'netease',
            title: music.name,
            image: music.album.picUrl ?? music.album.img1v1Url,
            url: `https://music.163.com/#/song/?id=${music.id}`,
        }
    });
}
addCommand(new MessageCommand<'icqq'>('点歌<keyword>')
    .permit('adapter(icqq)')
    .action(async (message, result) => {
        const keyword = result.params.keyword
        const [musicFromQQ, musicFrom163] = await Promise.all([musicQQ(keyword), music163(keyword)])
        const searchResult = [...musicFromQQ, ...musicFrom163].filter(Boolean)
        if (!searchResult.length) {
            message.reply('没有找到结果')
            return;
        }
        const prompt = usePrompt(message)
        const musicUrl = await prompt.pick('请选择搜索结果', {
            type: 'text',
            options: searchResult.map(music => ({
                label: `${music.title} [${music.source}]`,
                value: music.url,
            })),
        })
        if (!musicUrl) return;
        const music = searchResult.find(music => music.url === musicUrl)!
        const { source, ...content } = music
        const target = message.message_type === 'private' ? message.friend : message.group
        await target.share({
            ...content,
            image: source === 'qq' ? await getMusicQQImage(music.id) : await getMusic163Image(music.id),
        }, {
            appid: sourceMap[music.source].appid,
            appname: sourceMap[music.source].package,
            appsign: sourceMap[music.source].sign,
        })
    })
)