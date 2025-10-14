import { addCommand,MessageCommand, useContext } from "zhin.js";

const m_ERR_CODE = Object.freeze({
    ERR_SRC: "1",
    ERR_404: "2",
    ERR_API: "3",
});
async function musicQQ(keyword:string) {
    const url = new URL('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg');
    url.searchParams.set('key', keyword);
    url.searchParams.set('format', 'json');
    const {
        data
    } = await fetch(url, {
        method: 'GET',
    }).then(res => res.json() as Promise<{data: {song: {itemlist: {id: string}[]}}}>);
    console.log('qq',data)
    return data.song.itemlist.map((song) => ({
        type: 'qq',
        id: song.id,
    }))[0]
}
async function music163(keyword:string) {
    const url = new URL('https://music.163.com/api/search/get/');
    const result=await fetch(url, {
        method: 'post',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            s: keyword,
            type:'1',
            limit:'1',
            offset:'0',
        }),
    }).then(res => res.json() as Promise<{result: {songs: {id: string}[]}}>)
    console.log(163,result)
    return {type: "163", id: result.result.songs[0].id};
}
useContext('icqq',(adapter)=>{
    addCommand(new MessageCommand('点歌<keyword>')
        .action(async (message,result)=>{
            const keyword = result.params.keyword
            const music = await music163(keyword)
            const bot=adapter.bots.get(message.$bot)
            if(bot){
                switch(message.$channel.type){
                    case 'private':
                        await bot.pickFriend(+message.$channel.id).shareMusic('163',music.id)
                        break
                    case 'group':
                        await bot.pickGroup(+message.$channel.id).shareMusic('163',music.id)
                        break
                }
            }
        })
    )
    addCommand(new MessageCommand('点歌<keyword>')
        .action(async (message,result)=>{
            const keyword = result.params.keyword
            const music = await musicQQ(keyword)
            const bot=adapter.bots.get(message.$bot)
            if(bot){
                switch(message.$channel.type){
                    case 'private':
                        await bot.pickFriend(+message.$channel.id).shareMusic('qq',music.id)
                        break
                    case 'group':
                        await bot.pickGroup(+message.$channel.id).shareMusic('qq',music.id)
                        break
                }
            }
        })
    )
})