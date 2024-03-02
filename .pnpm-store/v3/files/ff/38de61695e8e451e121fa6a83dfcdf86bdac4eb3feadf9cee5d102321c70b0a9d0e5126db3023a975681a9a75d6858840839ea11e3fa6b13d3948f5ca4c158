"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeMusicJson = exports.buildMusic = exports.musicFactory = void 0;
const axios_1 = __importDefault(require("axios"));
exports.musicFactory = {
    qq: {
        appid: 100497308,
        name: 'QQ音乐',
        icon: 'https://p.qpic.cn/qqconnect/0/app_100497308_1626060999/100?max-age=2592000&t=0',
        package_name: "com.tencent.qqmusic",
        sign: "cbd27cd7c861227d013a25b2d10f0799",
        getMusicInfo: getQQSong
    },
    '163': {
        appid: 100495085,
        name: '网易云音乐',
        icon: 'https://i.gtimg.cn/open/app_icon/00/49/50/85/100495085_100_m.png',
        package_name: "com.netease.cloudmusic",
        sign: "da6b069da1e2982db3e386233f68d76d",
        getMusicInfo: get163Song
    },
    migu: {
        appid: 1101053067,
        name: '咪咕音乐',
        package_name: "cmccwm.mobilemusic",
        sign: "6cdc72a439cef99a3418d2a78aa28c73",
        getMusicInfo: getMiGuSong
    },
    kugou: {
        appid: 205141,
        name: '酷狗音乐',
        icon: 'https://open.gtimg.cn/open/app_icon/00/20/51/41/205141_100_m.png?t=0',
        package_name: "com.kugou.android",
        sign: "fe4a24d80fcf253a00676a808f62c2c6",
        getMusicInfo: getKuGouSong
    },
    kuwo: {
        appid: 100243533,
        name: '酷我音乐',
        icon: 'https://p.qpic.cn/qqconnect/0/app_100243533_1636374695/100?max-age=2592000&t=0',
        package_name: "cn.kuwo.player",
        sign: "bf9ff4ffb4c558a34ee3fd52c223ebf5",
        getMusicInfo: getKuwoSong
    }
};
async function getQQSong(id) {
    let rsp = await axios_1.default.get(`https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&data={"comm":{"ct":24,"cv":0},"songinfo":{"method":"get_song_detail_yqq","param":{"song_type":0,"song_mid":"","song_id":${id}},"module":"music.pf_song_detail_svr"}}`, { responseType: "json" });
    rsp = rsp.data.songinfo.data.track_info;
    let mid = rsp.mid, title = rsp.name, album = rsp.album.mid, singer = rsp.singer?.[0]?.name || "unknown";
    rsp = await axios_1.default.get(`http://u.y.qq.com/cgi-bin/musicu.fcg?g_tk=2034008533&uin=0&format=json&data={"comm":{"ct":23,"cv":0},"url_mid":{"module":"vkey.GetVkeyServer","method":"CgiGetVkey","param":{"guid":"4311206557","songmid":["${mid}"],"songtype":[0],"uin":"0","loginflag":1,"platform":"23"}}}&_=1599039471576`, { responseType: "json" });
    rsp = rsp.data.url_mid.data.midurlinfo[0];
    return {
        title: title,
        singer: singer,
        jumpUrl: `https://i.y.qq.com/v8/playsong.html?platform=11&appshare=android_qq&appversion=10030010&hosteuin=oKnlNenz7i-s7c**&songmid=${mid}&type=0&appsongtype=1&_wv=1&source=qq&ADTAG=qfshare`,
        musicUrl: rsp.purl,
        preview: `http://y.gtimg.cn/music/photo_new/T002R180x180M000${album}.jpg`,
    };
}
async function get163Song(id) {
    let rsp = await axios_1.default.get(`http://music.163.com/api/song/detail/?id=${id}&ids=[${id}]`, { responseType: "json" });
    rsp = rsp.data.songs[0];
    return {
        title: rsp.name,
        singer: rsp.artists[0].name,
        jumpUrl: "https://y.music.163.com/m/song/" + id,
        musicUrl: "http://music.163.com/song/media/outer/url?id=" + id,
        preview: rsp.album.picUrl,
    };
}
async function getMiGuSong(id) {
    let rsp = await axios_1.default.get(`https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?copyrightId=${id}&resourceType=2`, { responseType: "json" });
    rsp = rsp.data.resource[0];
    let preview = "";
    try {
        let a = await axios_1.default.get(`https://music.migu.cn/v3/api/music/audioPlayer/getSongPic?songId=${rsp.songId}`, { responseType: "json", headers: { referer: "https://music.migu.cn/v3/music/player/audio" } });
        preview = a.data.smallPic || "";
    }
    catch { }
    let url = await axios_1.default.get(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/shareInfo.do?contentId=${rsp.contentId}&contentName=${encodeURIComponent(rsp.songName)}&resourceType=2&targetUserName=${encodeURIComponent(rsp.singer)}`, { responseType: "json" });
    let jumpUrl = url.data.url || "http://c.migu.cn/";
    return {
        title: rsp.songName,
        singer: rsp.singer,
        jumpUrl,
        musicUrl: rsp.newRateFormats ? rsp.newRateFormats[0].url.replace(/ftp:\/\/[^/]+/, "https://freetyst.nf.migu.cn") : rsp.rateFormats[0].url.replace(/ftp:\/\/[^/]+/, "https://freetyst.nf.migu.cn"),
        preview: preview || "",
    };
}
async function getKuGouSong(id) {
    let url = `https://wwwapi.kugou.com/yy/index.php?r=play/getdata&callback=&hash=${id}&dfid=&mid=${id}&platid=4&_=${+new Date()}&album_id=`;
    let rsp = await axios_1.default.get(url, { responseType: "json" });
    rsp = rsp.data.data;
    url += rsp.album_id;
    rsp = await axios_1.default.get(url, { responseType: "json" });
    rsp = rsp.data.data;
    return {
        title: rsp.audio_name,
        singer: rsp.author_name,
        jumpUrl: `https://www.kugou.com/song/#hash=${id}&album_id=${rsp.album_id}`,
        musicUrl: rsp.play_url || "https://webfs.yun.kugou.com",
        preview: rsp.img,
    };
}
async function getKuwoSong(id) {
    let rsp = await axios_1.default.get(`http://yinyue.kuwo.cn/api/www/music/musicInfo?mid=${id}&httpsStatus=1`, { responseType: "json", headers: { csrf: id, cookie: " kw_token=" + id } });
    rsp = rsp.data.data;
    // let url: any = await axios.get(`http://yinyue.kuwo.cn/url?format=mp3&rid=${id}&response=url&type=convert_url3&from=web&t=${+new Date()}`, { responseType: "json" })
    let url = await axios_1.default.get(`http://www.kuwo.cn/api/v1/www/music/playUrl?mid=${id}&type=music&httpsStatus=1`);
    return {
        title: rsp.name,
        singer: rsp.artist,
        jumpUrl: "http://yinyue.kuwo.cn/play_detail/" + id,
        musicUrl: url.data.data.url || "https://win-web-ra01-sycdn.kuwo.cn",
        preview: rsp.pic,
    };
}
async function buildMusic(target, bu, platform, id) {
    const { appid, package_name, sign, getMusicInfo } = exports.musicFactory[platform];
    let style = 4;
    try {
        const { singer, title, jumpUrl, musicUrl, preview } = await getMusicInfo(id);
        if (!musicUrl)
            style = 0;
        return {
            1: appid,
            2: 1,
            3: style,
            5: {
                1: 1,
                2: "0.0.0",
                3: package_name,
                4: sign
            },
            10: typeof bu === 'string' ? 3 : bu,
            11: target,
            12: {
                10: title,
                11: singer,
                12: "[分享]" + title,
                13: jumpUrl,
                14: preview,
                16: musicUrl,
            },
            19: typeof bu === 'string' ? Number(bu) : undefined
        };
    }
    catch (e) {
        throw new Error("unknown music id: " + id + ", in platform: " + platform);
    }
}
exports.buildMusic = buildMusic;
function makeMusicJson(musicInfo) {
    const { appid, name, icon } = exports.musicFactory[musicInfo.platform];
    return {
        app: "com.tencent.qzone.structmsg",
        config: { type: "normal", autosize: true, forward: true },
        desc: "音乐",
        meta: {
            [musicInfo.musicUrl ? 'music' : 'news']: {
                app_type: 1,
                appid,
                desc: musicInfo.singer,
                jumpUrl: musicInfo.jumpUrl,
                musicUrl: musicInfo.musicUrl,
                preview: musicInfo.preview,
                sourceMsgId: "0",
                source_icon: icon,
                source_url: "",
                tag: name,
                title: musicInfo.title
            }
        },
        prompt: `[分享]${musicInfo.title} ${musicInfo.singer}`,
        ver: "0.0.0.1",
        view: musicInfo.musicUrl ? 'music' : 'news',
    };
}
exports.makeMusicJson = makeMusicJson;
