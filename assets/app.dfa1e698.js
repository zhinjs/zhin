import{d as _,c as r,z as s,t as v,C as b,r as g,o as c,H as w,h as p,l as E,p as y,E as P,n as q,b as x,G as N,K as m,a2 as R,u as S,k as B,a3 as D,a4 as H,a5 as L,a6 as M,a7 as U,a8 as V,a9 as j,aa as F,ab as T,ac as z,ad as I,ae as O,af as G,ag as Y}from"./chunks/framework.621e5595.js";import{t as h}from"./chunks/theme.cc1cdaf0.js";const J={class:"chat-panel"},K={key:0,class:"controls"},Q=s("div",{class:"circle red"},null,-1),W=s("div",{class:"circle yellow"},null,-1),X=s("div",{class:"circle green"},null,-1),Z={class:"title"},ee={class:"content"},te=_({__name:"ChatHistory",props:{controls:{type:Boolean,default:!0},title:{default:"聊天记录"}},setup(e){const t=e;return(a,n)=>(c(),r("div",J,[t.controls?(c(),r("div",K,[Q,W,X,s("div",Z,v(t.title),1)])):b("",!0),s("div",ee,[g(a.$slots,"default")])]))}});const ae={class:"c-avatar-box",style:{display:"inline-block"}},ne=["src"],se=_({__name:"UserAvatar",props:{avatar:{default:""},id:{default:null},type:{default:"qq"},size:{default:100},nickname:{default:""},color:{default:"steelblue"}},setup(e){const t=e,a=(n,i,u)=>{let o="https://cdn.jsdelivr.net/gh/YunYouJun/cdn/img/avatar/none.jpg";return i==="qq"?o=`https://q1.qlogo.cn/g?b=qq&nk=${n}&s=${u}`:i==="group"&&(o=`https://p.qlogo.cn/gh/${n}/${n}/${u}`),o};return(n,i)=>(c(),r("div",ae,[t.avatar||t.id?(c(),r("img",{key:0,class:"avatar",src:t.avatar||a(t.id,t.type,t.size)},null,8,ne)):(c(),r("div",{key:1,class:"avatar",style:w(`background-color:${e.color}`)},v(t.nickname[0]),5))]))}});const oe={class:"message-box"},re={class:"nickname"},ce={class:"message shadow-sm"},le=_({__name:"ChatMsg",props:{avatar:null,id:null,nickname:null,color:null},emits:["appear"],setup(e,{emit:t}){const a=e,n=["1659488338",1659488338],i={1689919782:"知音",1659488338:"master"},u=d=>i[d],o=p();p(!1);const A=p(!1);p(!1);const C=E(()=>n.includes(a.id)),f=()=>{if(!o.value)return;o.value.getBoundingClientRect().top<innerHeight&&(A.value=!0)};return y(()=>{f(),addEventListener("scroll",f)}),(d,me)=>{const $=N("UserAvatar");return c(),r("div",{ref_key:"messageEl",ref:o,class:q(["chat-message show",{right:x(C)}])},[P($,{id:a.id,avatar:a.avatar,nickname:a.nickname||u(a.id),color:a.color},null,8,["id","avatar","nickname","color"]),s("div",oe,[s("div",re,v(a.nickname||u(a.id)),1),s("div",ce,[g(d.$slots,"default")])])],2)}}});const ie={Layout:h.Layout,NotFound:h.NotFound,enhanceApp({app:e}){e.component("UserAvatar",se),e.component("ChatMsg",le),e.component("ChatHistory",te)}};function k(e){if(e.extends){const t=k(e.extends);return{...t,...e,async enhanceApp(a){t.enhanceApp&&await t.enhanceApp(a),e.enhanceApp&&await e.enhanceApp(a)}}}return e}const l=k(ie),ue=_({name:"VitePressApp",setup(){const{site:e}=S();return y(()=>{B(()=>{document.documentElement.lang=e.value.lang,document.documentElement.dir=e.value.dir})}),D(),H(),L(),l.setup&&l.setup(),()=>M(l.Layout)}});async function de(){const e=_e(),t=pe();t.provide(U,e);const a=V(e.route);return t.provide(j,a),t.component("Content",F),t.component("ClientOnly",T),Object.defineProperties(t.config.globalProperties,{$frontmatter:{get(){return a.frontmatter.value}},$params:{get(){return a.page.value.params}}}),l.enhanceApp&&await l.enhanceApp({app:t,router:e,siteData:z}),{app:t,router:e,data:a}}function pe(){return I(ue)}function _e(){let e=m,t;return O(a=>{let n=G(a);return e&&(t=n),(e||t===n)&&(n=n.replace(/\.js$/,".lean.js")),m&&(e=!1),Y(()=>import(n),[])},l.NotFound)}m&&de().then(({app:e,router:t,data:a})=>{t.go().then(()=>{R(t.route,a.site),e.mount("#app")})});export{de as createApp};