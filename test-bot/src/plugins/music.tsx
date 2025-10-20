import { addCommand, MessageCommand, useContext, usePrompt } from "zhin.js";

async function musicQQ(keyword: string): Promise<{ type: 'qq', id: string, name: string }[]> {
    const url = new URL('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg');
    url.searchParams.set('key', keyword);
    url.searchParams.set('format', 'json');
    const { data } = await fetch(url, {
        method: 'GET',
    }).then(res => res.json() as Promise<{ data: { song: { itemlist: { id: string, name: string }[] } } }>)
        .catch(err => ({ data: { song: { itemlist: [] } } }))
    return data.song.itemlist.map((song) => {
        return {
            type: 'qq',
            name: song.name,
            id: song.id,
        }
    })
}
async function music163(keyword: string): Promise<{ type: '163', name: string, id: string }[]> {
    const url = new URL('https://music.163.com/api/search/get/');
    const result = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ s: keyword, type: '1', limit: '3', offset: '0' }),
    }).then(res => res.json() as Promise<{ result: { songs: { id: string, name: string, artist: string }[] } }>)
        .catch(err => ({ result: { songs: [] } }))
    return result.result.songs.map((song) => {
        return {
            type: '163',
            name: song.name,
            id: song.id,
            artist: song.artist,
        }
    })
}
addCommand(new MessageCommand<'icqq'>('点歌<keyword>')
    .permit('adapter(icqq)')
    .action(async (message, result) => {
        const keyword = result.params.keyword
        const [musicFromQQ, musicFrom163] = await Promise.all([musicQQ(keyword), music163(keyword)])
        const needSendList = [...musicFromQQ, ...musicFrom163].filter(Boolean)
        const prompt = usePrompt(message)
        const musicId = await prompt.pick('请选择搜索结果', {
            type: 'text',
            options: needSendList.map(music => ({
                label: music.name + `(from ${music.type})`,
                value: music.id,
            })),
        })
        if (!musicId) return;
        const music = needSendList.find(music => music.id === musicId)!
        switch (message.message_type) {
            case 'private':
                await message.friend.shareMusic(music.type, music.id)
                break;
            case 'group':
                await message.group.shareMusic(music.type, music.id)
                break
        }
    })
)