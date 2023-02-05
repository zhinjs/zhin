<template>
  <div class="c-avatar-box" style="display: inline-block">
    <span class="nickname">{{props.nickname}}</span>
    <img v-if="props.avatar || props.id" class="avatar"
         :src="props.avatar || getAvatarById(props.id, props.type, props.size)" />
    <div v-else class="avatar" :style="`background-color:${color}`">
      {{ props.nickname[0] }}
    </div>
  </div>
</template>

<script setup lang="ts">

interface UserAvatarProps {
  avatar?: string;
  id?: number | string | null;
  type?: "qq" | string;
  size?: number;
  nickname?: string;
  color?: string;
}
const props = withDefaults(defineProps<UserAvatarProps>(), {
  avatar: "",
  id: null,
  type: "qq",
  size: 100,
  nickname: "",
  color: "steelblue",
});
const getAvatarById = (id, type, size) => {
  let url = "https://cdn.jsdelivr.net/gh/YunYouJun/cdn/img/avatar/none.jpg";
  if (type === "qq") {
    url = `https://q1.qlogo.cn/g?b=qq&nk=${id}&s=${size}`;
  } else if (type === "group") {
    url = `https://p.qlogo.cn/gh/${id}/${id}/${size}`;
  }
  return url;
};
</script>

<style lang="less">
.c-avatar-box{
  position: relative;
  .nickname{
    position: absolute;
    display: block;
    width: 100%;
    word-break: keep-all;
    text-align: center;
    bottom:100%;
    font-size: .5rem;
    line-height: 1rem;
  }
  .avatar {
    display: inline-flex;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    line-height: 0;
    justify-content: center;
    align-items: center;
    color: white;
  }
}
</style>