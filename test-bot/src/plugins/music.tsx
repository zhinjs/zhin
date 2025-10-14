import { addCommand, MessageCommand, useContext } from "zhin.js";

async function musicQQ(keyword: string): Promise<{ type: 'qq', id: string }[]> {
    const url = new URL('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg');
    url.searchParams.set('key', keyword);
    url.searchParams.set('format', 'json');
    const {
        data
    } = await fetch(url, {
        method: 'GET',
    }).then(res => res.json() as Promise<{ data: { song: { itemlist: { id: string }[] } } }>);
    return data.song.itemlist.map((song) => ({
        type: 'qq',
        id: song.id,
    }))
}
async function music163(keyword: string): Promise<{ type: '163', id: string }[]> {
    const url = new URL('https://music.163.com/api/search/get/');
    const result = await fetch(url, {
        method: 'post',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ s: keyword, type: '1', limit: '1', offset: '0'}),
    }).then(res => res.json() as Promise<{ result: { songs: { id: string }[] } }>)
    return result.result.songs.map((song) => ({
        type: '163',
        id: song.id,
    }))
}
useContext('icqq', (adapter) => {
    addCommand(new MessageCommand('点歌<keyword>')
        .action(async (message, result) => {
            const keyword = result.params.keyword
            const [[musicFromQQ], [musicFrom163]] = await Promise.all([musicQQ(keyword), music163(keyword)])
            const needSendList = [musicFromQQ, musicFrom163].filter(Boolean)
            const bot = adapter.bots.get(message.$bot)
            if (bot) {
                switch (message.$channel.type) {
                    case 'private':
                        await Promise.all(needSendList.map(music => bot.pickFriend(+message.$channel.id).shareMusic(music.type, music.id)))
                        break
                    case 'group':
                        await Promise.all(needSendList.map(music => bot.pickGroup(+message.$channel.id).shareMusic(music.type, music.id)))
                        break
                }
            }
        })
    )
})