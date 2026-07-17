import { defineComponent } from '@zhin.js/next-feature-component';

export default defineComponent({
  render: (props: { label: string }) => props.label,
});
