import{u as _,v as r,b as c,F as n,X as m,B as b,z as h,I as C,d as p,r as P,A as g,y as w,a as q,M as x,K as v,a2 as E,c as H,H as M,a3 as R,a4 as j,a5 as B,a6 as L,a7 as T,a8 as U,a9 as D,aa as F,ab as I,ac as z,ad as N,ae as O,af as S,ag as V}from"./chunks/framework.c021e421.js";import{t as Y}from"./chunks/theme.1a776da2.js";const G={class:"chat-panel"},J={key:0,class:"controls"},K=n("div",{class:"circle red"},null,-1),X=n("div",{class:"circle yellow"},null,-1),Q=n("div",{class:"circle green"},null,-1),W={class:"title"},Z={class:"content"},ee=_({__name:"ChatHistory",props:{controls:{type:Boolean,default:!0},title:{default:"聊天记录"}},setup(e){const t=e;return(a,s)=>(r(),c("div",G,[t.controls?(r(),c("div",J,[K,X,Q,n("div",W,m(t.title),1)])):b("",!0),n("div",Z,[h(a.$slots,"default")])]))}});const te={class:"c-avatar-box",style:{display:"inline-block"}},ae=["src"],se=_({__name:"UserAvatar",props:{avatar:{default:""},id:{default:null},type:{default:"qq"},size:{default:100},nickname:{default:""},color:{default:"steelblue"}},setup(e){const t=e,a=(s,l,u)=>{let o="https://cdn.jsdelivr.net/gh/YunYouJun/cdn/img/avatar/none.jpg";return l==="qq"?o=`https://q1.qlogo.cn/g?b=qq&nk=${s}&s=${u}`:l==="group"&&(o=`https://p.qlogo.cn/gh/${s}/${s}/${u}`),o};return(s,l)=>(r(),c("div",te,[t.avatar||t.id?(r(),c("img",{key:0,class:"avatar",src:t.avatar||a(t.id,t.type,t.size)},null,8,ae)):(r(),c("div",{key:1,class:"avatar",style:C(`background-color:${s.color}`)},m(t.nickname[0]),5))]))}});const ne={class:"message-box"},oe={class:"nickname"},re={class:"message shadow-sm"},ce=_({__name:"ChatMsg",props:{avatar:{},id:{},nickname:{},color:{}},emits:["appear"],setup(e,{emit:t}){const a=e,s=["1659488338",1659488338],l={1689919782:"知音",1659488338:"master"},u=d=>l[d],o=p();p(!1);const A=p(!1);p(!1);const $=P(()=>s.includes(a.id)),f=()=>{if(!o.value)return;o.value.getBoundingClientRect().top<innerHeight&&(A.value=!0)};return g(()=>{f(),addEventListener("scroll",f)}),(d,_e)=>{const k=x("UserAvatar");return r(),c("div",{ref_key:"messageEl",ref:o,class:q(["chat-message show",{right:$.value}])},[w(k,{id:a.id,avatar:a.avatar,nickname:a.nickname||u(a.id),color:a.color},null,8,["id","avatar","nickname","color"]),n("div",ne,[n("div",oe,m(a.nickname||u(a.id)),1),n("div",re,[h(d.$slots,"default")])])],2)}}});const ie={Layout:Y.Layout,enhanceApp({app:e}){e.component("UserAvatar",se),e.component("ChatMsg",ce),e.component("ChatHistory",ee)}};function y(e){if(e.extends){const t=y(e.extends);return{...t,...e,async enhanceApp(a){t.enhanceApp&&await t.enhanceApp(a),e.enhanceApp&&await e.enhanceApp(a)}}}return e}const i=y(ie),le=_({name:"VitePressApp",setup(){const{site:e}=H();return g(()=>{M(()=>{document.documentElement.lang=e.value.lang,document.documentElement.dir=e.value.dir})}),R(),j(),B(),i.setup&&i.setup(),()=>L(i.Layout)}});async function ue(){const e=pe(),t=de();t.provide(T,e);const a=U(e.route);return t.provide(D,a),t.component("Content",F),t.component("ClientOnly",I),Object.defineProperties(t.config.globalProperties,{$frontmatter:{get(){return a.frontmatter.value}},$params:{get(){return a.page.value.params}}}),i.enhanceApp&&await i.enhanceApp({app:t,router:e,siteData:z}),{app:t,router:e,data:a}}function de(){return N(le)}function pe(){let e=v,t;return O(a=>{let s=S(a);return s?(e&&(t=s),(e||t===s)&&(s=s.replace(/\.js$/,".lean.js")),v&&(e=!1),V(()=>import(s),[])):null},i.NotFound)}v&&ue().then(({app:e,router:t,data:a})=>{t.go().then(()=>{E(t.route,a.site),e.mount("#app")})});export{ue as createApp};
