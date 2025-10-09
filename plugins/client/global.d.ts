/// <reference types="vite/client" />
/// <reference types="@ionic/vue" />

declare module '*.vue' {
  import { Component } from 'vue';

  const component: Component;
  export default component;
}

declare module '*.yaml' {
  const content: {};
  export default content;
}

declare module '*.yml' {
  const content: {};
  export default content;
}
