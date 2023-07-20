<template>
    <div ref="messageEl" class="chat-message show" :class="{ right: isMine }">
        <UserAvatar
            :id="props.id"
            :avatar="props.avatar"
            :nickname="props.nickname || getNickname(props.id)"
            :color="props.color"></UserAvatar>
        <div class="message-box">
            <div class="nickname">
                {{ props.nickname || getNickname(props.id) }}
            </div>
            <div class="message shadow-sm">
                <slot></slot>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, computed } from "vue";
const mineIds = ["1659488338", 1659488338];
const nickNameMap = {
    1689919782: "知音",
    1659488338: "master",
};
const getNickname = id => nickNameMap[id];
interface ChatMessageProps {
    avatar?: string;
    id?: string | number;
    nickname?: string;
    color?: string;
}
const props = defineProps<ChatMessageProps>();
const emit = defineEmits<{
    (e: "appear"): void;
}>();
const messageEl = ref<HTMLElement | null>();
const show = ref(false);
const active = ref(false);
const moving = ref(false);
// todo
// watch(active, (value)=> {
//   if (!value) return (show.value = false);
//   if (!messageEl.value) return
//   const prev =
//     messageEl.value.previousElementSibling
//   if (prev && (prev.moving || !prev.show)) {
//     prev.$once("appear", appear);
//   } else {
//     appear();
//   }
// })
const appear = () => {
    show.value = true;
    moving.value = true;
    setTimeout(() => {
        moving.value = false;
        emit("appear");
    }, 200);
};

const isMine = computed(() => {
    return mineIds.includes(props.id);
});
const handleScroll = () => {
    if (!messageEl.value) return;
    const rect = messageEl.value.getBoundingClientRect();
    if (rect.top < innerHeight) active.value = true;
};
onMounted(() => {
    handleScroll();
    addEventListener("scroll", handleScroll);
});
</script>

<style lang="less">
.chat-message {
    position: relative;
    margin: 1.5rem 0;
    opacity: 0;
    transform: translateX(-10%);
    transition:
        transform 0.4s ease-out,
        opacity 0.4s ease-in;
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    &.show {
        opacity: 1;
        transform: translateX(0);
    }
    &.right {
        flex-direction: row-reverse;
        .message {
            &-box {
                .nickname {
                    text-align: right;
                }
            }
            &::before {
                left: 100%;
                border-radius: 0 0 1rem 0;
                right: unset;
            }
        }
    }
}
.message-box {
    display: inline-block;
    margin: 0 0.5rem;
    max-width: 90%;
    vertical-align: top;
}
.nickname {
    font-size: 0.8rem;
    color: var(--vp-c-text-2);
    &:empty {
        display: none;
    }
}
.message {
    position: relative;
    font-size: 0.9rem;
    border-radius: 0.5rem;
    background-color: var(--vp-c-bg-soft);
    word-break: break-all;
    padding: 0.6rem 0.7rem;
    margin-top: 0.2rem;
    > img {
        border-radius: 0.5rem;
        vertical-align: middle;
    }
    &::before {
        content: "";
        position: absolute;
        right: 100%;
        top: 0px;
        width: 8px;
        height: 8px;
        border: 0 solid transparent;
        border-bottom-width: 5px;
        border-bottom-color: currentColor;
        border-radius: 0 0 0 1rem;
        color: var(--vp-c-bg-soft);
    }
}
</style>
