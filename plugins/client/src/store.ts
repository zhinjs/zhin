import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
export const useCommonStore = defineStore('common', () => {
  const store = ref<Record<string, any>>({});
  const initialized = ref(false);
  let resolve: (v: unknown) => any;
  const initial = new Promise(res => (resolve = res));
  const syncData = ({ key, value }: { key: string; value: any }) => {
    store.value[key] = value;
    if (resolve) {
      initialized.value = true;
      setTimeout(resolve, 300);
    }
  };
  const addData = ({ key, value }: { key: string; value: any }) => {
    const list = (store.value[key] ||= []);
    list.push(value);
  };
  const deleteData = ({ key, value }: { key: string; value: any }) => {
    const list = (store.value[key] ||= []);
    list.splice(list.indexOf(value), 1);
  };
  let beforeElement: Node[] = [];
  const createScript = (store: Record<string, any>) => {
    if(!store.entries?.length) return;
    const fragment = document.createDocumentFragment();
    while (beforeElement.length) {
      const element = beforeElement.shift()!;
      document.body.removeChild(element);
    }
    const entries: string[] = (store.entries ||= []);
    entries.forEach(entry => {
      const el = document.createElement('script');
      el.type = 'module';
      el.src = entry;
      fragment.appendChild(el);
      beforeElement.push(el);
    });
    document.body.appendChild(fragment);
  };
  watch(store, createScript, {
    immediate: true,
    deep: true,
  });
  return {
    store,
    initialized,
    initial,
    syncData,
    addData,
    deleteData,
  };
});
